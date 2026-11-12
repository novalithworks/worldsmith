import { Component, FuzzySuggestModal, Menu, Notice, type FuzzyMatch } from 'obsidian';
import type { ChronoDate, FieldDefinition, ManuscriptItem, PlotThread, SceneStatus, SemanticColor, WritingProject } from '../../core/types';
import { SEMANTIC_COLORS } from '../../core/types';
import { formatChronoDate } from '../../core/types/chrono';
import { chronoUI } from '../../fields/ui/chrono';
import { listId } from '../../services/writing/planning';
import { button, cx, icon } from '../components/dom';
import { WorldsmithModal } from '../components/modals';
import { actionNotice } from '../components/notice';
import { parseTime } from './boards';
import { undoNotice } from './actions';
import type { Studio } from './kit';
import { count } from './model';

/*
 * Story-planning dialogs (WS4): a scene's in-story date and time, the project's statuses and
 * plot threads, saving a project as a template, and choosing a scene. Everything goes
 * through session.writing and offers Undo; nothing here touches a note.
 */

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));
const COLOR_NAME: Record<SemanticColor, string> = { red: 'Red', orange: 'Orange', yellow: 'Yellow', green: 'Green', cyan: 'Cyan', blue: 'Blue', purple: 'Purple', pink: 'Pink', gray: 'Gray' };

function field(parent: HTMLElement, label: string, cls?: string): HTMLElement {
	const f = parent.createDiv({ cls: cx('ws-wr-field', cls) });
	f.createEl('label', { cls: 'ws-wr-field__label', text: label });
	return f;
}

let seq = 0;
const nextId = (p: string) => `ws-wr-${p}-${++seq}`;

function actions(parent: HTMLElement): HTMLElement {
	return parent.createDiv({ cls: 'ws-modal-actions ws-wr-actions' });
}

/** A colour swatch that opens a menu of the theme's colours. */
function swatch(parent: HTMLElement, value: SemanticColor | null, label: string, onPick: (c: SemanticColor) => void): HTMLButtonElement {
	const b = parent.createEl('button', { cls: cx('ws-wr-swatch', `ws-tint--${value ?? 'gray'}`), attr: { type: 'button', 'aria-label': `${label}: ${COLOR_NAME[value ?? 'gray']}. Change colour`, 'aria-haspopup': 'menu' } });
	b.createSpan({ cls: 'ws-wr-dot' });
	b.addEventListener('click', (e) => {
		const m = new Menu();
		for (const c of SEMANTIC_COLORS) m.addItem((i) => i.setTitle(COLOR_NAME[c]).setChecked(c === value).onClick(() => onPick(c)));
		if (e.detail === 0) {
			const r = b.getBoundingClientRect();
			m.showAtPosition({ x: r.left, y: r.bottom + 4 });
		} else m.showAtMouseEvent(e);
	});
	return b;
}

// ── in-story date and time ──────────────────────────────────────────────────

const DATE_FIELD: FieldDefinition = { id: 'scene-date', type: 'chrono', label: 'In-story date' };

/** When a scene happens in the story: a date in the world's calendars, and a time of day. */
export class WhenModal extends WorldsmithModal {
	constructor(
		private readonly st: Studio,
		private readonly scene: ManuscriptItem,
	) {
		super(st.ws.app);
		this.modalEl.addClass('ws-wr-modal', 'ws-wr-when');
	}

	private life: Component | null = null;

