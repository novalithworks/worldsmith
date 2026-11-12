import { debounce, mapLimit, type Debounced } from '../../core/util/async';
import { listFilesDeep, type StorageAdapter } from './StorageAdapter';
import type { AtomicJsonFile } from './AtomicJsonFile';
import type { WriteQueue } from './WriteQueue';

/**
 * In-memory collection persisted as bucket files.
 *
 * Every collection (entities, relations, tasks, …) uses this one class. What differs is
 * `bucketOf(record)`: one record per file for entities, hash shards for tiny records.
 *
 *  - Reads are synchronous from memory.
 *  - put()/delete() update memory, mark the bucket dirty and schedule a debounced flush.
 *  - flush() writes only dirty buckets; an emptied bucket's file is removed.
 *
 * On-disk bucket file: { format, v, bucket, records: [...] }
 */
export interface BucketFile<T> {
	format: string;
	v: number;
	bucket: string;
	records: T[];
}

export type StoreState = 'idle' | 'pending' | 'saving' | 'error';

export interface BucketStoreOptions<T extends { id: string }> {
	name: string;
	adapter: StorageAdapter;
	files: AtomicJsonFile;
	queue: WriteQueue;
	/** Root folder of this collection. */
	dir: string;
	format: string;
	fileVersion: number;
	bucketOf(record: T): string;
	pathOf(bucket: string): string;
	/** Upgrade/normalize a raw record read from disk. Return null to drop an invalid record. */
	hydrate(raw: unknown): { record: T; upgraded: boolean } | null;
	debounceMs?: number;
	maxWaitMs?: number;
	onStateChange?(state: StoreState, error?: unknown): void;
}

export interface LoadReport {
	files: number;
	records: number;
	recovered: string[];
	quarantined: string[];
	dropped: number;
}

export class BucketStore<T extends { id: string }> {
	private records = new Map<string, T>();
	private bucketOfId = new Map<string, string>();
	private members = new Map<string, Set<string>>();
	private dirty = new Set<string>();
	private flushing: Promise<void> | null = null;
	private scheduler: Debounced<[]>;
	private state: StoreState = 'idle';
	private retryTimer: ReturnType<typeof setTimeout> | null = null;

	constructor(private readonly opts: BucketStoreOptions<T>) {
		this.scheduler = debounce(() => void this.flush(), opts.debounceMs ?? 750, opts.maxWaitMs ?? 5000);
	}

	get size(): number {
		return this.records.size;
	}

	get(id: string): T | undefined {
		return this.records.get(id);
	}

	has(id: string): boolean {
		return this.records.has(id);
	}

	values(): IterableIterator<T> {
		return this.records.values();
	}

	all(): T[] {
		return [...this.records.values()];
	}

	hasPendingWrites(): boolean {
		return this.dirty.size > 0 || this.flushing !== null;
	}

	// ── loading ────────────────────────────────────────────────────────────────

	async loadAll(): Promise<LoadReport> {
		const report: LoadReport = { files: 0, records: 0, recovered: [], quarantined: [], dropped: 0 };
		this.records.clear();
		this.bucketOfId.clear();
		this.members.clear();
		this.dirty.clear();

		// Collapse foo.json / foo.json.tmp / foo.json.bak into one base path; the atomic
		// reader picks whichever is valid.
		const all = await listFilesDeep(this.opts.adapter, this.opts.dir);
		const bases = new Set<string>();
		for (const f of all) {
			const base = f.replace(/\.(tmp|bak)$/, '');
			if (base.endsWith('.json')) bases.add(base);
		}

		await mapLimit([...bases], 32, async (path) => {
			const res = await this.opts.files.read<BucketFile<unknown>>(path);
			if (res.quarantined) report.quarantined.push(res.quarantined);
			if (!res.value) return;
			report.files++;
			const file = res.value;
			if (!Array.isArray(file.records)) return;
			let needsRewrite = !!res.recoveredFrom;
			if (res.recoveredFrom) report.recovered.push(path);
			for (const raw of file.records) {
				const h = this.opts.hydrate(raw);
				if (!h) {
					report.dropped++;
					continue;
				}
				this.index(h.record);
				report.records++;
				if (h.upgraded) needsRewrite = true;
			}
			if (needsRewrite && typeof file.bucket === 'string') this.dirty.add(file.bucket);
		});

		if (this.dirty.size) this.schedule();
		return report;
	}

