import { debounce, mapLimit, type Debounced } from '../../core/util/async';
import type { ManuscriptItem } from '../../core/types';
import { countWords } from './wordCount';
import { inFolder, type ManuscriptVault, type VaultChange } from './vault';

/** What the index needs from the Writing service. */
export interface ManuscriptIndexHost {
	vault(): ManuscriptVault | null;
	/** Scenes (live or in the trash) linked to this note. */
	scenesAt(path: string): ManuscriptItem[];
	/** A project's scenes in manuscript order (not trashed). */
	scenesOf(projectId: string): ManuscriptItem[];
	/** Counts of these scenes changed. */
	changed(projectId: string, sceneIds: string[]): void;
}

interface Entry {
	mtime: number;
	size: number;
	words: number;
}

/**
 * Word counts per manuscript note, cached by the note's modified time and size.
 *
 *  - Counting is lazy: nothing is read until the studio asks (`warm`, `refresh`), so no
 *    background work runs while the studio isn't used.
 *  - Notes are read with `cachedRead` (Obsidian's in-memory copy), at most a few at once.
 *  - A typed change re-counts only that note, a moment after typing stops; a note whose
 *    time and size didn't change is never read again.
 *  - Renames move the cached count; a deleted note drops out of the totals.
 */
export class ManuscriptIndex {
	private cache = new Map<string, Entry>();
	/** Notes counted at least once (kept when a note is deleted, so one put back is re-counted). */
	private seen = new Set<string>();
	private pending = new Set<string>();
	private inflight = new Map<string, Promise<number | null>>();
	private flushPending: Debounced<[]>;

	constructor(
		private readonly host: ManuscriptIndexHost,
		/** Pause after the last change before re-counting. */
		delayMs = 600,
	) {
		this.flushPending = debounce(() => void this.recountPending(), delayMs, delayMs * 5);
	}

	/** The cached count of a note, or null when it hasn't been counted (or is missing). */
	words(path: string | null | undefined): number | null {
		return path ? (this.cache.get(path)?.words ?? null) : null;
	}

	/** A scene's count (0 for a scene without a counted note). */
	sceneWords(scene: ManuscriptItem): number {
		return this.words(scene.notePath) ?? 0;
	}

	/** Total of a list of scenes (each note counted once). */
	total(scenes: ManuscriptItem[]): number {
		const seen = new Set<string>();
		let n = 0;
		for (const s of scenes) {
			if (!s.notePath || seen.has(s.notePath)) continue;
			seen.add(s.notePath);
			n += this.words(s.notePath) ?? 0;
		}
		return n;
	}

	projectWords(projectId: string): number {
		return this.total(this.host.scenesOf(projectId));
	}

	/** Have all of a project's notes been counted (and none is waiting to be re-counted)? */
	isWarm(projectId: string): boolean {
		return this.host.scenesOf(projectId).every((s) => !s.notePath || (this.cache.has(s.notePath) && !this.pending.has(s.notePath)) || !this.host.vault()?.file(s.notePath));
	}

	/** Count every note of a project that isn't counted yet or changed since. */
	async warm(projectId: string): Promise<void> {
		const paths = [...new Set(this.host.scenesOf(projectId).map((s) => s.notePath).filter((p): p is string => !!p))];
		await mapLimit(paths, 4, (p) => this.refresh(p));
	}

	/** Count one note now (skipped when its time and size match the cache). */
	refresh(path: string, force = false): Promise<number | null> {
		// One count per note at a time; a count asked for meanwhile runs after it (and is
		// skipped cheaply when nothing changed), so a change during a read is never missed.
		const before = this.inflight.get(path);
		const job: Promise<number | null> = (before ? before.catch(() => null) : Promise.resolve(null)).then(() => this.count(path, force)).finally(() => {
			if (this.inflight.get(path) === job) this.inflight.delete(path);
		});
		this.inflight.set(path, job);
		return job;
	}

	private async count(path: string, force: boolean): Promise<number | null> {
		const vault = this.host.vault();
		const file = vault?.file(path);
		if (!vault || !file) {
			const had = this.cache.delete(path);
			if (had) this.announce([path]);
			return null;
		}
		const cur = this.cache.get(path);
		if (!force && cur && cur.mtime === file.mtime && cur.size === file.size) return cur.words;
		let text: string;
		try {
			text = await vault.cachedRead(path);
		} catch {
			return cur?.words ?? null;
		}
		const words = countWords(text);
		this.cache.set(path, { mtime: file.mtime, size: file.size, words });
		this.seen.add(path);
		if (!cur || cur.words !== words) this.announce([path]);
		return words;
	}

	/** Vault events, after the service has followed renames. */
	handle(change: VaultChange): void {
		if (change.type === 'rename') {
			const moves: Array<[string, string]> = [];
			for (const p of this.cache.keys()) {
				if (p === change.oldPath) moves.push([p, change.path]);
				else if (change.folder && inFolder(p, change.oldPath)) moves.push([p, change.path + p.slice(change.oldPath.length)]);
			}
			for (const [from, to] of moves) {
				const e = this.cache.get(from)!;
				this.cache.delete(from);
				this.cache.set(to, e);
				this.seen.delete(from);
				this.seen.add(to);
			}
			if (moves.length) this.announce(moves.map(([, to]) => to));
			return;
		}
		if (change.type === 'delete') {
			const gone = [...this.cache.keys()].filter((p) => p === change.path || (change.folder && inFolder(p, change.path)));
			for (const p of gone) this.cache.delete(p);
			if (gone.length) this.announce(gone);
			return;
		}
		// create / modify: only notes a scene uses (any other note is never read), a moment
		// after typing stops. A scene note not counted yet is counted then too, so a note
		// just made or linked gets its count without reopening the studio.
		if (change.folder || !this.host.scenesAt(change.path).length) return;
		this.pending.add(change.path);
		this.flushPending();
	}

	/** Run pending re-counts now (tests, and before reading totals for a report). */
	async flush(): Promise<void> {
		this.flushPending.cancel();
		await this.recountPending();
	}

	private async recountPending(): Promise<void> {
		const paths = [...this.pending];
		this.pending.clear();
		await mapLimit(paths, 4, (p) => this.refresh(p, false));
	}

	/** Forget a note's count (its scene was unlinked from it). */
	forget(path: string): void {
		this.cache.delete(path);
		this.seen.delete(path);
		this.pending.delete(path);
	}

	private announce(paths: string[]): void {
		const byProject = new Map<string, string[]>();
		for (const p of paths) {
			for (const s of this.host.scenesAt(p)) {
				const list = byProject.get(s.projectId) ?? [];
				list.push(s.id);
				byProject.set(s.projectId, list);
			}
		}
		for (const [projectId, ids] of byProject) this.host.changed(projectId, ids);
	}

	dispose(): void {
		this.flushPending.cancel();
		this.pending.clear();
		this.cache.clear();
		this.seen.clear();
	}
}
