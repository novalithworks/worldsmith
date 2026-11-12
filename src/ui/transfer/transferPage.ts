import { Menu, Notice, setIcon } from 'obsidian';
import type { WorldsmithContext } from '../../app/context';
import type { WorldBackup } from '../../data/backup/BackupService';
import { parseCsv } from '../../services/transfer/csv';
import { exportCsv } from '../../services/transfer/csvExport';
import { buildNote, exportedNoteInfo, noteEntries, notePaths } from '../../services/transfer/notesExport';
import { exportTypePack, readTypePack } from '../../services/transfer/typePack';
import type { WorldSession } from '../../services/WorldSession';
import { button, cx, icon, nameRegion } from '../components/dom';
import type { RouteContext, RouteDefinition } from '../views/routes/RouteRegistry';
import { ExportArchiveModal, ImportArchiveModal, interruptedCard, VerifyArchiveModal } from './archiveModals';
import { ROUTES } from '../../state/route';
import { CsvImportModal } from './CsvImportModal';
import { dateStamp, ensureFolder, exportsFolder, parseJson, pickComputerFile, pickVaultFile, writeNewFile, type PickedFile } from './files';
import { TypePackModal, WorldImportModal } from './importModals';
import { own } from '../components/lifecycle';
import { MigrationModal, renderMigrations } from '../notes/migrationModal';

/**
 * Studio → Import & export (Milestone 9): move a whole world, share types, bring in a
 * spreadsheet, and write entries out as Markdown notes. Everything written lands in the vault
 * (Worldsmith/Exports by default) and never replaces a file it didn't write.
 */
export const transferRoute: RouteDefinition = {
	id: 'transfer',
	needsWorld: true,
	title: () => 'Import & export',
	icon: () => 'arrow-down-up',
	render(ctx) {
		new TransferPage(ctx, ctx.session!).mount();
	},
};

/** “From your vault” or “From this device”, then the file's text. */
export function chooseFile(ws: WorldsmithContext, anchor: HTMLElement, exts: string[], what: string, binary = false): Promise<PickedFile | null> {
	return new Promise((resolve) => {
		const m = new Menu();
		let chose = false;
		m.addItem((i) =>
			i
				.setTitle('From your vault…')
				.setIcon('vault')
				.onClick(() => {
					chose = true;
					void pickVaultFile(ws.app, exts, `Choose ${what} in your vault…`, binary).then(resolve);
				}),
		);
		m.addItem((i) =>
			i
				.setTitle('From this device…')
				.setIcon('hard-drive-upload')
				.onClick(() => {
					chose = true;
					void pickComputerFile(exts.map((e) => `.${e}`).join(','), binary).then(resolve);
				}),
		);
		m.onHide(() => window.setTimeout(() => !chose && resolve(null), 0));
		const r = anchor.getBoundingClientRect();
		m.showAtPosition({ x: r.left, y: r.bottom + 4 }, anchor.ownerDocument);
	});
}

class TransferPage {
	private selectedTypes = new Set<string>();
	private notesTypes = new Set<string>();

	constructor(
		private readonly ctx: RouteContext,
		private readonly s: WorldSession,
	) {
		const ids = s.schemas.list().map((t) => t.id);
		this.selectedTypes = new Set();
		this.notesTypes = new Set(ids);
	}

	private get ws(): WorldsmithContext {
		return this.ctx.ws;
	}

	mount(): void {
		const page = this.ctx.el.createDiv({ cls: 'ws-page ws-page--transfer' });
		const head = page.createDiv({ cls: 'ws-studio-head' });
		icon(head.createDiv({ cls: 'ws-db-header__mark ws-tint--blue' }), 'arrow-down-up');
		const ht = head.createDiv({ cls: 'ws-db-header__text' });
		ht.createEl('h1', { cls: 'ws-db-header__title', text: 'Import & export' });
		ht.createDiv({ cls: 'ws-db-header__desc', text: `Move ${this.s.world.name} between vaults, share your types, bring in a spreadsheet, or write entries out as notes.` });
		const where = page.createDiv({ cls: 'ws-xfer__where' });
		icon(where, 'folder-output');
		where.createSpan({ text: 'Exports are saved in ' });
		where.createEl('code', { text: exportsFolder(this.ws) });
		where.createSpan({ text: ' — they sync with your vault and are never written over.' });

		const grid = page.createDiv({ cls: 'ws-xfer' });
		this.worldCard(grid);
		this.typesCard(grid);
		this.sheetCard(grid);
		this.notesCard(grid);
		this.nativeCard(grid);
		const focus = this.ctx.params.section;
		if (focus) window.setTimeout(() => page.querySelector(`[data-section="${focus}"]`)?.scrollIntoView({ block: 'start' }), 50);
	}