	override onOpen(): void {
		const it = this.scene;
		this.setTitle(`When “${it.title}” happens`);
		const form = this.contentEl.createEl('form', { cls: 'ws-wr-form' });
		let date: ChronoDate | null = it.date ? { ...it.date } : null;
		const dateField = field(form, 'In-story date');
		const host = dateField.createDiv({ cls: 'ws-wr-when__date' });
		const kind = this.st.ws.fieldTypes.for(DATE_FIELD);
		// The editor's own life is the dialog's (its pickers and listeners go when it closes).
		this.life?.unload();
		this.life = new Component();
		this.life.load();
		const handle = chronoUI.createEditor(host, {
			app: this.st.ws.app,
			field: DATE_FIELD,
			entity: null,
			component: this.life,
			value: date ?? undefined,
			onChange: (v) => {
				if (kind.isEmpty(v)) date = null;
				else {
					const res = kind.coerce(v, DATE_FIELD);
					if (res.ok) date = res.value as ChronoDate;
				}
			},
		});
		const timeField = field(form, 'Time of day (optional)');
		const timeIn = timeField.createEl('input', { cls: 'ws-input ws-wr-input ws-wr-when__time', attr: { type: 'text', placeholder: 'e.g. 21:30 or 9pm', inputmode: 'text', spellcheck: 'false' } });
		timeIn.id = nextId('time');
		timeField.querySelector('label')!.htmlFor = timeIn.id;
		timeIn.value = it.time ?? '';
		form.createDiv({ cls: 'ws-wr-field__help', text: 'Dates use your world’s calendars. They are kept in Worldsmith, never written into the scene’s note.' });
		const act = actions(form);
		if (it.date) button(act, { label: 'Clear date', variant: 'ghost', cls: 'ws-wr-when__clear', onClick: () => this.save(null, null) });
		act.createDiv({ cls: 'ws-wr-spacer' });
		button(act, { label: 'Cancel', variant: 'ghost', onClick: () => this.close() });
		const ok = button(act, { label: 'Save', variant: 'primary', cls: 'ws-wr-when__save' });
		ok.type = 'submit';
		form.addEventListener('submit', (e) => {
			e.preventDefault();
			const t = parseTime(timeIn.value);
			if (t === undefined) {
				new Notice('The time should look like 21:30 or 9pm.');
				timeIn.focus();
				return;
			}
			if (!date && t) {
				new Notice('Choose a date first; a time goes with a date.');
				return;
			}
			this.save(date, t);
		});
		window.setTimeout(() => handle.focus(), 0);
	}

	private save(date: ChronoDate | null, time: string | null): void {
		try {
			const u = this.st.w.setWhen(this.scene.id, date, time);
			this.close();
			undoNotice(this.st, date ? `“${this.scene.title}” now happens on ${describeWhen(date, time)}.` : `“${this.scene.title}” has no date now.`, u);
		} catch (e) {
			new Notice(errorText(e));
		}
	}

	override onClose(): void {
		this.life?.unload();
		this.life = null;
		this.contentEl.empty();
	}
}

/** "12 Emberfall 412, 21:30". */
export function describeWhen(date: ChronoDate, time: string | null): string {
	return `${formatChronoDate(date)}${time ? `, ${time}` : ''}`;
}

// ── statuses ────────────────────────────────────────────────────────────────

interface StatusRow extends SceneStatus {
	/** Was on the list when the dialog opened. */
	existing: boolean;
}

/**
 * The project's own statuses: names, colours, order, which count as done and which new
 * scenes get. Taking one off the list keeps its scenes as they are (they show "No status"),
 * unless you choose a status to move them to. Nothing is ever lost: Undo puts it all back.
 */
export class StatusesModal extends WorldsmithModal {
	private rows: StatusRow[];
	private removed: Array<{ status: SceneStatus; moveTo: string | null }> = [];
	private def: string;

	constructor(
		private readonly st: Studio,
		private readonly project: WritingProject,
	) {
		super(st.ws.app);
		this.modalEl.addClass('ws-wr-modal', 'ws-wr-liststatuses');
		this.rows = project.statuses.map((s) => ({ ...s, existing: true }));
		this.def = project.defaultStatus;
	}

