import { FuzzySuggestModal, Menu, Notice, TFile, type App } from 'obsidian';
import type { WorldsmithContext } from '../../app/context';
import type { EntityRecord, NativeNote, NoteTemplate } from '../../core/types';
import { button, cx, icon } from '../components/dom';
import { relativeTime } from '../../core/util/strings';
import { ACCENTS } from './noteStudio';
import { confirmModal, WorldsmithModal } from '../components/modals';
import { actionNotice } from '../components/notice';
import { MigrationModal } from './migrationModal';
import { NoteConflictModal, restoreSnapshot, snapshot } from './conflicts';

/**
 * Native note actions on an entry (0.17): the note menu on the entry page and the
 * "Native note" items of the entry's ⋯ menu. Everything here asks before it changes a
 * note the person wrote, and offers Undo afterwards.
 */

const cur = (ws: WorldsmithContext, id: string) => ws.worlds.session?.entities.get(id) ?? null;

function statusText(ws: WorldsmithContext, e: EntityRecord): { label: string; tone: 'ok' | 'warn' | 'muted' } {
	const st = ws.nativeNotes.state(e);
	switch (st.status) {
		case 'ok':
			return { label: 'In sync', tone: 'ok' };
		case 'pending':
			return { label: 'Syncing…', tone: 'muted' };
		case 'conflict':
			return { label: `${st.conflicts.length || 1} ${st.conflicts.length === 1 ? 'item needs' : 'items need'} a decision`, tone: 'warn' };
		case 'missing':
			return { label: 'Note not found', tone: 'warn' };
		case 'broken':
			return { label: 'A marker is damaged', tone: 'warn' };
		default:
			return { label: 'No native note', tone: 'muted' };
	}
}

function templateLabel(ws: WorldsmithContext, e: EntityRecord): string {
	const s = ws.worlds.session;
	const schema = s?.schemas.get(e.typeId);
	if (!s || !schema) return '';
	const { template, override } = s.noteTemplates.forEntity(e, schema);
	return `${template.name}${override ? '' : ' (type default)'}`;
}

/** Create the entry's native note, open it, and offer Undo. */
export async function createNativeNote(ws: WorldsmithContext, entity: EntityRecord, opts: { open?: boolean; templateId?: string } = {}): Promise<TFile | null> {
	const e = cur(ws, entity.id);
	if (!e) return null;
	const before = { linkedNote: e.linkedNote, moreNotes: e.moreNotes.map((n) => ({ ...n })), nativeNote: e.nativeNote ?? null };
	const file = await ws.nativeNotes.create(e, e.nativeNote?.status === 'missing' ? { path: e.nativeNote.path, templateId: e.nativeNote.templateId } : opts.templateId ? { templateId: opts.templateId } : {});
	if (!file) return null;
	const written = await ws.app.vault.read(file);
	actionNotice(`Created the native note “${file.basename}”.`, {
		label: 'Undo',
		run: () =>
			void (async () => {
				const f = ws.app.vault.getFileByPath(file.path);
				const now = cur(ws, entity.id);
				if (f && (await ws.app.vault.read(f)) !== written) {
					new Notice('The note was edited since, so it was kept. It is unlinked from the entry.');
				} else if (f) await ws.app.fileManager.trashFile(f);
				if (now) {
					ws.nativeNotes.unlink(now);
					ws.worlds.session?.entityService.update(now.id, { linkedNote: before.linkedNote, moreNotes: before.moreNotes, nativeNote: before.nativeNote });
				}
			})(),
	});
	if (opts.open !== false) await ws.nativeNotes.open(cur(ws, entity.id) ?? e);
	void ws.noteStyles?.afterNoteCreated();
	return file;
}

/** Make an existing note the native note (its text stays word for word). */
export async function linkNativeNote(ws: WorldsmithContext, entity: EntityRecord, file: TFile): Promise<void> {
	const e = cur(ws, entity.id);
	if (!e) return;
	const text = await ws.app.vault.read(file);
	const ok = await confirmModal(ws.app, {
		title: `Make “${file.basename}” the native note of ${e.name}?`,
		body: 'Worldsmith adds its Properties and its marked parts to the note (at the top, and the “Open in Worldsmith” link at the end). Every word of your text stays where it is. Values that differ between the note and Worldsmith are shown to you to decide; nothing is overwritten. You can undo.',
		confirmLabel: 'Link the note',
	});
	if (!ok) return;
	const before = { linkedNote: e.linkedNote, moreNotes: e.moreNotes.map((n) => ({ ...n })), nativeNote: e.nativeNote ?? null, values: { ...e.values }, description: e.description, aliases: [...e.aliases], tags: [...e.tags], status: e.status };
	const res = await ws.nativeNotes.link(e, file);
	if (!res.ok) {
		new Notice(res.error ?? 'Couldn’t link that note.');
		return;
	}
	const written = await ws.app.vault.read(file);
	const after = cur(ws, e.id);
	actionNotice(after?.nativeNote?.conflicts?.length ? `Linked. ${after.nativeNote.conflicts.length} value(s) differ: choose what to keep.` : `“${file.basename}” is now the native note.`, {
		label: 'Undo',
		run: () =>
			void (async () => {
				const now = cur(ws, e.id);
				if (!now) return;
				ws.nativeNotes.unlink(now);
				const ok2 = await restoreSnapshot(ws, { entityId: e.id, path: file.path, text, entity: { values: before.values, description: before.description, aliases: before.aliases, tags: before.tags, status: before.status, nativeNote: before.nativeNote } }, written);
				if (ok2) ws.worlds.session?.entityService.update(e.id, { linkedNote: before.linkedNote, moreNotes: before.moreNotes, nativeNote: before.nativeNote });
			})(),
	});
	if (after?.nativeNote?.conflicts?.length) new NoteConflictModal(ws, after, after.nativeNote.conflicts).open();
}