	private card(parent: HTMLElement, id: string, iconName: string, color: string, title: string, desc: string): HTMLElement {
		// Native notes spans the page's width (0.30.5): it lines up below both columns.
		const c = parent.createEl('section', { cls: cx('ws-xcard', `ws-tint--${color}`, id === 'native-notes' && 'ws-xcard--wide'), attr: { 'data-section': id } });
		const h = c.createDiv({ cls: 'ws-xcard__head' });
		const g = h.createSpan({ cls: 'ws-xcard__glyph' });
		setIcon(g, iconName);
		const t = h.createDiv();
		t.createEl('h2', { cls: 'ws-xcard__title', text: title });
		t.createDiv({ cls: 'ws-xcard__desc', text: desc });
		return c.createDiv({ cls: 'ws-xcard__body' });
	}

	private action(parent: HTMLElement, iconName: string, title: string, hint: string, label: string, run: (btn: HTMLElement) => void, cls = ''): HTMLElement {
		const row = parent.createDiv({ cls: cx('ws-xact', cls) });
		const g = row.createSpan({ cls: 'ws-xact__icon' });
		setIcon(g, iconName);
		const t = row.createDiv({ cls: 'ws-xact__text' });
		t.createDiv({ cls: 'ws-xact__title', text: title });
		t.createDiv({ cls: 'ws-xact__hint', text: hint });
		const b = button(row, { label, variant: 'ghost', size: 'sm', cls: 'ws-xact__btn', onClick: () => run(b) });
		return row;
	}

	/** A wrapping set of type chips with “All” and “None”. */
	private chipGroup(body: HTMLElement, label: string, set: Set<string>, repaint: () => void): HTMLElement {
		const tools = body.createDiv({ cls: 'ws-xtypes__tools' });
		tools.createSpan({ cls: 'ws-xtypes__label', text: label });
		const all = tools.createEl('button', { cls: 'ws-xtypes__link', text: 'All', attr: { type: 'button' } });
		const none = tools.createEl('button', { cls: 'ws-xtypes__link', text: 'None', attr: { type: 'button' } });
		all.addEventListener('click', () => {
			for (const t of this.s.schemas.list()) set.add(t.id);
			repaint();
		});
		none.addEventListener('click', () => {
			set.clear();
			repaint();
		});
		const pick = body.createDiv({ cls: 'ws-xtypes', attr: { role: 'group' } });
		nameRegion(pick, label);
		return pick;
	}

	// ── world ────────────────────────────────────────────────────────────────

	private worldCard(grid: HTMLElement): void {
		const body = this.card(grid, 'world', 'globe-2', 'purple', 'Whole world', 'One .worldsmith.zip archive with everything this world needs in another vault: entries, types, connections, layouts, maps, calendars, the Writing Studio, notes and images.');
		// Imports that were cut short (Obsidian closed mid-import) can be undone here.
		const alerts = body.createDiv({ cls: 'ws-arch-alerts' });
		void this.ws.archives.interrupted().then((list) => {
			for (const j of list) interruptedCard(alerts, this.ws, j, () => undefined);
		});
		this.action(body, 'file-output', `Export ${this.s.world.name}`, 'Includes the notes and images it uses; you choose which of your own notes go along. Checked after saving.', 'Export…', () => new ExportArchiveModal(this.ws).open(), 'ws-xact--export-world');
		this.action(body, 'file-input', 'Import a world', 'Adds it as a world of its own, after showing what’s inside. Nothing in your vault is written over.', 'Choose archive…', (b) => void this.importArchive(b), 'ws-xact--import-world');
		this.action(body, 'shield-check', 'Verify an archive', 'Checks that an archive is complete and undamaged, without importing anything.', 'Choose archive…', (b) => void this.verifyArchive(b), 'ws-xact--verify-world');
		const note = body.createDiv({ cls: 'ws-xcard__note' });
		icon(note, 'history');
		// One sentence, with the link inside it (0.30.5: it no longer wraps on its own).
		const sentence = note.createSpan({ cls: 'ws-xcard__sentence', text: 'An archive is for moving or keeping a world. Backups you can go back to are in ' });
		const bl = sentence.createEl('button', { cls: 'ws-xtypes__link ws-xfer__backups', text: 'Backups & recovery', attr: { type: 'button' } });
		bl.addEventListener('click', () => this.ctx.navigate({ name: 'backups', params: {} }));
		sentence.append('.');
		const older = body.createDiv({ cls: 'ws-xcard__note ws-xcard__note--link' });
		icon(older, 'file-json');
		const link = older.createEl('button', { cls: 'ws-xtypes__link ws-xact--import-json', text: 'Import an older world file (.json)', attr: { type: 'button' } });
		link.addEventListener('click', () => void this.importWorld(link));
	}

