import { debounce, type Debounced } from '../../core/util/async';
import type { AtomicJsonFile } from './AtomicJsonFile';
import type { WriteQueue } from './WriteQueue';
import type { StoreState } from './BucketStore';

/**
 * A single JSON document (manifest, world.json) held in memory, written with a `.bak`
 * rotation, debounced like BucketStore.
 */
export interface DocumentStoreOptions<T> {
	name: string;
	path: string;
	files: AtomicJsonFile;
	queue: WriteQueue;
	hydrate(raw: unknown): { value: T; upgraded: boolean } | null;
	debounceMs?: number;
	onStateChange?(state: StoreState, error?: unknown): void;
}

export class DocumentStore<T> {
	private value: T | null = null;
	private dirty = false;
	private scheduler: Debounced<[]>;

	constructor(private readonly opts: DocumentStoreOptions<T>) {
		this.scheduler = debounce(() => void this.flush(), opts.debounceMs ?? 500, 3000);
	}

	get path(): string {
		return this.opts.path;
	}

	get(): T | null {
		return this.value;
	}

	require(): T {
		if (this.value === null) throw new Error(`[Worldsmith] ${this.opts.name} is not loaded`);
		return this.value;
	}

	/** Load from disk. Returns null if the file doesn't exist or is unrecoverable. */
	async load(): Promise<{ value: T | null; quarantined?: string }> {
		const res = await this.opts.files.read<unknown>(this.opts.path);
		if (res.value === null) {
			this.value = null;
			return { value: null, quarantined: res.quarantined };
		}
		const h = this.opts.hydrate(res.value);
		this.value = h ? h.value : null;
		if (h && (h.upgraded || res.recoveredFrom)) this.markDirty();
		return { value: this.value, quarantined: res.quarantined };
	}

	set(value: T): void {
		this.value = value;
		this.markDirty();
	}

	/** Write immediately (used when creating files that must exist before continuing). */
	async save(value: T): Promise<void> {
		this.value = value;
		this.dirty = true;
		await this.flush();
	}

	private markDirty(): void {
		this.dirty = true;
		this.opts.onStateChange?.('pending');
		this.scheduler();
	}

	async flush(): Promise<void> {
		this.scheduler.cancel();
		if (!this.dirty || this.value === null) return;
		this.dirty = false;
		const value = this.value;
		this.opts.onStateChange?.('saving');
		try {
			await this.opts.queue.run(this.opts.path, () => this.opts.files.write(this.opts.path, value, { backup: true }));
			this.opts.onStateChange?.(this.dirty ? 'pending' : 'idle');
		} catch (e) {
			this.dirty = true;
			console.error(`[Worldsmith] ${this.opts.name}: save failed`, e);
			this.opts.onStateChange?.('error', e);
		}
	}

	hasPendingWrites(): boolean {
		return this.dirty;
	}

	/** Drop unsaved changes (the file on disk was just replaced, e.g. by a backup restore). */
	discard(): void {
		this.dirty = false;
		this.scheduler.cancel();
	}

	dispose(): void {
		this.scheduler.cancel();
	}
}