/** Pick any Markdown note of the vault (not Worldsmith's data). */
export class VaultNotePicker extends FuzzySuggestModal<TFile> {
	constructor(
		app: App,
		private readonly ws: WorldsmithContext,
		private readonly onPick: (f: TFile) => void,
		placeholder = 'Choose the note to link…',
	) {
		super(app);
		this.modalEl.addClass('worldsmith-modal');
		this.setPlaceholder(placeholder);
	}
	getItems(): TFile[] {
		const root = this.ws.db.root;
		return this.app.vault
			.getMarkdownFiles()
			.filter((f) => !root || !f.path.startsWith(`${root}/`))
			.filter((f) => !this.ws.nativeNotes.entryOf(f.path))
			.sort((a, b) => b.stat.mtime - a.stat.mtime);
	}
	getItemText(f: TFile): string {
		return f.path;
	}
	onChooseItem(f: TFile): void {
		this.onPick(f);
	}
}

/** Change the template of one entry's note (presentation only; every value is kept). */
export class TemplatePickerModal extends WorldsmithModal {
	constructor(
		private readonly ws: WorldsmithContext,
		private readonly entity: EntityRecord,
	) {
		super(ws.app);
		this.modalEl.addClass('ws-nnpick');
	}

	/**
	 * Choose a note template (0.17.2): cards with a small picture of each template, the one in
	 * use ticked, "Use for: only this entry / every entry of the type", Preview first (Layout
	 * Studio), and Undo after. Only Worldsmith's parts of the note change.
	 */
	override onOpen(): void {
		const s = this.ws.worlds.session;
		const e = cur(this.ws, this.entity.id);
		const schema = e ? s?.schemas.get(e.typeId) : undefined;
		if (!s || !e || !schema) return this.close();
		const creating = !e.nativeNote;
		const typeDefault = s.noteTemplates.forType(schema);
		const own = e.nativeNote?.templateId && s.noteTemplates.get(e.nativeNote.templateId) ? e.nativeNote.templateId : null;
		const current = own ?? typeDefault.id;
		let chosen = current;
		let scope: 'entry' | 'type' = 'entry';
		const ofType = s.entities.all().filter((x) => x.typeId === schema.id && !x.trashedAt).length;
		const c = this.contentEl;
		c.createDiv({ cls: 'ws-nnpick__eyebrow', text: `Native note · ${e.name}` });
		c.createEl('h2', { cls: 'ws-nnpick__title', text: creating ? 'Choose a template for the new note' : 'Choose a note template' });
		c.createEl('p', { cls: 'ws-nnpick__lede', text: 'Templates change how the note looks and which sections it has. Your data and your own writing are never removed — sections you take out stay in Worldsmith and in the note’s Properties.' });
		const grid = c.createDiv({ cls: 'ws-nnpick__grid', attr: { role: 'radiogroup', 'aria-label': 'Note templates' } });
		const cards = new Map<string, HTMLElement>();
		const paint = () => {
			for (const [id, el] of cards) {
				el.toggleClass('is-chosen', id === chosen);
				el.setAttr('aria-checked', String(id === chosen));
			}
			const t = s.noteTemplates.get(chosen);
			use.querySelector('.ws-btn__label')?.setText(t ? `Use ${t.name}` : 'Use');
		};
		const list = s.noteTemplates.list();
		for (const t of list) {
			const card = grid.createEl('button', { cls: 'ws-nnpick__card', attr: { type: 'button', role: 'radio', 'data-template': t.id } });
			templateMini(card.createDiv({ cls: 'ws-nnpick__mini', attr: { 'aria-hidden': 'true' } }), t);
			const row = card.createDiv({ cls: 'ws-nnpick__name' });
			row.createSpan({ cls: 'ws-nnpick__name-text', text: t.name });
			row.createSpan({ cls: cx('ws-nnpick__badge', t.id === typeDefault.id && 'is-default'), text: t.id === typeDefault.id ? 'Type default' : t.id === 'custom-entity' ? 'any type' : t.builtIn ? 'built in' : 'yours' });
			icon(card, 'check', 'ws-nnpick__tick');
			card.createDiv({ cls: 'ws-nnpick__desc', text: t.description || 'Your template' });
			card.addEventListener('click', () => {
				chosen = t.id;
				paint();
			});
			card.addEventListener('dblclick', () => void apply());
			cards.set(t.id, card);
		}
		const own2 = grid.createEl('button', { cls: 'ws-nnpick__card ws-nnpick__card--new', attr: { type: 'button' } });
		// The last card fills what's left of the last row, at 4, 3 or 2 columns.
		const total = list.length + 1;
		for (const n of [4, 3, 2]) own2.style.setProperty(`--span-${n}`, String(1 + ((n - (total % n)) % n)));
		const m = own2.createDiv({ cls: 'ws-nnpick__mini is-blank', attr: { 'aria-hidden': 'true' } });
		icon(m, 'plus', 'ws-nnpick__plus');
		own2.createDiv({ cls: 'ws-nnpick__name' }).createSpan({ cls: 'ws-nnpick__name-text', text: 'Make your own' });
		own2.createDiv({ cls: 'ws-nnpick__desc', text: 'Opens Layout Studio → Native note, to customise a copy or start from your page' });
		own2.addEventListener('click', () => {
			this.close();
			void this.ws.open({ name: 'layout-studio', params: { typeId: schema.id, target: 'note', sample: e.id } });
		});

		const foot = c.createDiv({ cls: 'ws-nnpick__foot' });
		const left = foot.createDiv({ cls: 'ws-nnpick__scope' });
		left.createSpan({ cls: 'ws-nnpick__scope-label', text: 'Use for' });
		const seg = left.createDiv({ cls: 'ws-segmented ws-segmented--sm', attr: { role: 'radiogroup', 'aria-label': 'Use for' } });
		const segBtns: HTMLElement[] = [];
		for (const [id, label] of [
			['entry', `Only ${e.name}`],
			['type', `All ${schema.plural} (${ofType})`],
		] as const) {
			const b = seg.createEl('button', { cls: cx('ws-segmented__item', id === scope && 'is-active'), attr: { type: 'button', role: 'radio', 'aria-checked': String(id === scope), 'data-scope': id }, text: label });
			segBtns.push(b);
			b.addEventListener('click', () => {
				scope = id;
				for (const x of segBtns) {
					const on = x.dataset.scope === id;
					x.toggleClass('is-active', on);
					x.setAttr('aria-checked', String(on));
				}
				paint();
			});
		}
		const right = foot.createDiv({ cls: 'ws-nnpick__actions' });
		button(right, {
			label: 'Preview first',
			variant: 'ghost',
			cls: 'ws-nnpick__preview',
			onClick: () => {
				this.close();
				void this.ws.open({ name: 'layout-studio', params: { typeId: schema.id, target: 'note', template: chosen, sample: e.id } });
			},
		});
		button(right, { label: 'Cancel', variant: 'ghost', onClick: () => this.close() });
		const use = button(right, { label: 'Use', variant: 'primary', cls: 'ws-nnpick__use mod-cta', onClick: () => void apply() });
		const safe = c.createDiv({ cls: 'ws-nnpick__safe' });
		icon(safe, 'undo-2');
		safe.createSpan({ text: creating ? 'Worldsmith adds its parts to the new note; Undo takes the note away again.' : 'Switching rewrites only the Worldsmith-managed parts of the note; Undo puts the old version back.' });

		const apply = async () => {
			const tplId = chosen;
			const t = s.noteTemplates.get(tplId);
			this.close();
			if (!creating && scope === 'entry' && tplId === current) return;
			if (scope === 'type') {
				const prevType = tplId !== typeDefault.id ? s.noteTemplates.assign(schema.id, tplId) : undefined;
				const now = cur(this.ws, e.id);
				const prevOwn = now?.nativeNote?.templateId ? this.ws.nativeNotes.setTemplate(now, null) : undefined;
				if (creating) {
					await createNativeNote(this.ws, e);
					return;
				}
				actionNotice(`${schema.plural} notes now use ${t?.name ?? 'that template'}.`, {
					label: 'Undo',
					run: () => {
						if (prevType !== undefined) s.noteTemplates.assign(schema.id, prevType);
						const n = cur(this.ws, e.id);
						if (n && prevOwn !== undefined) this.ws.nativeNotes.setTemplate(n, prevOwn);
					},
				});
				return;
			}
			const id = tplId === typeDefault.id ? null : tplId;
			if (creating) {
				await createNativeNote(this.ws, e, id ? { templateId: id } : {});
				return;
			}
			const now = cur(this.ws, e.id);
			if (!now) return;
			const prev = this.ws.nativeNotes.setTemplate(now, id);
			actionNotice(`${e.name}’s note now uses ${t?.name ?? 'that template'}.`, {
				label: 'Undo',
				run: () => {
					const n = cur(this.ws, e.id);
					if (n) this.ws.nativeNotes.setTemplate(n, prev);
				},
			});
		};
		paint();
		cards.get(chosen)?.focus();
	}