	private async importArchive(anchor: HTMLElement): Promise<void> {
		const file = await chooseFile(this.ws, anchor, ['zip'], 'a world archive', true);
		if (!file?.bytes) return;
		new ImportArchiveModal(this.ws, { name: file.name, bytes: file.bytes }, () => this.ctx.navigate(ROUTES.dashboard())).open();
	}

	private async verifyArchive(anchor: HTMLElement): Promise<void> {
		const file = await chooseFile(this.ws, anchor, ['zip'], 'a world archive', true);
		if (!file?.bytes) return;
		new VerifyArchiveModal(this.ws, { name: file.name, bytes: file.bytes }).open();
	}

	private async importWorld(anchor: HTMLElement): Promise<void> {
		const file = await chooseFile(this.ws, anchor, ['json'], 'a world file');
		if (!file) return;
		const parsed = parseJson(file.text);
		if ('error' in parsed) return void new Notice(parsed.error);
		new WorldImportModal(this.ws, parsed.value as WorldBackup, () => this.ctx.navigate(ROUTES.dashboard())).open();
	}

	// ── types ────────────────────────────────────────────────────────────────

	private typesCard(grid: HTMLElement): void {
		const body = this.card(grid, 'types', 'shapes', 'green', 'Types', 'Share entity types — fields, sections, cards, checklist and page layout — with another world. Entries aren’t included.');
		const pick = this.chipGroup(body, 'Types to export', this.selectedTypes, () => paint());
		const exportBtn = button(body, { label: 'Export selected types', icon: 'file-output', variant: 'primary', size: 'sm', cls: 'ws-xtypes__export', onClick: () => void this.exportTypes() });
		const paint = () => {
			pick.empty();
			for (const t of this.s.schemas.list()) {
				const on = this.selectedTypes.has(t.id);
				const chip = pick.createEl('button', { cls: cx('ws-xchip', on && 'is-on', t.color && `ws-tint--${t.color}`), attr: { type: 'button', 'aria-pressed': String(on), 'data-type': t.id } });
				icon(chip, t.icon);
				chip.createSpan({ text: t.plural });
				chip.addEventListener('click', () => {
					if (on) this.selectedTypes.delete(t.id);
					else this.selectedTypes.add(t.id);
					paint();
				});
			}
			exportBtn.disabled = !this.selectedTypes.size;
			exportBtn.querySelector('.ws-btn__label')?.setText(this.selectedTypes.size ? `Export ${this.selectedTypes.size} type${this.selectedTypes.size === 1 ? '' : 's'}` : 'Choose types to export');
		};
		paint();
		this.action(body, 'file-input', 'Import types', 'From a type file exported by Worldsmith.', 'Choose file…', (b) => void this.importTypes(b), 'ws-xact--import-types');
	}

	private busy = false;

