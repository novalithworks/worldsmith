import { Notice, TFile, normalizePath, type App, type Component } from 'obsidian';
import type { EntityRecord, ExtraNote } from '../core/types';
import { sanitizeFileName } from '../core/util/strings';
import type { WorldService } from './WorldService';

/**
 * Optional Markdown notes attached to entities. The note is supplemental free-form
 * writing; structured data never lives in it.
 *
 * Obsidian has no stable file ids, so we follow vault rename/delete events to keep
 * `linkedNote.path` correct. New notes get a `worldsmith` frontmatter key holding the
 * entity id, so links can be re-matched later even if a move happened while the plugin
 * was disabled.
 */
export class LinkedNoteService {
	constructor(
		private readonly app: App,
		private readonly worlds: WorldService,
		private readonly getFolder: () => string,
		/** Worldsmith's own data folder — its file churn is never a linked note. */
		private readonly getDataFolder: () => string = () => '',
	) {}

	private isOwnData(path: string): boolean {
		const root = this.getDataFolder();
		return !!root && (path === root || path.startsWith(`${root}/`));
	}

	/** Wire vault events. Call once with the plugin as owner. */
	register(owner: Component): void {
		owner.registerEvent(
			this.app.vault.on('rename', (file, oldPath) => {
				const s = this.worlds.session;
				if (!s || !(file instanceof TFile) || this.isOwnData(oldPath)) return;
				for (const e of s.entities.values()) {
					if (e.linkedNote?.path === oldPath) s.entityService.update(e.id, { linkedNote: { path: file.path } });
					if (e.moreNotes.some((n) => n.path === oldPath)) s.entityService.update(e.id, { moreNotes: e.moreNotes.map((n) => (n.path === oldPath ? { ...n, path: file.path } : n)) });
				}
			}),
		);
		// A deleted note is NOT unlinked (0.18): the entry keeps its path and shows the note as
		// missing, so restoring it (Obsidian's trash, sync, a backup) reconnects it by itself.
		// Unlinking is always the person's choice (the note menu, World health).
	}

	/** Is the note at this path gone from the vault? */
	isMissing(path: string | null | undefined): boolean {
		return !!path && !this.app.vault.getAbstractFileByPath(path);
	}

	/**
	 * Notes that might be a missing note moved elsewhere: first any note whose front matter
	 * names the entry (`worldsmith-id` or `worldsmith`), then notes with the same file name.
	 * Never notes another entry already holds.
	 */
	findAgain(entity: EntityRecord, path: string): TFile[] {
		const s = this.worlds.session;
		const taken = new Set<string>();
		if (s) for (const e of s.entities.values()) {
			if (e.linkedNote) taken.add(e.linkedNote.path);
			for (const n of e.moreNotes) taken.add(n.path);
			if (e.nativeNote) taken.add(e.nativeNote.path);
		}
		const base = (path.split('/').pop() ?? path).replace(/\.md$/i, '').toLowerCase();
		const byId: TFile[] = [];
		const byName: TFile[] = [];
		for (const f of this.app.vault.getMarkdownFiles()) {
			if (taken.has(f.path) || this.isOwnData(f.path)) continue;
			const fm = this.app.metadataCache.getFileCache(f)?.frontmatter;
			if (fm && (fm['worldsmith-id'] === entity.id || fm['worldsmith'] === entity.id)) byId.push(f);
			else if (f.basename.toLowerCase() === base) byName.push(f);
		}
		return [...byId, ...byName].slice(0, 8);
	}

	/** Point a missing note's link at another file, keeping its place (main or extra) and label. */
	relink(entity: EntityRecord, oldPath: string, file: TFile): void {
		const s = this.worlds.session;
		const cur = s?.entities.get(entity.id);
		if (!s || !cur) return;
		if (cur.linkedNote?.path === oldPath) s.entityService.update(cur.id, { linkedNote: { path: file.path }, moreNotes: cur.moreNotes.filter((n) => n.path !== file.path) });
		else if (cur.moreNotes.some((n) => n.path === oldPath)) s.entityService.update(cur.id, { moreNotes: cur.moreNotes.map((n) => (n.path === oldPath ? { ...n, path: file.path } : n)).filter((n, i, all) => all.findIndex((x) => x.path === n.path) === i) });
	}

	file(entity: EntityRecord): TFile | null {
		return entity.linkedNote ? this.app.vault.getFileByPath(entity.linkedNote.path) : null;
	}

	/** Every note linked to the entry: the main one first. */
	notes(entity: EntityRecord): Array<ExtraNote & { main: boolean; file: TFile | null }> {
		const out: Array<ExtraNote & { main: boolean; file: TFile | null }> = [];
		if (entity.linkedNote) out.push({ path: entity.linkedNote.path, main: true, file: this.app.vault.getFileByPath(entity.linkedNote.path) });
		for (const n of entity.moreNotes ?? []) out.push({ ...n, main: false, file: this.app.vault.getFileByPath(n.path) });
		return out;
	}