	override onClose(): void {
		this.contentEl.empty();
	}
}

/**
 * A small picture of a template, the same frame for every card: an optional banner, the
 * kicker and title, two lines of text, the portrait card (right, left or none) and the facts
 * box, in the template's accent. Positions are fractions of the frame, so all cards match.
 */
function templateMini(el: HTMLElement, t: NoteTemplate): void {
	const shown = (k: string) => t.sections.some((x) => x.kind === k && !x.hidden);
	const accent = ACCENTS.find((a) => a[0] === t.appearance.accent)?.[2] ?? '#bb915e';
	el.style.setProperty('--mini', accent);
	const centred = t.appearance.style === 'chronicle';
	const card = shown('infocard') && t.appearance.portrait !== 'none' && !centred;
	el.addClass(centred ? 'is-centred' : card ? (t.appearance.portrait === 'left' ? 'is-card-left' : 'is-card-right') : 'is-plain');
	if (shown('banner')) el.addClass('has-banner');
	if (shown('banner')) el.createDiv({ cls: 'ws-nnpick__m-banner' });
	const body = el.createDiv({ cls: 'ws-nnpick__m-body' });
	body.createDiv({ cls: 'ws-nnpick__m-kicker' });
	body.createDiv({ cls: 'ws-nnpick__m-name' });
	body.createDiv({ cls: 'ws-nnpick__m-line' });
	body.createDiv({ cls: 'ws-nnpick__m-line is-short' });
	if (shown('facts') || shown('schemaSections')) body.createDiv({ cls: 'ws-nnpick__m-box' });
	if (card) el.createDiv({ cls: 'ws-nnpick__m-card' }).createDiv({ cls: 'ws-nnpick__m-portrait' });
}