	private async exportTypes(): Promise<void> {
		const ids = [...this.selectedTypes];
		if (!ids.length || this.busy) return;
		this.busy = true;
		const pack = exportTypePack(this.s, ids);
		const name = ids.length === 1 ? (this.s.schemas.get(ids[0]!)?.plural ?? 'Type') : `${this.s.world.name} types`;
		try {
			const path = await writeNewFile(this.ws.app, exportsFolder(this.ws), `${name} ${dateStamp()}`, 'json', JSON.stringify(pack, null, '\t'));
			new Notice(`Exported ${ids.length} type${ids.length === 1 ? '' : 's'} to ${path}`);
		} catch (e) {
			new Notice(`Export failed: ${e instanceof Error ? e.message : String(e)}`);
		} finally {
			this.busy = false;
		}
	}

	private async importTypes(anchor: HTMLElement): Promise<void> {
		const file = await chooseFile(this.ws, anchor, ['json'], 'a type file');
		if (!file) return;
		const parsed = parseJson(file.text);
		if ('error' in parsed) return void new Notice(parsed.error);
		const res = readTypePack(parsed.value);
		if ('error' in res) return void new Notice(res.error);
		new TypePackModal(this.ws, this.s, res.pack, (ids) => ids[0] && this.ctx.navigate({ name: 'type-studio', params: { typeId: ids[0] } })).open();
	}

	// ── spreadsheets ─────────────────────────────────────────────────────────

	private sheetCard(grid: HTMLElement): void {
		const body = this.card(grid, 'spreadsheet', 'sheet', 'cyan', 'Spreadsheets (CSV)', 'Bring in a list from Excel, Google Sheets or Numbers — or take one out to edit and bring back.');
		this.action(body, 'file-input', 'Import a spreadsheet', 'Rows become entries; columns are matched to fields. You see what will happen first, and can undo.', 'Choose file…', (b) => void this.importCsv(b), 'ws-xact--import-csv');
		const row = body.createDiv({ cls: 'ws-xact ws-xact--export-csv' });
		const g = row.createSpan({ cls: 'ws-xact__icon' });
		setIcon(g, 'file-output');
		const t = row.createDiv({ cls: 'ws-xact__text' });
		t.createDiv({ cls: 'ws-xact__title', text: 'Export a type' });
		t.createDiv({ cls: 'ws-xact__hint', text: 'Every entry with every field, ready to import again.' });
		const sel = row.createEl('select', { cls: 'dropdown ws-xact__sel', attr: { 'aria-label': 'Type to export' } });
		for (const ty of this.s.schemas.list()) sel.createEl('option', { value: ty.id, text: `${ty.plural} (${this.s.index.ofType(ty.id, { includeArchived: true }).length})` });
		button(row, { label: 'Export', variant: 'ghost', size: 'sm', cls: 'ws-xact__btn', onClick: () => void exportTypeCsv(this.ws, this.s, sel.value) });
	}

	private async importCsv(anchor: HTMLElement): Promise<void> {
		const file = await chooseFile(this.ws, anchor, ['csv', 'tsv', 'txt'], 'a spreadsheet (.csv)');
		if (!file) return;
		if (!this.s.schemas.list().length) return void new Notice('Create a type first — rows are imported as entries of a type.');
		const table = parseCsv(file.text);
		if (!table.rows.length) return void new Notice('That file has no rows under its header line.');
		new CsvImportModal(this.ws, this.s, table, file.name).open();
	}

	// ── notes ────────────────────────────────────────────────────────────────

