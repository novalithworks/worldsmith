import type { App, TFile } from 'obsidian';
import type { ManuscriptItem } from '../../core/types';
import type { Database } from '../../data/Database';
import { joinPath } from '../../data/storage/StorageAdapter';
import type { WorldService } from '../WorldService';
import { dayKey } from './progress';

/**
 * Scene snapshots (WS6, 0.25): copies of a scene's text you can compare with and go back to.
 * Kept with the world in `writing/snapshots/<sceneId>/<time>-<kind>.json`, so manual backups
 * and exports carry them (automatic backups leave them out, to stay small).
 *
 *  - manual: taken with a name; never pruned.
 *  - auto: once a day per scene, before the first change that day (when the scene opens in the
 *    studio, or at the first save seen); the last 20 per scene are kept.
 *  - before-restore: your text just before a restore, so a restore never loses anything; the
 *    last 10 per scene are kept.
 */

export type SnapshotKind = 'manual' | 'auto' | 'before-restore';

export interface Snapshot {
	format: 'worldsmith/snapshot';
	v: 1;
	id: string;
	sceneId: string;
	projectId: string;
	createdAt: number;
	kind: SnapshotKind;
	name: string;
	text: string;
	words: number;
}

export type SnapshotMeta = Omit<Snapshot, 'text'>;

export const KEEP = { auto: 20, 'before-restore': 10 } as const;

/** Which snapshots to delete: beyond the newest 20 automatic and 10 before-restore; never manual. */
export function planSnapshotPrune(list: Array<Pick<SnapshotMeta, 'id' | 'kind' | 'createdAt'>>): string[] {
	const drop: string[] = [];
	for (const kind of ['auto', 'before-restore'] as const) {
		const of = list.filter((s) => s.kind === kind).sort((a, b) => b.createdAt - a.createdAt);
		for (const s of of.slice(KEEP[kind])) drop.push(s.id);
	}
	return drop;
}

export function countWords(text: string): number {
	const body = text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');
	return (body.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) ?? []).length;
}

export class SnapshotService {
	/** Scenes that already got their automatic snapshot, by day. */
	private autoDone = new Map<string, string>();
	private busy = new Set<string>();

	constructor(
		private readonly app: App,
		private readonly db: Database,
		private readonly worlds: WorldService,
	) {}

	private dir(sceneId: string): string {
		const s = this.worlds.session;
		if (!s) throw new Error('No world is open.');
		return joinPath(this.db.paths.worldDir(s.worldId), 'writing', 'snapshots', sceneId);
	}

	private file(scene: ManuscriptItem): TFile | null {
		return scene.notePath ? this.app.vault.getFileByPath(scene.notePath) : null;
	}

	/** A scene's snapshots, newest first (without their text). */
	async list(sceneId: string): Promise<SnapshotMeta[]> {
		const dir = this.dir(sceneId);
		if (!(await this.db.adapter.exists(dir))) return [];
		const out: SnapshotMeta[] = [];
		for (const p of (await this.db.adapter.list(dir)).files) {
			if (!p.endsWith('.json')) continue;
			const v = (await this.db.files.read<Snapshot>(p)).value;
			if (!v || v.format !== 'worldsmith/snapshot' || v.sceneId !== sceneId || typeof v.text !== 'string') continue;
			const { text: _t, ...meta } = v;
			void _t;
			out.push(meta);
		}
		return out.sort((a, b) => b.createdAt - a.createdAt);
	}

	async read(sceneId: string, id: string): Promise<Snapshot | null> {
		const v = (await this.db.files.read<Snapshot>(joinPath(this.dir(sceneId), `${id}.json`))).value;
		return v && v.format === 'worldsmith/snapshot' && v.sceneId === sceneId && typeof v.text === 'string' ? v : null;
	}

	/**
	 * Save the scene's text as it is now. An automatic one is skipped (null) when the text is
	 * the same as the newest snapshot's.
	 */
	async take(scene: ManuscriptItem, kind: SnapshotKind, name = ''): Promise<SnapshotMeta | null> {
		const f = this.file(scene);
		if (!f) throw new Error('This scene has no note yet.');
		const text = await this.app.vault.read(f);
		const list = await this.list(scene.id);
		if (kind === 'auto' && list[0]) {
			const last = await this.read(scene.id, list[0].id);
			if (last && last.text === text) return null;
		}
		let createdAt = Date.now();
		if (list.some((s) => s.createdAt === createdAt)) createdAt++;
		const id = `${createdAt}-${kind}`;
		const snap: Snapshot = { format: 'worldsmith/snapshot', v: 1, id, sceneId: scene.id, projectId: scene.projectId, createdAt, kind, name: name.trim(), text, words: countWords(text) };
		await this.db.files.write(joinPath(this.dir(scene.id), `${id}.json`), snap);
		const { text: _t, ...meta } = snap;
		void _t;
		for (const drop of planSnapshotPrune([meta, ...list])) await this.db.adapter.remove(joinPath(this.dir(scene.id), `${drop}.json`)).catch(() => undefined);
		return meta;
	}

	/** Once a day per scene, before the first change: called when a scene opens, and on saves. */
	async autoDaily(scene: ManuscriptItem): Promise<void> {
		const today = dayKey();
		if (this.autoDone.get(scene.id) === today || this.busy.has(scene.id) || !this.file(scene)) return;
		this.busy.add(scene.id);
		try {
			const list = await this.list(scene.id);
			if (!list.some((s) => dayKey(s.createdAt) === today)) await this.take(scene, 'auto', '');
			this.autoDone.set(scene.id, today);
		} catch {
			/* a snapshot is a convenience; writing goes on */
		} finally {
			this.busy.delete(scene.id);
		}
	}

	/**
	 * Put a snapshot's text back into the scene. Your current text is saved as a snapshot first
	 * ("before restoring"), so nothing is lost; the returned undo brings it back.
	 */
	async restore(scene: ManuscriptItem, id: string): Promise<() => Promise<void>> {
		const snap = await this.read(scene.id, id);
		if (!snap) throw new Error('That snapshot can’t be read.');
		const f = this.file(scene);
		if (!f) throw new Error('This scene has no note yet.');
		const label = snap.name || new Date(snap.createdAt).toLocaleString();
		const before = await this.take(scene, 'before-restore', `Before restoring “${label}”`);
		await this.app.vault.modify(f, snap.text);
		return async () => {
			if (!before) return;
			const back = await this.read(scene.id, before.id);
			const ff = this.file(scene);
			if (back && ff) await this.app.vault.modify(ff, back.text);
		};
	}

	async remove(sceneId: string, id: string): Promise<void> {
		await this.db.adapter.remove(joinPath(this.dir(sceneId), `${id}.json`));
	}
}