/** What the note's sync looks like, and what can be done about it. */
export class NoteStatusModal extends WorldsmithModal {
	constructor(
		private readonly ws: WorldsmithContext,
		private readonly entity: EntityRecord,
	) {
		super(ws.app);
		this.modalEl.addClass('ws-nn-status-modal');
	}

	override onOpen(): void {
		void this.paint();
	}

	private async paint(): Promise<void> {
		const e = cur(this.ws, this.entity.id);
		if (!e?.nativeNote) return this.close();
		const c = this.contentEl;
		c.empty();
		this.setTitle('Native note');
		const st = this.ws.nativeNotes.state(e);
		const t = statusText(this.ws, e);
		const head = c.createDiv({ cls: 'ws-nn-head' });
		head.createEl('b', { text: e.nativeNote.path.split('/').pop() ?? e.nativeNote.path });
		head.createSpan({ cls: `ws-nn-pill is-${t.tone}`, text: t.label });
		c.createDiv({ cls: 'ws-nn-faint', text: `${e.nativeNote.path} · template ${templateLabel(this.ws, e)}${st.lastSync ? ` · checked ${new Date(st.lastSync).toLocaleTimeString()}` : ''}` });
		const s = this.ws.worlds.session!;
		const schema = s.schemas.get(e.typeId);
		const input = this.ws.nativeNotes.planInput(e, '');
		if (input && schema) {
			const props = input.props.length;
			const fields = input.regions.filter((r) => r.kind === 'field').length;
			const links = s.relations.viewsOf(e.id).length;
			c.createEl('p', { cls: 'ws-nn-muted', text: `${props} properties · ${fields} text sections · ${links} connections. Short facts live in the note’s Properties and long writing in its sections; connections, images and layouts stay in Worldsmith and are shown read-only.` });
		}
		const list = c.createEl('ul', { cls: 'ws-nn-list' });
		if (st.conflicts.length) list.createEl('li', { text: `${st.conflicts.length} value(s) changed in both places. Nothing has been overwritten.` });
		for (const b of st.broken) list.createEl('li', { text: `A marker of “${b}” is missing or doubled, so Worldsmith leaves that part alone until it’s fixed (or the part is removed).` });
		for (const r of st.removed) list.createEl('li', { text: `“${r}” was removed from the note. Worldsmith won’t put it back unless you ask.` });
		for (const d of e.nativeNote.detached ?? []) list.createEl('li', { text: `“${d}” is kept as you edited it; Worldsmith no longer updates it.` });
		const row = c.createDiv({ cls: 'ws-modal-actions' });
		if (st.conflicts.length) button(row, { label: 'Decide…', variant: 'primary', onClick: () => { this.close(); new NoteConflictModal(this.ws, e, st.conflicts).open(); } });
		if (st.removed.length || e.nativeNote.detached?.length) {
			button(row, {
				label: 'Put Worldsmith’s parts back',
				onClick: () => void (async () => {
					const snap = await snapshot(this.ws, e);
					const resolve: Record<string, 'ws'> = {};
					for (const r of st.removed) resolve[`f:${r}`] = resolve[`v:${r}`] = 'ws';
					for (const d of e.nativeNote?.detached ?? []) resolve[`v:${d}`] = 'ws';
					const nn: NativeNote = { ...e.nativeNote! };
					delete nn.detached;
					s.entityService.update(e.id, { nativeNote: nn });
					await this.ws.nativeNotes.reconcile(e.id, resolve);
					const f = this.ws.nativeNotes.file(e);
					const written = f ? await this.ws.app.vault.read(f) : null;
					if (snap) actionNotice('Put back.', { label: 'Undo', run: () => void restoreSnapshot(this.ws, snap, written) });
					void this.paint();
				})(),
			});
		}
		button(row, {
			label: 'Check now',
			icon: 'refresh-cw',
			onClick: () => void (async () => {
				await this.ws.nativeNotes.reconcile(e.id);
				void this.paint();
			})(),
		});
		button(row, { label: 'Close', variant: 'ghost', onClick: () => this.close() });
	}