	private notesCard(grid: HTMLElement): void {
		const body = this.card(grid, 'notes', 'file-text', 'orange', 'Markdown notes', 'Write entries out as ordinary notes: properties at the top, then the summary and every section, with links between them.');
		const pick = this.chipGroup(body, 'Types to write as notes', this.notesTypes, () => paint());
		const folderRow = body.createDiv({ cls: 'ws-xfield' });
		folderRow.createSpan({ cls: 'ws-xfield__label', text: 'Folder' });
		const folder = folderRow.createEl('input', { cls: 'ws-input ws-xnotes__folder', attr: { type: 'text', spellcheck: 'false', 'aria-label': 'Folder for the notes' } });
		folder.value = `${exportsFolder(this.ws)}/Notes`;
		const opts = body.createDiv({ cls: 'ws-xopts' });
		const check = (label: string, on: boolean, cls: string) => {
			const l = opts.createEl('label', { cls: `ws-xcheck ${cls}` });
			const cb = l.createEl('input', { attr: { type: 'checkbox' } });
			cb.checked = on;
			l.createSpan({ text: label });
			return cb;
		};
		const links = check('Link connected entries with [[wikilinks]]', true, 'ws-xnotes__links');
		const skipEmpty = check('Leave out empty fields', true, 'ws-xnotes__skip');
		const go = button(body, { label: 'Write notes', icon: 'file-output', variant: 'primary', size: 'sm', cls: 'ws-xnotes__go', onClick: () => void this.exportNotes(folder.value, links.checked, skipEmpty.checked, go) });
		const paint = () => {
			pick.empty();
			for (const t of this.s.schemas.list()) {
				const n = noteEntries(this.s, [t.id]).length;
				const on = this.notesTypes.has(t.id);
				const chip = pick.createEl('button', { cls: cx('ws-xchip', on && 'is-on', t.color && `ws-tint--${t.color}`, !n && 'is-empty'), attr: { type: 'button', 'aria-pressed': String(on), 'data-type': t.id } });
				icon(chip, t.icon);
				chip.createSpan({ text: t.plural });
				chip.createSpan({ cls: 'ws-xchip__n', text: String(n) });
				chip.addEventListener('click', () => {
					if (on) this.notesTypes.delete(t.id);
					else this.notesTypes.add(t.id);
					paint();
				});
			}
			const total = noteEntries(this.s, [...this.notesTypes]).length;
			go.disabled = !total;
			go.querySelector('.ws-btn__label')?.setText(total ? `Write ${total} note${total === 1 ? '' : 's'}` : 'Nothing to write');
		};
		paint();
		body.createDiv({ cls: 'ws-xcard__note-plain', text: 'These are copies: editing them doesn’t change Worldsmith (native notes, below, do). Writing again updates the notes from last time — except notes you’ve edited since, which are left as they are. A note of your own with the same name is never touched: the export gets a numbered name instead.' });
	}

	// ── native notes (0.17) ──────────────────────────────────────────────────

	private nativeCard(grid: HTMLElement): void {
		const body = this.card(grid, 'native-notes', 'file-check', 'blue', 'Native notes', 'Make Obsidian notes the home of your entries: Properties for the facts, sections for the writing, edited in either place. Opt-in; you see what will happen first, and can undo.');
		const paint = () => {
			body.empty();
			this.action(body, 'globe-2', `All of ${this.s.world.name}`, 'Every entry that has no native note yet (archived and trashed entries are skipped).', 'Dry run…', () => new MigrationModal(this.ws, { kind: 'world' }).open(), 'ws-xact--native-world');
			const row = body.createDiv({ cls: 'ws-xact ws-xact--native-type' });
			setIcon(row.createSpan({ cls: 'ws-xact__icon' }), 'shapes');
			const t = row.createDiv({ cls: 'ws-xact__text' });
			t.createDiv({ cls: 'ws-xact__title', text: 'One type' });
			t.createDiv({ cls: 'ws-xact__hint', text: 'Try one type first.' });
			const sel = row.createEl('select', { cls: 'dropdown ws-xact__sel', attr: { 'aria-label': 'Type' } });
			for (const ty of this.s.schemas.list()) sel.createEl('option', { value: ty.id, text: ty.plural });
			button(row, { label: 'Dry run…', variant: 'ghost', size: 'sm', cls: 'ws-xact__btn', onClick: () => new MigrationModal(this.ws, { kind: 'type', id: sel.value }).open() });
			renderMigrations(body, this.ws, paint);
		};
		paint();
		own(this.ctx.component, this.ws.events.on('native-note:status', ({ entityId }) => !entityId && paint()));
	}

	private async exportNotes(folderValue: string, wikilinks: boolean, skipEmpty: boolean, btn: HTMLButtonElement): Promise<void> {
		const folder = folderValue.trim().replace(/^\/+|\/+$/g, '') || `${exportsFolder(this.ws)}/Notes`;
		btn.disabled = true;
		try {
			const res = await writeNotes(this.ws, this.s, [...this.notesTypes], { folder, wikilinks, skipEmpty });
			const n = res.created + res.updated;
			const parts = [`Wrote ${n} note${n === 1 ? '' : 's'} to ${folder}${res.updated ? ` (${res.updated} updated)` : ''}.`];
			if (res.kept) parts.push(`${res.kept} note${res.kept === 1 ? ' that changed' : 's that changed'} since the last export ${res.kept === 1 ? 'was' : 'were'} left as ${res.kept === 1 ? 'it is' : 'they are'}.`);
			if (res.renamed) parts.push(`${res.renamed} got a numbered name because another note already has that name.`);
			new Notice(parts.join(' '), 10000);
		} catch (e) {
			new Notice(`Export failed: ${e instanceof Error ? e.message : String(e)}`);
		} finally {
			btn.disabled = false;
		}
	}
}