	// ── mutation ───────────────────────────────────────────────────────────────

	put(record: T): void {
		const prevBucket = this.bucketOfId.get(record.id);
		const bucket = this.index(record);
		if (prevBucket && prevBucket !== bucket) this.dirty.add(prevBucket);
		this.dirty.add(bucket);
		this.schedule();
	}

	delete(id: string): boolean {
		if (!this.records.has(id)) return false;
		const bucket = this.bucketOfId.get(id) as string;
		this.records.delete(id);
		this.bucketOfId.delete(id);
		this.members.get(bucket)?.delete(id);
		this.dirty.add(bucket);
		this.schedule();
		return true;
	}

	private index(record: T): string {
		const bucket = this.opts.bucketOf(record);
		const prev = this.bucketOfId.get(record.id);
		if (prev && prev !== bucket) this.members.get(prev)?.delete(record.id);
		this.records.set(record.id, record);
		this.bucketOfId.set(record.id, bucket);
		let set = this.members.get(bucket);
		if (!set) {
			set = new Set();
			this.members.set(bucket, set);
		}
		set.add(record.id);
		return bucket;
	}

	// ── persistence ────────────────────────────────────────────────────────────

	private schedule(): void {
		this.setState('pending');
		this.scheduler();
	}

	/** Write all dirty buckets now. Safe to call concurrently. */
	async flush(): Promise<void> {
		this.scheduler.cancel();
		if (this.flushing) {
			await this.flushing;
			if (this.dirty.size === 0) return;
		}
		if (this.dirty.size === 0) {
			if (this.state === 'pending') this.setState('idle');
			return;
		}
		const buckets = [...this.dirty];
		this.dirty.clear();
		this.setState('saving');

		this.flushing = (async () => {
			const failed: string[] = [];
			let lastError: unknown;
			await Promise.all(
				buckets.map(async (bucket) => {
					const path = this.opts.pathOf(bucket);
					try {
						await this.opts.queue.run(path, () => this.writeBucket(bucket, path));
					} catch (e) {
						failed.push(bucket);
						lastError = e;
					}
				}),
			);
			if (failed.length) {
				// Keep failed buckets dirty so data is retried, never dropped.
				for (const b of failed) this.dirty.add(b);
				console.error(`[Worldsmith] ${this.opts.name}: failed to save ${failed.length} file(s)`, lastError);
				this.setState('error', lastError);
				if (!this.retryTimer) {
					this.retryTimer = window.setTimeout(() => {
						this.retryTimer = null;
						if (this.dirty.size) this.schedule();
					}, 10_000);
				}
			} else {
				this.setState(this.dirty.size ? 'pending' : 'idle');
			}
		})();

		try {
			await this.flushing;
		} finally {
			this.flushing = null;
		}
		if (this.dirty.size && this.state !== 'error') this.schedule();
	}

	private async writeBucket(bucket: string, path: string): Promise<void> {
		const ids = this.members.get(bucket);
		const records = ids ? [...ids].map((id) => this.records.get(id)).filter((r): r is T => !!r) : [];
		if (records.length === 0) {
			this.members.delete(bucket);
			await this.opts.files.remove(path);
			return;
		}
		const file: BucketFile<T> = {
			format: this.opts.format,
			v: this.opts.fileVersion,
			bucket,
			records,
		};
		await this.opts.files.write(path, file);
	}

	private setState(state: StoreState, error?: unknown): void {
		if (this.state === state && state !== 'error') return;
		this.state = state;
		this.opts.onStateChange?.(state, error);
	}

	/** Drop unsaved changes (the files on disk were just replaced, e.g. by a backup restore). */
	discard(): void {
		this.dirty.clear();
		this.dispose();
	}

	dispose(): void {
		this.scheduler.cancel();
		if (this.retryTimer) window.clearTimeout(this.retryTimer);
		this.retryTimer = null;
	}
}