	/**
	 * Create a note for the entry. Without a title it's the entry's main note ("Auron Vale");
	 * with one it's another note ("Auron Vale — Backstory"), added after the others.
	 */
	async create(entity: EntityRecord, title?: string): Promise<TFile | null> {
		const s = this.worlds.session;
		if (!s) return null;
		const schema = s.schemas.get(entity.typeId);
		const folder = normalizePath(`${this.getFolder()}/${sanitizeFileName(schema?.plural ?? 'Entities')}`);
		await this.ensureFolder(folder);
		const heading = title?.trim() ? `${entity.name} — ${title.trim()}` : entity.name;
		const base = sanitizeFileName(heading);
		let path = normalizePath(`${folder}/${base}.md`);
		let n = 2;
		while (this.app.vault.getAbstractFileByPath(path)) path = normalizePath(`${folder}/${base} ${n++}.md`);
		const body = `---\nworldsmith: ${entity.id}\n---\n\n# ${heading}\n\n`;
		try {
			const file = await this.app.vault.create(path, body);
			this.attach(entity.id, file.path, title?.trim() || undefined);
			return file;
		} catch (e) {
			new Notice(`Couldn’t create the note: ${e instanceof Error ? e.message : String(e)}`);
			return null;
		}
	}

	/** Link an existing note: the main one if the entry has none, otherwise another one. */
	link(entity: EntityRecord, file: TFile): void {
		this.attach(entity.id, file.path);
	}

	/** Make this the main note (the previous main note stays linked). */
	replaceMain(entity: EntityRecord, file: TFile): void {
		const s = this.worlds.session;
		const cur = s?.entities.get(entity.id);
		if (!s || !cur) return;
		const more = cur.moreNotes.filter((n) => n.path !== file.path);
		if (cur.linkedNote && cur.linkedNote.path !== file.path) more.unshift({ path: cur.linkedNote.path });
		s.entityService.update(cur.id, { linkedNote: { path: file.path }, moreNotes: more });
	}

	private attach(entityId: string, path: string, label?: string): void {
		const s = this.worlds.session;
		const cur = s?.entities.get(entityId);
		if (!s || !cur) return;
		if (cur.linkedNote?.path === path || cur.moreNotes.some((n) => n.path === path)) return;
		if (!cur.linkedNote) s.entityService.update(cur.id, { linkedNote: { path } });
		else s.entityService.update(cur.id, { moreNotes: [...cur.moreNotes, label ? { path, label } : { path }] });
	}

	/** Detach a note (the file stays in the vault). Returns what Undo needs. */
	unlink(entity: EntityRecord, path?: string): { linkedNote: EntityRecord['linkedNote']; moreNotes: ExtraNote[] } | null {
		const s = this.worlds.session;
		const cur = s?.entities.get(entity.id);
		if (!s || !cur) return null;
		const before = { linkedNote: cur.linkedNote, moreNotes: cur.moreNotes.map((n) => ({ ...n })) };
		const target = path ?? cur.linkedNote?.path;
		if (!target) return null;
		if (cur.linkedNote?.path === target) {
			const [next, ...rest] = cur.moreNotes;
			s.entityService.update(cur.id, next ? { linkedNote: { path: next.path }, moreNotes: rest } : { linkedNote: null });
		} else s.entityService.update(cur.id, { moreNotes: cur.moreNotes.filter((n) => n.path !== target) });
		return before;
	}

	/** Make one of the other notes the main note. */
	makeMain(entity: EntityRecord, path: string): void {
		const f = this.app.vault.getFileByPath(path);
		const s = this.worlds.session;
		const cur = s?.entities.get(entity.id);
		if (!s || !cur) return;
		if (f) return this.replaceMain(cur, f);
		const more = cur.moreNotes.filter((n) => n.path !== path);
		if (cur.linkedNote) more.unshift({ path: cur.linkedNote.path });
		s.entityService.update(cur.id, { linkedNote: { path }, moreNotes: more });
	}

	/** Label shown for another note ("Backstory"); empty clears it. */
	setLabel(entity: EntityRecord, path: string, label: string): void {
		const s = this.worlds.session;
		const cur = s?.entities.get(entity.id);
		if (!s || !cur) return;
		s.entityService.update(cur.id, { moreNotes: cur.moreNotes.map((n) => (n.path === path ? (label.trim() ? { path, label: label.trim() } : { path }) : n)) });
	}

	async open(entity: EntityRecord, newLeaf: boolean | 'split' | 'tab' = true): Promise<void> {
		if (!entity.linkedNote) return;
		await this.openPath(entity.linkedNote.path, newLeaf);
	}

	async openPath(path: string, newLeaf: boolean | 'split' | 'tab' = true): Promise<void> {
		const file = this.app.vault.getFileByPath(path);
		if (!file) {
			new Notice('The linked note was not found. It may have been moved outside Obsidian.');
			return;
		}
		await this.app.workspace.getLeaf(newLeaf === 'split' ? 'split' : newLeaf === false ? false : 'tab').openFile(file);
	}

	async read(entity: EntityRecord): Promise<string | null> {
		const file = this.file(entity);
		return file ? this.app.vault.cachedRead(file) : null;
	}

	private async ensureFolder(path: string): Promise<void> {
		const parts = path.split('/');
		let cur = '';
		for (const p of parts) {
			cur = cur ? `${cur}/${p}` : p;
			if (!this.app.vault.getAbstractFileByPath(cur)) {
				try {
					await this.app.vault.createFolder(cur);
				} catch {
					/* created concurrently */
				}
			}
		}
	}
}