	override onClose(): void {
		this.contentEl.empty();
	}
}

/** Stop using the note as the native note (the note and every value stay). */
export function unlinkNativeNote(ws: WorldsmithContext, entity: EntityRecord): void {
	const e = cur(ws, entity.id);
	if (!e?.nativeNote) return;
	const before = { linkedNote: e.linkedNote, moreNotes: e.moreNotes.map((n) => ({ ...n })) };
	const nn = ws.nativeNotes.unlink(e);
	if (!nn) return;
	actionNotice('The note is no longer the native note (it stays a linked note, and its text is unchanged).', {
		label: 'Undo',
		run: () => {
			ws.nativeNotes.relink(e.id, nn);
			ws.worlds.session?.entityService.update(e.id, before);
		},
	});
}

/** The items of the native-note menu (the note button's menu, or a ⋯ submenu). */
export function addNativeNoteItems(menu: Menu, ws: WorldsmithContext, entity: EntityRecord, opts: { header?: boolean } = {}): void {
	const e = cur(ws, entity.id) ?? entity;
	const nn = e.nativeNote;
	if (nn && opts.header) {
		const t = statusText(ws, e);
		menu.addItem((i) => {
			i.setTitle(`${nn.path.split('/').pop()} · ${t.label}`).setIcon(t.tone === 'warn' ? 'alert-triangle' : 'check-circle-2');
			i.setIsLabel?.(true);
		});
		menu.addItem((i) => {
			i.setTitle(`Template: ${templateLabel(ws, e)}`).setIcon('layout-template');
			i.setIsLabel?.(true);
		});
		menu.addSeparator();
	}
	if (nn && nn.status !== 'missing') {
		menu.addItem((i) => i.setTitle('Open native note').setIcon('file-text').onClick((evt) => void ws.nativeNotes.open(e, evt instanceof MouseEvent && (evt.metaKey || evt.ctrlKey) ? 'split' : 'tab')));
		menu.addItem((i) => i.setTitle('Change note template…').setIcon('layout-template').onClick(() => new TemplatePickerModal(ws, e).open()));
		menu.addItem((i) => i.setTitle('Sync status and history').setIcon('refresh-cw').onClick(() => new NoteStatusModal(ws, e).open()));
		if (nn.conflicts?.length) menu.addItem((i) => i.setTitle('Decide what to keep…').setIcon('alert-triangle').onClick(() => new NoteConflictModal(ws, e, nn.conflicts!).open()));
		menu.addItem((i) => i.setTitle('Link a different note…').setIcon('link').onClick(() => new VaultNotePicker(ws.app, ws, (f) => void relinkTo(ws, e, f)).open()));
		menu.addItem((i) => i.setTitle('Stop using as native note').setIcon('unlink').onClick(() => unlinkNativeNote(ws, e)));
	} else if (nn?.status === 'missing') {
		menu.addItem((i) => i.setTitle('Create the native note again').setIcon('file-plus').onClick(() => void createNativeNote(ws, e)));
		menu.addItem((i) => i.setTitle('Relink to a note…').setIcon('link').onClick(() => new VaultNotePicker(ws.app, ws, (f) => void linkNativeNote(ws, e, f)).open()));
		menu.addItem((i) => i.setTitle('Stop using a native note').setIcon('unlink').onClick(() => unlinkNativeNote(ws, e)));
	} else {
		menu.addItem((i) => i.setTitle('Create native note').setIcon('file-plus').onClick(() => void createNativeNote(ws, e)));
		menu.addItem((i) => i.setTitle('Native note with a dry run and backup…').setIcon('flask-conical').onClick(() => new MigrationModal(ws, { kind: 'entry', id: e.id }).open()));
		menu.addItem((i) => i.setTitle('Link existing note…').setIcon('link').onClick(() => new VaultNotePicker(ws.app, ws, (f) => void linkNativeNote(ws, e, f)).open()));
		const linked = e.linkedNote ? ws.app.vault.getFileByPath(e.linkedNote.path) : null;
		if (linked && !ws.nativeNotes.entryOf(linked.path)) menu.addItem((i) => i.setTitle(`Make “${linked.basename}” the native note…`).setIcon('file-check').onClick(() => void linkNativeNote(ws, e, linked)));
	}
	const others = ws.linkedNotes.notes(e).filter((n) => n.path !== nn?.path);
	if (nn && others.length) {
		menu.addSeparator();
		for (const n of others.slice(0, 6)) menu.addItem((i) => i.setTitle(`Open ${n.label || n.path.split('/').pop()?.replace(/\.md$/, '')}`).setIcon('file').onClick(() => void ws.linkedNotes.openPath(n.path)));
	}
}

async function relinkTo(ws: WorldsmithContext, e: EntityRecord, f: TFile): Promise<void> {
	const ok = await confirmModal(ws.app, { title: `Use “${f.basename}” as the native note instead?`, body: 'The current native note stays in your vault as an ordinary linked note, unchanged.', confirmLabel: 'Continue' });
	if (!ok) return;
	const before = cur(ws, e.id)?.nativeNote;
	if (before) ws.nativeNotes.unlink(e);
	await linkNativeNote(ws, cur(ws, e.id) ?? e, f);
	const now = cur(ws, e.id);
	if (before && !now?.nativeNote) ws.nativeNotes.relink(e.id, before);
}