	override onOpen(): void {
		this.setTitle('Scene statuses');
		this.contentEl.createDiv({ cls: 'ws-wr-field__help', text: 'Your own steps for a scene, in order. Renaming a status keeps every scene that has it.' });
		const list = this.contentEl.createDiv({ cls: 'ws-wr-listedit' });
		const gone = this.contentEl.createDiv({ cls: 'ws-wr-listedit__gone' });
		const paint = () => {
			// A move to a status that has just been taken off too: back to "Keep it", as the select shows.
			for (const x of this.removed) if (x.moveTo && !this.rows.some((r) => r.id === x.moveTo)) x.moveTo = null;
			list.empty();
			this.rows.forEach((r, i) => {
				const row = list.createDiv({ cls: 'ws-wr-listedit__row', attr: { 'data-id': r.id } });
				swatch(row, r.color, r.label || 'Status', (c) => {
					r.color = c;
					paint();
				});
				const name = row.createEl('input', { cls: 'ws-input ws-wr-input ws-wr-listedit__name', attr: { type: 'text', 'aria-label': `Name of status ${i + 1}`, spellcheck: 'false' } });
				name.value = r.label;
				name.addEventListener('input', () => (r.label = name.value));
				const done = row.createEl('label', { cls: 'ws-wr-check ws-wr-listedit__done', attr: { title: 'Scenes with this status count as complete' } });
				const box = done.createEl('input', { attr: { type: 'checkbox' } });
				box.checked = r.done;
				box.addEventListener('change', () => (r.done = box.checked));
				done.createSpan({ text: 'Done' });
				const def = row.createEl('label', { cls: 'ws-wr-check ws-wr-listedit__def', attr: { title: 'New scenes start with this status' } });
				const radio = def.createEl('input', { attr: { type: 'radio', name: 'ws-wr-defstatus' } });
				radio.checked = r.id === this.def;
				radio.addEventListener('change', () => radio.checked && (this.def = r.id));
				def.createSpan({ text: 'New' });
				const tools = row.createDiv({ cls: 'ws-wr-listedit__tools' });
				button(tools, { icon: 'arrow-up', variant: 'quiet', size: 'sm', tooltip: 'Move up', disabled: i === 0, onClick: () => this.swap(i, -1, paint) });
				button(tools, { icon: 'arrow-down', variant: 'quiet', size: 'sm', tooltip: 'Move down', disabled: i === this.rows.length - 1, onClick: () => this.swap(i, 1, paint) });
				button(tools, {
					icon: 'x',
					variant: 'quiet',
					size: 'sm',
					tooltip: 'Take off the list',
					cls: 'ws-wr-listedit__remove',
					disabled: this.rows.length === 1,
					onClick: () => {
						this.rows.splice(i, 1);
						if (r.existing) this.removed.push({ status: { id: r.id, label: r.label, color: r.color, done: r.done }, moveTo: null });
						if (this.def === r.id) this.def = this.rows[0]!.id;
						paint();
					},
				});
			});
			const add = list.createDiv({ cls: 'ws-wr-listedit__add' });
			button(add, {
				label: 'Add a status',
				icon: 'plus',
				variant: 'ghost',
				size: 'sm',
				cls: 'ws-wr-listedit__addbtn',
				onClick: () => {
					const taken = [...this.rows, ...this.project.retiredStatuses, ...this.removed.map((x) => x.status)].map((x) => x.id);
					this.rows.push({ id: listId('New status', taken), label: 'New status', color: 'blue', done: false, existing: false });
					paint();
					(list.querySelector('.ws-wr-listedit__row:last-of-type .ws-wr-listedit__name'))?.select();
				},
			});
			paintGone();
		};
		const scenes = this.st.w.scenes(this.project.id);
		const paintGone = () => {
			gone.empty();
			const retired = this.project.retiredStatuses.filter((r) => !this.rows.some((x) => x.id === r.id));
			if (!this.removed.length && !retired.length) return;
			gone.createDiv({ cls: 'ws-wr-caps', text: 'Off the list' });
			for (const x of this.removed) {
				const n = scenes.filter((s) => s.status === x.status.id).length;
				const row = gone.createDiv({ cls: 'ws-wr-listedit__goneRow' });
				row.createSpan({ cls: 'ws-wr-listedit__goneName', text: x.status.label });
				row.createSpan({ cls: 'ws-wr-muted', text: n ? `${count(n, 'scene')}:` : 'No scenes have it.' });
				if (n) {
					const sel = row.createEl('select', { cls: 'dropdown ws-wr-select', attr: { 'aria-label': `Scenes with ${x.status.label}` } });
					sel.createEl('option', { text: 'Keep it (shown as No status)', attr: { value: '' } });
					for (const r of this.rows) sel.createEl('option', { text: `Move to ${r.label || 'the new status'}`, attr: { value: r.id } });
					sel.value = x.moveTo ?? '';
					sel.addEventListener('change', () => (x.moveTo = sel.value || null));
				}
				button(row, {
					label: 'Put back',
					variant: 'quiet',
					size: 'sm',
					onClick: () => {
						this.removed = this.removed.filter((y) => y !== x);
						this.rows.push({ ...x.status, existing: true });
						paint();
					},
				});
			}
			for (const r of retired) {
				if (this.removed.some((x) => x.status.id === r.id)) continue;
				const n = scenes.filter((s) => s.status === r.id).length;
				const row = gone.createDiv({ cls: 'ws-wr-listedit__goneRow' });
				row.createSpan({ cls: 'ws-wr-listedit__goneName', text: r.label });
				row.createSpan({ cls: 'ws-wr-muted', text: n ? `taken off before; ${count(n, 'scene')} still ${n === 1 ? 'has' : 'have'} it` : 'taken off before' });
				button(row, {
					label: 'Bring back',
					variant: 'quiet',
					size: 'sm',
					cls: 'ws-wr-listedit__back',
					onClick: () => {
						this.rows.push({ ...r, existing: false });
						paint();
					},
				});
			}
		};
		paint();
		const act = actions(this.contentEl);
		button(act, { label: 'Cancel', variant: 'ghost', onClick: () => this.close() });
		button(act, { label: 'Save', variant: 'primary', cls: 'ws-wr-listedit__save', onClick: () => this.save() });
	}