/** One type to CSV in the exports folder. */
export async function exportTypeCsv(ws: WorldsmithContext, s: WorldSession, typeId: string, entries?: Parameters<typeof exportCsv>[3], name?: string, fieldIds?: string[] | null): Promise<void> {
	const schema = s.schemas.get(typeId);
	if (!schema) return;
	const list = entries ?? s.index.ofType(typeId, { includeArchived: true }).sort((a, b) => a.name.localeCompare(b.name));
	try {
		const path = await writeNewFile(ws.app, exportsFolder(ws), `${name ?? schema.plural} ${dateStamp()}`, 'csv', exportCsv(s, ws.fieldTypes, schema, list, fieldIds));
		new Notice(`Exported ${list.length} ${list.length === 1 ? schema.singular.toLowerCase() : schema.plural.toLowerCase()} to ${path}`);
	} catch (e) {
		new Notice(`Export failed: ${e instanceof Error ? e.message : String(e)}`);
	}
}

/**
 * Write the notes. A free path gets a new note. A note this export wrote before (same entry
 * and world) is updated — unless it was edited since, then it's left exactly as it is.
 * Anything else at that path is the user's: the export takes the next free name instead.
 */
export async function writeNotes(ws: WorldsmithContext, s: WorldSession, typeIds: string[], o: { folder: string; wikilinks: boolean; skipEmpty: boolean }): Promise<{ created: number; updated: number; renamed: number; kept: number }> {
	const app = ws.app;
	const entries = noteEntries(s, typeIds);
	const wanted = notePaths(s, entries, o.folder);
	// First settle every note's final path (so links point at the right file), then write.
	const final = new Map<string, string>();
	const action = new Map<string, 'create' | 'update' | 'keep'>();
	const taken = new Set([...wanted.values()].map((p) => p.toLowerCase()));
	let renamed = 0;
	for (const e of entries) {
		const want = wanted.get(e.id)!;
		let path = want;
		for (let k = 1; ; k++) {
			path = k === 1 ? want : want.replace(/\.md$/, ` ${k}.md`);
			// A numbered name another entry of this export wants is skipped.
			if (k > 1 && taken.has(path.toLowerCase())) continue;
			const file = app.vault.getFileByPath(path);
			if (!file) {
				action.set(e.id, 'create');
				break;
			}
			const info = exportedNoteInfo(await app.vault.read(file));
			if (info && info.id === e.id && (info.world === null || info.world === s.worldId)) {
				action.set(e.id, info.edited ? 'keep' : 'update');
				break;
			}
			// A note of the user's (or another world's export) — never touched; take the next name.
			if (k === 1) renamed++;
		}
		taken.add(path.toLowerCase());
		final.set(e.id, path);
	}
	let created = 0;
	let updated = 0;
	let kept = 0;
	for (const e of entries) {
		const path = final.get(e.id)!;
		const what = action.get(e.id);
		if (what === 'keep') {
			kept++;
			continue;
		}
		const content = buildNote(s, ws.fieldTypes, e, s.schemas.get(e.typeId)!, final, o);
		await ensureFolder(app, path.slice(0, path.lastIndexOf('/')));
		const file = app.vault.getFileByPath(path);
		if (file && what === 'update') {
			// Re-check right before writing: never replace a note edited in the meantime.
			const info = exportedNoteInfo(await app.vault.read(file));
			if (!info || info.id !== e.id || info.edited) {
				kept++;
				continue;
			}
			if ((await app.vault.read(file)) !== content) await app.vault.modify(file, content);
			updated++;
		} else if (!file) {
			await app.vault.create(path, content);
			created++;
		}
	}
	return { created, updated, renamed, kept };
}