/** The entry page's note button, when the entry has a native note. */
export function nativeNoteMenu(ws: WorldsmithContext, entity: EntityRecord): Menu {
	const m = new Menu();
	addNativeNoteItems(m, ws, entity, { header: true });
	return m;
}

/** A new note for an entry, as the setting says: a native note (the default) or a plain linked note. */
export async function createEntryNote(ws: WorldsmithContext, entity: EntityRecord): Promise<TFile | null> {
	if (ws.settings.nativeNotes.newNotesNative) return createNativeNote(ws, entity);
	return ws.linkedNotes.create(entity);
}

/** Mark a menu item as the main choice (bold), where Obsidian's menu exposes its element. */
function primary(item: unknown): void {
	(item as { dom?: HTMLElement }).dom?.addClass('ws-menu-primary');
}

/**
 * The entry page's note button (0.17.1): always a small menu. An entry with a native note gets
 * its note menu. Otherwise: create a native note (the main choice, or a plain note when the
 * setting says so), turn the linked note into the native note (dry run, backup and Undo),
 * open the linked notes, or link one.
 */
export function entryNoteMenu(ws: WorldsmithContext, entity: EntityRecord): Menu {
	const e = cur(ws, entity.id) ?? entity;
	if (e.nativeNote) return nativeNoteMenu(ws, e);
	const m = new Menu();
	const nativeFirst = ws.settings.nativeNotes.newNotesNative;
	const linked = e.linkedNote ? ws.app.vault.getFileByPath(e.linkedNote.path) : null;
	if (!nativeFirst && !e.linkedNote) {
		m.addItem((i) => {
			i.setTitle('Create linked note').setIcon('file-plus').onClick(() => void ws.linkedNotes.create(e).then((f) => f && ws.linkedNotes.open(cur(ws, e.id) ?? e)));
			primary(i);
		});
	}
	m.addItem((i) => {
		i.setTitle('Create native note').setIcon('file-plus-2').onClick(() => void createNativeNote(ws, e));
		if (nativeFirst) primary(i);
	});
	m.addItem((i) => i.setTitle('Create native note with a template…').setIcon('layout-template').onClick(() => new TemplatePickerModal(ws, e).open()));
	if (linked && !ws.nativeNotes.entryOf(linked.path)) {
		m.addItem((i) => i.setTitle(`Turn “${linked.basename}” into the native note…`).setIcon('file-check').onClick(() => new MigrationModal(ws, { kind: 'entry', id: e.id }).open()));
	}
	m.addSeparator();
	const all = ws.linkedNotes.notes(e);
	if (e.linkedNote) m.addItem((i) => i.setTitle(all.length > 1 ? `Open ${linked?.basename ?? 'linked note'}` : 'Open linked note').setIcon('file-text').onClick(() => void ws.linkedNotes.open(e)));
	for (const n of all.filter((x) => x.path !== e.linkedNote?.path))
		m.addItem((i) => i.setTitle(`Open ${n.label || n.file?.basename || n.path.split('/').pop()?.replace(/\.md$/, '') || n.path}`).setIcon('file').onClick(() => void ws.linkedNotes.openPath(n.path)));
	m.addItem((i) => i.setTitle('Link existing note…').setIcon('link').onClick(() => new VaultNotePicker(ws.app, ws, (f) => void linkNativeNote(ws, e, f)).open()));
	return m;
}

// ── the Note popover (0.17.2) ────────────────────────────────────────────────

interface PopItem {
	icon: string;
	title: string;
	sub?: string;
	run: (evt: MouseEvent | KeyboardEvent) => void;
	primary?: boolean;
	warn?: boolean;
}

/**
 * The entry page's Note button opens this: the note's name and sync state on top, then each
 * action with a line saying what it does. An entry without a native note gets the 0.17.1
 * choices (create, turn its linked note into the native note, open or link a note).
 */