	private swap(i: number, d: -1 | 1, paint: () => void): void {
		const j = i + d;
		if (j < 0 || j >= this.rows.length) return;
		[this.rows[i], this.rows[j]] = [this.rows[j]!, this.rows[i]!];
		paint();
	}

	private save(): void {
		const st = this.st;
		const pid = this.project.id;
		const next: SceneStatus[] = this.rows.map(({ existing: _e, ...s }) => ({ ...s, label: s.label.trim() }));
		try {
			// Only moves to a status that is on the new list count (a select can't show any other).
			const ids = new Set(next.map((x) => x.id));
			const moves = this.removed.filter((x) => x.moveTo && ids.has(x.moveTo)).map((x) => ({ from: x.status.id, to: x.moveTo! }));
			const r = st.w.editStatuses(pid, next, this.def, moves);
			this.close();
			const moving = new Set(moves.map((m) => m.from));
			const kept = this.removed.filter((x) => !moving.has(x.status.id)).reduce((n, x) => n + st.w.scenes(pid).filter((s) => s.status === x.status.id).length, 0);
			const bits = ['Statuses saved.', r.moved ? `${count(r.moved, 'scene')} moved to another status.` : '', kept ? `${count(kept, 'scene')} kept ${kept === 1 ? 'its' : 'their'} old status (shown as No status).` : ''].filter(Boolean);
			actionNotice(bits.join(' '), {
				label: 'Undo',
				run: () => void st.w.undoStatuses(r).catch((e) => new Notice(errorText(e))),
			});
		} catch (e) {
			new Notice(errorText(e));
		}
	}

	override onClose(): void {
		this.contentEl.empty();
	}
}

// ── plot threads ────────────────────────────────────────────────────────────

/** The project's plot threads: name, colour, a line about it, and order. Removing one keeps the scenes' links (it can be brought back). */
export class ThreadsModal extends WorldsmithModal {
	private rows: PlotThread[];

	constructor(
		private readonly st: Studio,
		private readonly project: WritingProject,
		private readonly opts: { addOne?: boolean } = {},
	) {
		super(st.ws.app);
		this.modalEl.addClass('ws-wr-modal', 'ws-wr-listthreads');
		this.rows = project.threads.map((t) => ({ ...t }));
	}