export function openNotePopover(ws: WorldsmithContext, entity: EntityRecord, anchor: HTMLElement): void {
	const doc = anchor.ownerDocument;
	const win = doc.defaultView ?? window;
	doc.querySelectorAll('.ws-nnpop').forEach((x) => x.remove());
	const e = cur(ws, entity.id) ?? entity;
	const s = ws.worlds.session;
	const schema = s?.schemas.get(e.typeId);
	const nn = e.nativeNote;
	// worldsmith-modal: picks up the Codex palette and font, as dialogs do.
	const pop = doc.body.createDiv({ cls: 'ws-nnpop worldsmith-modal', attr: { role: 'menu', 'aria-label': 'Note' } });
	const close = () => {
		pop.remove();
		doc.removeEventListener('pointerdown', away, true);
		doc.removeEventListener('keydown', keys, true);
		win.removeEventListener('resize', close);
		anchor.focus({ preventScroll: true });
	};
	const away = (ev: Event) => {
		if (!pop.contains(ev.target as Node) && !anchor.contains(ev.target as Node)) close();
	};
	const keys = (ev: KeyboardEvent) => {
		const items = [...pop.querySelectorAll<HTMLElement>('.ws-nnpop__item')];
		const at = items.indexOf(doc.activeElement as HTMLElement);
		if (ev.key === 'Escape') {
			ev.preventDefault();
			ev.stopPropagation();
			close();
		} else if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
			ev.preventDefault();
			items[(at + (ev.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
		}
	};
	const head = pop.createDiv({ cls: 'ws-nnpop__head' });
	const list = pop.createDiv({ cls: 'ws-nnpop__list' });
	const add = (host: HTMLElement, it: PopItem) => {
		const b = host.createEl('button', { cls: cx('ws-nnpop__item', it.primary && 'is-primary', it.warn && 'is-warn'), attr: { type: 'button', role: 'menuitem' } });
		icon(b.createSpan({ cls: 'ws-nnpop__icon' }), it.icon);
		const t = b.createDiv({ cls: 'ws-nnpop__text' });
		t.createDiv({ cls: 'ws-nnpop__title', text: it.title });
		if (it.sub) t.createDiv({ cls: 'ws-nnpop__sub', text: it.sub });
		b.addEventListener('click', (ev) => {
			close();
			it.run(ev);
		});
		return b;
	};
	const sep = () => list.createDiv({ cls: 'ws-nnpop__sep' });
	const folderOf = (p: string) => p.split('/').slice(0, -1).join(' / ');
	const others = ws.linkedNotes.notes(e).filter((n) => n.path !== nn?.path && n.path !== (nn ? '' : e.linkedNote?.path));
	const otherNotes = () => {
		if (!others.length) return;
		const name = (n: (typeof others)[number]) => n.label || n.file?.basename || n.path.split('/').pop()?.replace(/\.md$/, '') || n.path;
		const sub = list.createDiv({ cls: 'ws-nnpop__more' });
		const toggle = add(list, {
			icon: 'library',
			title: `Other notes (${others.length})`,
			sub: others.slice(0, 3).map(name).join(' · ') + (others.length > 3 ? ' …' : ''),
			run: () => {},
		});
		// This one opens the list in place instead of closing the popover.
		const clone = toggle.cloneNode(true) as HTMLElement;
		toggle.replaceWith(clone);
		clone.setAttr('aria-expanded', 'false');
		clone.addEventListener('click', () => {
			const open = clone.getAttribute('aria-expanded') !== 'true';
			clone.setAttr('aria-expanded', String(open));
			sub.toggleClass('is-open', open);
		});
		list.appendChild(sub);
		for (const n of others) add(sub, { icon: 'file', title: name(n), sub: folderOf(n.path) || undefined, run: () => void ws.linkedNotes.openPath(n.path) });
	};
	const vaultPick = (onPick: (f: TFile) => void) => new VaultNotePicker(ws.app, ws, onPick).open();

	if (nn) {
		const t = statusText(ws, e);
		head.createDiv({ cls: 'ws-nnpop__eyebrow', text: 'Native note' });
		const row = head.createDiv({ cls: 'ws-nnpop__name-row' });
		row.createSpan({ cls: 'ws-nnpop__name', text: nn.path.split('/').pop() ?? nn.path });
		const pill = row.createSpan({ cls: cx('ws-nnpop__pill', `is-${t.tone}`) });
		pill.createSpan({ cls: 'ws-nnpop__dot' });
		pill.createSpan({ text: t.label });
		const folder = folderOf(nn.path);
		const tpl = schema && s ? s.noteTemplates.forEntity(e, schema).template.name : '';
		const when = ws.nativeNotes.state(e).lastSync ?? nn.mtime;
		// The folder on one line (cut short with … when long), the template and time on the next.
		head.createDiv({ cls: 'ws-nnpop__path', text: folder || 'Vault root', attr: { title: nn.path } });
		const meta = head.createDiv({ cls: 'ws-nnpop__meta' });
		meta.createSpan({ cls: 'ws-nnpop__meta-k', text: 'Template ' });
		meta.createSpan({ cls: 'ws-nnpop__tpl', text: tpl });
		if (when) meta.createSpan({ text: ` · ${ws.nativeNotes.state(e).lastSync ? 'checked' : 'updated'} ${relativeTime(when)}` });
		if (nn.status === 'missing') {
			add(list, { icon: 'file-plus-2', title: 'Create the native note again', sub: `A new note at ${nn.path}, from ${e.name}’s values`, run: () => void createNativeNote(ws, e), primary: true });
			add(list, { icon: 'link', title: 'Relink to a note…', sub: 'If the note was moved or renamed while Worldsmith was off', run: () => vaultPick((f) => void linkNativeNote(ws, e, f)) });
			sep();
			add(list, { icon: 'unlink', title: 'Stop using a native note', sub: 'The entry keeps every value', run: () => unlinkNativeNote(ws, e) });
		} else {
			const input = ws.nativeNotes.planInput(e, '');
			const props = input?.props.length ?? 0;
			const secs = input?.regions.filter((r) => r.kind === 'field').length ?? 0;
			const links = s?.relations.viewsOf(e.id).length ?? 0;
			add(list, { icon: 'file-text', title: 'Open native note', sub: 'In a new tab · Ctrl-click to split', run: (ev) => void ws.nativeNotes.open(e, ev instanceof MouseEvent && (ev.metaKey || ev.ctrlKey) ? 'split' : 'tab') });
			add(list, { icon: 'layout-template', title: 'Change note template…', sub: templateLabel(ws, e), run: () => new TemplatePickerModal(ws, e).open() });
			add(list, { icon: 'refresh-cw', title: 'Sync status and history', sub: `${props} propert${props === 1 ? 'y' : 'ies'} · ${secs} text section${secs === 1 ? '' : 's'} · ${links} link${links === 1 ? '' : 's'}`, run: () => new NoteStatusModal(ws, e).open() });
			if (nn.conflicts?.length) add(list, { icon: 'alert-triangle', title: 'Decide what to keep…', sub: `${nn.conflicts.length} value${nn.conflicts.length === 1 ? '' : 's'} changed in both places`, run: () => new NoteConflictModal(ws, e, nn.conflicts!).open(), warn: true });
			add(list, { icon: 'link', title: 'Link a different note…', run: () => vaultPick((f) => void relinkTo(ws, e, f)) });
			otherNotes();
			sep();
			add(list, { icon: 'unlink', title: 'Stop using as native note', sub: 'The note stays, as a plain linked note', run: () => unlinkNativeNote(ws, e) });
		}
		pop.createDiv({ cls: 'ws-nnpop__hint', text: 'Worldsmith only writes its own marked parts. Your writing in the note is never changed.' });
	} else {
		const linked = e.linkedNote ? ws.app.vault.getFileByPath(e.linkedNote.path) : null;
		const nativeFirst = ws.settings.nativeNotes.newNotesNative;
		const tplName = schema && s ? s.noteTemplates.forType(schema).name : 'the type’s template';
		head.createDiv({ cls: 'ws-nnpop__eyebrow', text: 'Note' });
		const row = head.createDiv({ cls: 'ws-nnpop__name-row' });
		row.createSpan({ cls: 'ws-nnpop__name', text: linked ? linked.name : e.name });
		const pill = row.createSpan({ cls: 'ws-nnpop__pill is-muted' });
		pill.createSpan({ cls: 'ws-nnpop__dot' });
		pill.createSpan({ text: linked ? 'Plain note' : 'No note yet' });
		if (linked) head.createDiv({ cls: 'ws-nnpop__path', text: folderOf(linked.path) || 'Vault root', attr: { title: linked.path } });
		head.createDiv({ cls: 'ws-nnpop__desc', text: linked ? 'A plain note: not kept in step with the entry.' : 'A native note keeps the entry’s Properties and sections in step.' });
		if (!nativeFirst && !e.linkedNote)
			add(list, { icon: 'file-plus', title: 'Create linked note', sub: 'A plain note (Settings → Native notes)', primary: true, run: () => void ws.linkedNotes.create(e).then((f) => f && ws.linkedNotes.open(cur(ws, e.id) ?? e)) });
		add(list, { icon: 'file-plus-2', title: 'Create native note', sub: `${tplName} template · kept in step`, primary: nativeFirst, run: () => void createNativeNote(ws, e) });
		add(list, { icon: 'layout-template', title: 'Create native note with a template…', sub: `Choose from ${s?.noteTemplates.list().length ?? 0} templates`, run: () => new TemplatePickerModal(ws, e).open() });
		if (linked && !ws.nativeNotes.entryOf(linked.path)) add(list, { icon: 'file-check', title: `Turn “${linked.basename}” into the native note…`, sub: 'Dry run first · backup · every word kept · Undo', run: () => new MigrationModal(ws, { kind: 'entry', id: e.id }).open() });
		sep();
		if (e.linkedNote) add(list, { icon: 'file-text', title: 'Open linked note', sub: e.linkedNote.path, run: () => void ws.linkedNotes.open(e) });
		otherNotes();
		add(list, { icon: 'link', title: 'Link existing note…', sub: 'Make a note you already have the native note', run: () => vaultPick((f) => void linkNativeNote(ws, e, f)) });
		pop.createDiv({ cls: 'ws-nnpop__hint', text: 'Your own writing in a native note is never changed: Worldsmith only writes its marked parts.' });
	}

	// Under the button, kept on screen (above it when there's no room below).
	const r = anchor.getBoundingClientRect();
	const w = Math.min(340, win.innerWidth - 16);
	pop.style.width = `${w}px`;
	pop.style.left = `${Math.max(8, Math.min(r.right - w, win.innerWidth - w - 8))}px`;
	const h = pop.offsetHeight;
	const below = r.bottom + 8;
	pop.style.top = `${below + h > win.innerHeight - 8 && r.top - 8 - h > 8 ? r.top - 8 - h : Math.max(8, Math.min(below, win.innerHeight - h - 8))}px`;
	pop.style.maxHeight = `${win.innerHeight - 16}px`;
	win.setTimeout(() => {
		doc.addEventListener('pointerdown', away, true);
		doc.addEventListener('keydown', keys, true);
		win.addEventListener('resize', close);
	}, 0);
	pop.querySelector<HTMLElement>('.ws-nnpop__item')?.focus({ preventScroll: true });
}