	override onOpen(): void {
		this.setTitle('Plot threads');
		this.contentEl.createDiv({ cls: 'ws-wr-field__help', text: 'The storylines that run through the book. A scene can be in several. Taking a thread off the list keeps which scenes were in it.' });
		const list = this.contentEl.createDiv({ cls: 'ws-wr-listedit' });
		const gone = this.contentEl.createDiv({ cls: 'ws-wr-listedit__gone' });
		const scenes = this.st.w.scenes(this.project.id);
		const taken = () => [...this.rows, ...this.project.retiredThreads, ...this.project.threads].map((x) => x.id);
		const addRow = () => {
			const used = new Set(this.rows.map((r) => r.color));
			const color = SEMANTIC_COLORS.find((c) => c !== 'gray' && !used.has(c)) ?? 'blue';
			this.rows.push({ id: listId('Thread', taken()), label: '', color, description: '' });
		};
		if (this.opts.addOne || !this.rows.length) addRow();
		const paint = () => {
			list.empty();
			this.rows.forEach((r, i) => {
				const row = list.createDiv({ cls: 'ws-wr-listedit__row ws-wr-listedit__row--thread', attr: { 'data-id': r.id } });
				swatch(row, r.color, r.label || 'Thread', (c) => {
					r.color = c;
					paint();
				});
				const text = row.createDiv({ cls: 'ws-wr-listedit__text' });
				const name = text.createEl('input', { cls: 'ws-input ws-wr-input ws-wr-listedit__name', attr: { type: 'text', 'aria-label': `Name of thread ${i + 1}`, placeholder: 'Name, e.g. The oath', spellcheck: 'false' } });
				name.value = r.label;
				name.addEventListener('input', () => (r.label = name.value));
				const desc = text.createEl('input', { cls: 'ws-input ws-wr-input ws-wr-listedit__desc', attr: { type: 'text', 'aria-label': `About thread ${i + 1}`, placeholder: 'What it is about (optional)' } });
				desc.value = r.description;
				desc.addEventListener('input', () => (r.description = desc.value));
				const n = scenes.filter((s) => s.threads.includes(r.id)).length;
				row.createSpan({ cls: 'ws-wr-muted ws-wr-listedit__count', text: n ? count(n, 'scene') : '' });
				const tools = row.createDiv({ cls: 'ws-wr-listedit__tools' });
				button(tools, { icon: 'arrow-up', variant: 'quiet', size: 'sm', tooltip: 'Move up', disabled: i === 0, onClick: () => this.swap(i, -1, paint) });
				button(tools, { icon: 'arrow-down', variant: 'quiet', size: 'sm', tooltip: 'Move down', disabled: i === this.rows.length - 1, onClick: () => this.swap(i, 1, paint) });
				button(tools, {
					icon: 'x',
					variant: 'quiet',
					size: 'sm',
					tooltip: 'Take off the list',
					cls: 'ws-wr-listedit__remove',
					onClick: () => {
						this.rows.splice(i, 1);
						paint();
					},
				});
			});
			const add = list.createDiv({ cls: 'ws-wr-listedit__add' });
			button(add, {
				label: 'Add a plot thread',
				icon: 'plus',
				variant: 'ghost',
				size: 'sm',
				cls: 'ws-wr-listedit__addbtn',
				onClick: () => {
					addRow();
					paint();
					(list.querySelector('.ws-wr-listedit__row:last-of-type .ws-wr-listedit__name'))?.focus();
				},
			});
			gone.empty();
			const off = [...this.project.threads, ...this.project.retiredThreads].filter((t, i, all) => !this.rows.some((r) => r.id === t.id) && all.findIndex((x) => x.id === t.id) === i);
			if (off.length) gone.createDiv({ cls: 'ws-wr-caps', text: 'Off the list' });
			for (const t of off) {
				const row = gone.createDiv({ cls: 'ws-wr-listedit__goneRow' });
				row.createSpan({ cls: 'ws-wr-listedit__goneName', text: t.label });
				const n = scenes.filter((s) => s.threads.includes(t.id)).length;
				row.createSpan({ cls: 'ws-wr-muted', text: n ? `${count(n, 'scene')} keep the link` : '' });
				button(row, {
					label: 'Bring back',
					variant: 'quiet',
					size: 'sm',
					cls: 'ws-wr-listedit__back',
					onClick: () => {
						this.rows.push({ ...t });
						paint();
					},
				});
			}
		};
		paint();
		window.setTimeout(() => (list.querySelector('.ws-wr-listedit__row:last-of-type .ws-wr-listedit__name'))?.focus(), 0);
		const act = actions(this.contentEl);
		button(act, { label: 'Cancel', variant: 'ghost', onClick: () => this.close() });
		button(act, { label: 'Save', variant: 'primary', cls: 'ws-wr-listedit__save', onClick: () => this.save() });
	}

	private swap(i: number, d: -1 | 1, paint: () => void): void {
		const j = i + d;
		if (j < 0 || j >= this.rows.length) return;
		[this.rows[i], this.rows[j]] = [this.rows[j]!, this.rows[i]!];
		paint();
	}

	private save(): void {
		// A new row left without a name is simply not added.
		const isNew = (r: PlotThread) => !this.project.threads.some((t) => t.id === r.id) && !this.project.retiredThreads.some((t) => t.id === r.id);
		const next = this.rows.filter((r) => r.label.trim() || !isNew(r)).map((r) => ({ ...r, label: r.label.trim() || this.project.threads.find((t) => t.id === r.id)?.label || 'Thread' }));
		try {
			const { before, after } = this.st.w.setThreads(this.project.id, next);
			this.close();
			actionNotice('Plot threads saved.', { label: 'Undo', run: () => this.st.w.restoreProject(before, after) });
		} catch (e) {
			new Notice(errorText(e));
		}
	}

	override onClose(): void {
		this.contentEl.empty();
	}
}

// ── save as template ────────────────────────────────────────────────────────

/** Save the project's structure (titles, synopses, beats, statuses, threads; no text) as a template for new projects. */
export class SaveTemplateModal extends WorldsmithModal {
	constructor(
		private readonly st: Studio,
		private readonly project: WritingProject,
	) {
		super(st.ws.app);
		this.modalEl.addClass('ws-wr-modal', 'ws-wr-savetpl');
	}

	override onOpen(): void {
		const p = this.project;
		this.setTitle('Save as a template');
		const form = this.contentEl.createEl('form', { cls: 'ws-wr-form' });
		const nf = field(form, 'Name');
		const name = nf.createEl('input', { cls: 'ws-input ws-wr-input', attr: { type: 'text', spellcheck: 'false' } });
		name.id = nextId('tplname');
		nf.querySelector('label')!.htmlFor = name.id;
		name.value = `${p.name} structure`;
		const df = field(form, 'Description (optional)');
		const desc = df.createEl('input', { cls: 'ws-input ws-wr-input', attr: { type: 'text' } });
		desc.id = nextId('tpldesc');
		df.querySelector('label')!.htmlFor = desc.id;
		const hint = form.createDiv({ cls: 'ws-wr-hint' });
		icon(hint, 'shield-check');
		hint.createSpan({ text: 'Saves the parts, chapters and scene titles with their synopses, the beats shown on Plot, the statuses and the plot threads. No text from your notes is copied, and this project doesn’t change.' });
		const act = actions(form);
		button(act, { label: 'Cancel', variant: 'ghost', onClick: () => this.close() });
		const ok = button(act, { label: 'Save template', icon: 'bookmark-plus', variant: 'primary', cls: 'ws-wr-savetpl__go' });
		ok.type = 'submit';
		form.addEventListener('submit', (e) => {
			e.preventDefault();
			try {
				const t = this.st.w.saveTemplate(p.id, name.value, desc.value);
				this.close();
				actionNotice(`Saved “${t.name}”. Choose it under “Start from” when you make a new project.`, { label: 'Undo', run: () => this.st.w.removeTemplate(t.id) });
			} catch (err) {
				new Notice(errorText(err));
			}
		});
		window.setTimeout(() => name.select(), 0);
	}

	override onClose(): void {
		this.contentEl.empty();
	}
}

// ── choose a scene ──────────────────────────────────────────────────────────

/** Pick one of the project's scenes (for a beat). */
export class ScenePickerModal extends FuzzySuggestModal<ManuscriptItem> {
	constructor(
		st: Studio,
		private readonly scenes: ManuscriptItem[],
		private readonly onPick: (s: ManuscriptItem) => void,
	) {
		super(st.ws.app);
		this.modalEl.addClass('worldsmith-modal');
		this.setPlaceholder('Choose a scene…');
		this.emptyStateText = 'No scene by that name.';
	}
	getItems(): ManuscriptItem[] {
		return this.scenes;
	}
	getItemText(s: ManuscriptItem): string {
		return s.title;
	}
	override renderSuggestion(m: FuzzyMatch<ManuscriptItem>, el: HTMLElement): void {
		el.createDiv({ text: m.item.title });
		if (m.item.synopsis) el.createDiv({ cls: 'ws-wr-muted', text: m.item.synopsis.slice(0, 120) });
	}
	onChooseItem(s: ManuscriptItem): void {
		this.onPick(s);
	}
}
