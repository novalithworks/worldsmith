import { holdSession } from './session';
import { EmbeddedEditor } from '../editor/EmbeddedEditor';
import { FuzzySuggestModal, Notice, type App, type FuzzyMatch } from 'obsidian';
import type { ManuscriptItem, ProjectKind, WritingProject } from '../../core/types';
import { PROJECT_KINDS } from '../../core/types';
import { STRUCTURE_TEMPLATES } from '../../services/writing/templates';
import { cleanPath } from '../../services/writing/vault';
import { button, cx, icon } from '../components/dom';
import { WorldsmithModal } from '../components/modals';
import { actionNotice } from '../components/notice';
import { fmt, type Studio } from './kit';
import { binderModel, count, foldersOf, importPreview, kindLabel, moveDestinations, noteParagraphs, suggestFolder, type Paragraph } from './model';

/*
 * The Writing Studio's dialogs (WS2): new project, import a folder, project details,
 * Move to…, Split… and the folder and note pickers. Every change goes through
 * session.writing; nothing here writes a file.
 */

const KIND_TILES: Record<ProjectKind, { icon: string; sub: string }> = {
	novel: { icon: 'book', sub: 'Parts, chapters, scenes' },
	novella: { icon: 'book-open', sub: 'Chapters and scenes' },
	'short-story': { icon: 'scroll-text', sub: 'Scenes only' },
	anthology: { icon: 'library', sub: 'A book of stories' },
	script: { icon: 'clapperboard', sub: 'Scenes; formatting later' },
};

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

function field(parent: HTMLElement, label: string, cls?: string): HTMLElement {
	const f = parent.createDiv({ cls: cx('ws-wr-field', cls) });
	f.createEl('label', { cls: 'ws-wr-field__label', text: label });
	return f;
}

let inputSeq = 0;

function textInput(parent: HTMLElement, value = '', placeholder = ''): HTMLInputElement {
	const i = parent.createEl('input', { cls: 'ws-input ws-wr-input', attr: { type: 'text', spellcheck: 'false' } });
	i.value = value;
	if (placeholder) i.placeholder = placeholder;
	i.id = `ws-wr-in-${++inputSeq}`;
	const label = parent.querySelector('label');
	if (label) label.htmlFor = i.id;
	return i;
}

/** Every folder of the vault that holds notes (Worldsmith's own data folder left out). */
function vaultFolders(st: Studio): string[] {
	const v = st.w.vault;
	return v ? foldersOf(v.markdownFiles('').map((f) => f.path)) : [];
}

/** Pick a folder of the vault (the folders that hold notes). */
export class FolderPickerModal extends FuzzySuggestModal<string> {
	constructor(
		app: App,
		private readonly folders: string[],
		private readonly onPick: (folder: string) => void,
	) {
		super(app);
		this.modalEl.addClass('worldsmith-modal');
		this.setPlaceholder('Choose a folder…');
		this.emptyStateText = 'No folder with notes in it.';
	}
	getItems(): string[] {
		return this.folders;
	}
	getItemText(f: string): string {
		return f;
	}
	onChooseItem(f: string): void {
		this.onPick(f);
	}
}

/** A folder input with a "Choose…" button. */
function folderInput(st: Studio, parent: HTMLElement, value: string, placeholder: string, onChange: (v: string) => void): HTMLInputElement {
	const row = parent.createDiv({ cls: 'ws-wr-folderrow' });
	const input = textInput(row, value, placeholder);
	const fieldLabel = parent.querySelector('label');
	if (fieldLabel) fieldLabel.htmlFor = input.id;
	input.addEventListener('input', () => onChange(input.value));
	button(row, {
		label: 'Choose…',
		icon: 'folder-open',
		variant: 'ghost',
		size: 'sm',
		onClick: () =>
			new FolderPickerModal(st.ws.app, vaultFolders(st), (f) => {
				input.value = f;
				onChange(f);
			}).open(),
	});
	return input;
}

function actions(parent: HTMLElement): HTMLElement {
	return parent.createDiv({ cls: 'ws-modal-actions ws-wr-actions' });
}

// ── new project ─────────────────────────────────────────────────────────────

export class NewProjectModal extends WorldsmithModal {
	private kind: ProjectKind = 'novel';
	private template = 'three-act';
	private templateTouched = false;
	private folderTouched = false;
	private busy = false;

	constructor(private readonly st: Studio) {
		super(st.ws.app);
		this.modalEl.addClass('ws-wr-modal', 'ws-wr-newproject');
	}

	override onOpen(): void {
		this.setTitle('New writing project');
		const c = this.contentEl;
		const form = c.createEl('form', { cls: 'ws-wr-form' });
		const tiles = form.createDiv({ cls: 'ws-wr-kinds', attr: { role: 'radiogroup', 'aria-label': 'Kind of project' } });
		const paintTiles = () => {
			tiles.empty();
			for (const k of PROJECT_KINDS) {
				const t = tiles.createEl('button', { cls: cx('ws-wr-kind', k === this.kind && 'is-active'), attr: { type: 'button', role: 'radio', 'aria-checked': String(k === this.kind), 'data-kind': k } });
				icon(t, KIND_TILES[k].icon, 'ws-wr-kind__icon');
				t.createDiv({ cls: 'ws-wr-kind__name', text: kindLabel(k) });
				t.createDiv({ cls: 'ws-wr-kind__sub', text: KIND_TILES[k].sub });
				t.addEventListener('click', () => {
					this.kind = k;
					if (!this.templateTouched) this.template = STRUCTURE_TEMPLATES.find((x) => x.id !== 'blank' && x.suits.includes(k))?.id ?? 'blank';
					paintTiles();
					paintTemplates();
				});
			}
		};
		const titleIn = textInput(field(form, 'Title'), '', 'The Hollow Crown');
		const existing = this.st.w.projects({ archived: 'all' }).map((p) => p.folder);
		const folderField = field(form, 'Folder in your vault');
		const folderIn = folderInput(this.st, folderField, suggestFolder('', existing), '', () => {
			this.folderTouched = true;
			paintHint();
		});
		titleIn.addEventListener('input', () => {
			if (!this.folderTouched) folderIn.value = suggestFolder(titleIn.value, existing);
			paintHint();
		});
		const row = form.createDiv({ cls: 'ws-wr-formrow' });
		const tplField = field(row, 'Start from');
		const tplSel = tplField.createEl('select', { cls: 'dropdown ws-wr-select' });
		tplSel.id = 'ws-wr-template';
		tplField.querySelector('label')!.htmlFor = tplSel.id;
		const goalField = field(row, 'Word goal (optional)');
		const goalIn = textInput(goalField, '', 'e.g. 90,000');
		goalIn.inputMode = 'numeric';
		const descIn = textInput(field(form, 'Description (optional)'), '', 'One line about the book');
		const notesRow = form.createEl('label', { cls: 'ws-wr-check' });
		const notesBox = notesRow.createEl('input', { attr: { type: 'checkbox' } });
		notesRow.createSpan({ text: 'Create an empty note for every scene now' });
		const hintEl = form.createDiv({ cls: 'ws-wr-hint' });
		const paintTemplates = () => {
			tplSel.empty();
			const sorted = [...STRUCTURE_TEMPLATES].sort((a, b) => Number(b.suits.includes(this.kind)) - Number(a.suits.includes(this.kind)));
			for (const t of sorted) {
				const o = tplSel.createEl('option', { text: t.name, attr: { value: t.id } });
				if (t.id === this.template) o.selected = true;
			}
			// WS4: templates the writer saved from their own projects.
			const own = this.st.w.templates();
			if (own.length) {
				const g = tplSel.createEl('optgroup', { attr: { label: 'Your templates' } });
				for (const t of own) {
					const o = g.createEl('option', { text: t.name, attr: { value: `own:${t.id}` } });
					if (`own:${t.id}` === this.template) o.selected = true;
				}
			}
			paintHint();
		};
		tplSel.addEventListener('change', () => {
			this.template = tplSel.value;
			this.templateTouched = true;
			paintHint();
		});
		notesBox.addEventListener('change', () => paintHint());
		const paintHint = () => {
			hintEl.empty();
			icon(hintEl, 'shield-check');
			const ownTpl = this.template.startsWith('own:') ? this.st.w.template(this.template.slice(4)) : undefined;
			const tpl = ownTpl ? { description: `${ownTpl.description} Your own template: its statuses, plot threads and beats come too.` } : STRUCTURE_TEMPLATES.find((t) => t.id === this.template);
			const folder = cleanPath(folderIn.value) || '(the top of your vault)';
			const notes = notesBox.checked && this.template !== 'blank';
			notesBox.disabled = this.template === 'blank';
			hintEl.createSpan({ text: `${tpl?.description ?? ''} ${notes ? `An empty note is made for each scene in “${folder}”.` : `New scene notes will go in “${folder}”.`} Nothing existing is moved or changed.` });
		};
		const act = actions(form);
		button(act, { label: 'Cancel', variant: 'ghost', onClick: () => this.close() });
		const ok = button(act, { label: 'Create project', icon: 'book-plus', variant: 'primary', cls: 'ws-wr-create' });
		ok.type = 'submit';
		paintTiles();
		paintTemplates();
		form.addEventListener('submit', (e) => {
			e.preventDefault();
			if (this.busy) return;
			const goalRaw = goalIn.value.replace(/[\s,._']/g, '');
			const goal = goalRaw ? Number(goalRaw) : null;
			if (goal !== null && (!Number.isFinite(goal) || goal < 0)) {
				new Notice('The word goal should be a number, like 90000.');
				goalIn.focus();
				return;
			}
			this.busy = true;
			ok.disabled = true;
			void this.st.w
				.createProject({
					name: titleIn.value.trim() || 'Untitled project',
					kind: this.kind,
					folder: folderIn.value.trim() || undefined,
					description: descIn.value.trim(),
					wordTarget: goal ? Math.round(goal) : null,
					template: this.template,
					createNotes: notesBox.checked && this.template !== 'blank',
				})
				.then(
					(res) => {
						this.close();
						if (res.notesError)
							new Notice(`“${res.project.name}” was created, but ${res.notes.length ? `only ${count(res.notes.length, 'note')} could be made` : 'its notes couldn’t be made'}: ${res.notesError} Scenes without a note have a “Create note” button.`, 12000);
						else new Notice(`“${res.project.name}” is ready${res.notes.length ? `, with ${count(res.notes.length, 'new note')}` : ''}.`);
						this.st.go({ project: res.project.id, view: 'overview' });
					},
					(err) => {
						this.busy = false;
						ok.disabled = false;
						new Notice(`The project couldn’t be created: ${errorText(err)}`);
					},
				);
		});
		window.setTimeout(() => titleIn.focus(), 0);
	}

	override onClose(): void {
		this.contentEl.empty();
	}
}

// ── import a folder ─────────────────────────────────────────────────────────

export class ImportFolderModal extends WorldsmithModal {
	private chapters = true;
	private into: string;
	private folder: string;
	private busy = false;

	constructor(
		private readonly st: Studio,
		opts: { projectId?: string; folder?: string } = {},
	) {
		super(st.ws.app);
		this.modalEl.addClass('ws-wr-modal', 'ws-wr-import');
		this.into = opts.projectId ?? '';
		this.folder = opts.folder ?? (opts.projectId ? (st.w.project(opts.projectId)?.folder ?? '') : '');
	}

	override onOpen(): void {
		this.setTitle('Import a folder of notes');
		const form = this.contentEl.createEl('form', { cls: 'ws-wr-form' });
		form.createEl('p', { cls: 'ws-wr-lead', text: 'Each note in the folder becomes a scene, in the order of the file names. Your notes stay exactly where they are.' });
		const folderIn = folderInput(this.st, field(form, 'Folder'), this.folder, 'Manuscripts/My book', (v) => {
			this.folder = v;
			if (!nameTouched) nameIn.value = cleanPath(v).split('/').pop() ?? '';
			paint();
		});
		const row = form.createDiv({ cls: 'ws-wr-formrow' });
		const intoField = field(row, 'Into');
		const intoSel = intoField.createEl('select', { cls: 'dropdown ws-wr-select' });
		intoSel.id = 'ws-wr-into';
		intoField.querySelector('label')!.htmlFor = intoSel.id;
		intoSel.createEl('option', { text: 'A new project', attr: { value: '' } });
		for (const p of this.st.w.projects()) {
			const o = intoSel.createEl('option', { text: p.name, attr: { value: p.id } });
			if (p.id === this.into) o.selected = true;
		}
		const nameField = field(row, 'Project title');
		let nameTouched = false;
		const nameIn = textInput(nameField, cleanPath(this.folder).split('/').pop() ?? '', 'Title');
		nameIn.addEventListener('input', () => (nameTouched = true));
		const chRow = form.createEl('label', { cls: 'ws-wr-check' });
		const chBox = chRow.createEl('input', { attr: { type: 'checkbox' } });
		chBox.checked = this.chapters;
		chRow.createSpan({ text: 'Subfolders become chapters' });
		chBox.addEventListener('change', () => {
			this.chapters = chBox.checked;
			paint();
		});
		intoSel.addEventListener('change', () => {
			this.into = intoSel.value;
			paint();
		});
		const summary = form.createDiv({ cls: 'ws-wr-import__summary' });
		const list = form.createDiv({ cls: 'ws-wr-import__list', attr: { role: 'list' } });
		const safe = form.createDiv({ cls: 'ws-wr-hint' });
		icon(safe, 'shield-check');
		safe.createSpan({ text: 'Nothing is moved, renamed or changed. Worldsmith only remembers the order, the chapters and the statuses.' });
		const act = actions(form);
		button(act, { label: 'Cancel', variant: 'ghost', onClick: () => this.close() });
		const ok = button(act, { label: 'Import', icon: 'file-input', variant: 'primary', cls: 'ws-wr-import__go' });
		ok.type = 'submit';
		let scenes = 0;
		const paint = () => {
			nameField.toggleClass('is-hidden', !!this.into);
			summary.empty();
			list.empty();
			const v = this.st.w.vault;
			const folder = cleanPath(this.folder);
			if (!v || !folder || !v.isFolder(folder)) {
				scenes = 0;
				ok.disabled = true;
				summary.setText(folder ? `There is no folder “${folder}”. Choose one with notes in it.` : 'Choose the folder your notes are in.');
				return;
			}
			const paths = v.markdownFiles(folder).map((f) => f.path);
			const prev = importPreview(folder, paths, this.chapters, (p) => !!this.st.w.sceneByPath(p));
			scenes = prev.scenes;
			ok.disabled = scenes === 0;
			const parts = [`${count(prev.scenes, 'note')} will be linked as scenes`];
			if (prev.chapters) parts.push(`in ${count(prev.chapters, 'chapter')}`);
			let text = `${parts.join(' ')}.`;
			if (prev.skipped) text += ` ${count(prev.skipped, 'note is', 'notes are')} already in a project and left out.`;
			if (!paths.length) text = 'This folder has no notes in it.';
			summary.setText(text);
			const MAX = 300;
			for (const r of prev.rows.slice(0, MAX)) {
				const li = list.createDiv({ cls: cx('ws-wr-import__row', `is-${r.kind}`, r.nested && 'is-nested', r.skipped && 'is-skipped'), attr: { role: 'listitem' } });
				icon(li, r.kind === 'chapter' ? 'bookmark' : 'file-text');
				li.createSpan({ cls: 'ws-wr-import__name', text: r.title });
				if (r.skipped && r.kind === 'scene') li.createSpan({ cls: 'ws-wr-import__note', text: 'already in a project' });
			}
			if (prev.rows.length > MAX) list.createDiv({ cls: 'ws-wr-import__more', text: `…and ${fmt(prev.rows.length - MAX)} more` });
		};
		paint();
		form.addEventListener('submit', (e) => {
			e.preventDefault();
			if (this.busy || !scenes) return;
			this.busy = true;
			try {
				const res = this.st.w.importFolder({ folder: this.folder, projectId: this.into || undefined, name: nameIn.value.trim() || undefined, chapters: this.chapters });
				this.close();
				const n = res.items.filter((i) => i.kind === 'scene').length;
				actionNotice(`Linked ${count(n, 'note')} in “${res.project.name}”. Nothing in your vault changed.`, {
					label: 'Undo',
					run: () => void this.st.w.undo(res.undo).catch((err) => new Notice(errorText(err))),
				});
				this.st.go({ project: res.project.id, view: 'overview' });
			} catch (err) {
				this.busy = false;
				new Notice(`The folder couldn’t be imported: ${errorText(err)}`);
			}
		});
		window.setTimeout(() => folderIn.focus(), 0);
	}

	override onClose(): void {
		this.contentEl.empty();
	}
}

// ── project details ─────────────────────────────────────────────────────────

export class ProjectDetailsModal extends WorldsmithModal {
	constructor(
		private readonly st: Studio,
		private readonly project: WritingProject,
	) {
		super(st.ws.app);
		this.modalEl.addClass('ws-wr-modal');
	}

	override onOpen(): void {
		const p = this.project;
		this.setTitle('Project details');
		const form = this.contentEl.createEl('form', { cls: 'ws-wr-form' });
		const nameIn = textInput(field(form, 'Title'), p.name);
		const row = form.createDiv({ cls: 'ws-wr-formrow' });
		const kindField = field(row, 'Kind');
		const kindSel = kindField.createEl('select', { cls: 'dropdown ws-wr-select' });
		kindSel.id = 'ws-wr-kind';
		kindField.querySelector('label')!.htmlFor = kindSel.id;
		for (const k of PROJECT_KINDS) {
			const o = kindSel.createEl('option', { text: kindLabel(k), attr: { value: k } });
			if (k === p.kind) o.selected = true;
		}
		const goalIn = textInput(field(row, 'Word goal'), p.wordTarget ? String(p.wordTarget) : '', 'none');
		goalIn.inputMode = 'numeric';
		// WS6: words a day, and a day to finish by (both optional).
		const row2 = form.createDiv({ cls: 'ws-wr-row' });
		const dailyIn = textInput(field(row2, 'Daily goal'), p.dailyGoal ? String(p.dailyGoal) : '', 'none');
		dailyIn.inputMode = 'numeric';
		dailyIn.addClass('ws-wr-daily-goal');
		const dlField = field(row2, 'Finish by');
		const deadlineIn = dlField.createEl('input', { cls: 'ws-input ws-wr-input ws-wr-deadline', attr: { type: 'date', id: 'ws-wr-deadline' } });
		deadlineIn.value = p.deadline ?? '';
		dlField.querySelector('label')!.htmlFor = deadlineIn.id;
		const row4 = form.createDiv({ cls: 'ws-wr-row' });
		const weeklyIn = textInput(field(row4, 'Weekly goal'), p.weeklyGoal ? String(p.weeklyGoal) : '', p.dailyGoal ? `${p.dailyGoal * 7} (daily × 7)` : 'none');
		weeklyIn.inputMode = 'numeric';
		weeklyIn.addClass('ws-wr-weekly-goal');
		const monthlyIn = textInput(field(row4, 'Monthly goal'), p.monthlyGoal ? String(p.monthlyGoal) : '', p.dailyGoal ? `${p.dailyGoal * 30} (daily × 30)` : 'none');
		monthlyIn.inputMode = 'numeric';
		monthlyIn.addClass('ws-wr-monthly-goal');
		form.createDiv({ cls: 'ws-wr-field__help', text: 'With a daily goal, a streak is the days in a row you met it; without one, the days you wrote anything. With a word goal and a day to finish by, the Overview shows how many words a day you need.' });
		// 0.28: genre, series and a tagline (the Overview shows them).
		const row3 = form.createDiv({ cls: 'ws-wr-row' });
		const genreIn = textInput(field(row3, 'Genre'), p.genre ?? '', 'Epic fantasy');
		genreIn.addClass('ws-wr-genre');
		const seriesIn = textInput(field(row3, 'Series'), p.series ?? '', 'The Ashen Chronicles, Book One');
		seriesIn.addClass('ws-wr-series');
		const taglineIn = textInput(field(form, 'Tagline or epigraph'), p.tagline ?? '', 'Every oath is a binding. Every binding is a debt.');
		taglineIn.addClass('ws-wr-tagline');
		const descField = field(form, 'Description');
		const desc = descField.createEl('textarea', { cls: 'ws-input ws-wr-textarea', attr: { rows: '3' } });
		desc.id = 'ws-wr-desc';
		descField.querySelector('label')!.htmlFor = desc.id;
		desc.value = p.description;
		let folder = p.folder;
		const folderField = field(form, 'Folder for new notes');
		folderInput(this.st, folderField, p.folder, '', (v) => (folder = v));
		folderField.createDiv({ cls: 'ws-wr-field__help', text: 'New scene notes are made here. Notes already in the project stay where they are.' });
		const act = actions(form);
		button(act, { label: 'Cancel', variant: 'ghost', onClick: () => this.close() });
		const ok = button(act, { label: 'Save', variant: 'primary' });
		ok.type = 'submit';
		form.addEventListener('submit', (e) => {
			e.preventDefault();
			const raw = goalIn.value.replace(/[\s,._']/g, '');
			const goal = raw ? Number(raw) : null;
			if (goal !== null && (!Number.isFinite(goal) || goal < 0)) {
				new Notice('The word goal should be a number, like 90000.');
				return;
			}
			const rawDaily = dailyIn.value.replace(/[\s,._']/g, '');
			const daily = rawDaily ? Number(rawDaily) : null;
			if (daily !== null && (!Number.isFinite(daily) || daily < 0)) {
				new Notice('The daily goal should be a number, like 500.');
				return;
			}
			const deadline = /^\d{4}-\d{2}-\d{2}$/.test(deadlineIn.value) ? deadlineIn.value : null;
			try {
				const { before, after } = this.st.w.updateProject(p.id, {
					name: nameIn.value.trim() || p.name,
					kind: kindSel.value as ProjectKind,
					description: desc.value.trim(),
					wordTarget: goal ? Math.round(goal) : null,
					dailyGoal: daily ? Math.round(daily) : null,
					weeklyGoal: Number(weeklyIn.value.replace(/[\s,._']/g, '')) > 0 ? Math.round(Number(weeklyIn.value.replace(/[\s,._']/g, ''))) : null,
					monthlyGoal: Number(monthlyIn.value.replace(/[\s,._']/g, '')) > 0 ? Math.round(Number(monthlyIn.value.replace(/[\s,._']/g, ''))) : null,
					genre: genreIn.value.trim(),
					series: seriesIn.value.trim(),
					tagline: taglineIn.value.trim(),
					deadline,
					folder: folder.trim() ? folder : p.folder,
				});
				this.close();
				actionNotice('Project details saved.', { label: 'Undo', run: () => this.st.w.restoreProject(before, after) });
			} catch (err) {
				new Notice(errorText(err));
			}
		});
		window.setTimeout(() => nameIn.focus(), 0);
	}

	override onClose(): void {
		this.contentEl.empty();
	}
}

// ── move to ─────────────────────────────────────────────────────────────────

/** Move an item into any part or chapter (or the top level), at a chosen place. The touch and keyboard way to reorder. */
export class MoveToModal extends WorldsmithModal {
	constructor(
		private readonly st: Studio,
		private readonly item: ManuscriptItem,
	) {
		super(st.ws.app);
		this.modalEl.addClass('ws-wr-modal', 'ws-wr-moveto');
	}

	override onOpen(): void {
		const it = this.item;
		const m = binderModel(this.st.w.tree(it.projectId));
		this.setTitle(`Move “${it.title}”`);
		const form = this.contentEl.createEl('form', { cls: 'ws-wr-form' });
		const dests = moveDestinations(m, it.id);
		let dest: string | null = it.parentId && dests.some((d) => d.id === it.parentId) ? it.parentId : (dests[0]?.id ?? null);
		form.createDiv({ cls: 'ws-wr-field__label', text: 'Into' });
		const list = form.createDiv({ cls: 'ws-wr-dests', attr: { role: 'radiogroup', 'aria-label': 'Where to' } });
		const posField = field(form, 'Where in it');
		const posSel = posField.createEl('select', { cls: 'dropdown ws-wr-select' });
		posSel.id = 'ws-wr-pos';
		posField.querySelector('label')!.htmlFor = posSel.id;
		const paintPositions = () => {
			posSel.empty();
			const kids = (m.kids.get(dest) ?? []).filter((k) => k !== it.id);
			posSel.createEl('option', { text: 'At the start', attr: { value: '0' } });
			kids.forEach((k, i) => {
				const n = m.nodes.get(k);
				if (n) posSel.createEl('option', { text: `After “${n.title}”`, attr: { value: String(i + 1) } });
			});
			// Default: where it is now when staying in the same place, else at the end.
			const here = dest === it.parentId ? (m.kids.get(dest) ?? []).indexOf(it.id) : kids.length;
			posSel.value = String(Math.max(0, Math.min(kids.length, here)));
		};
		const paintList = () => {
			list.empty();
			for (const d of dests) {
				const b = list.createEl('button', { cls: cx('ws-wr-dest', d.id === dest && 'is-active', `is-${d.kind}`), attr: { type: 'button', role: 'radio', 'aria-checked': String(d.id === dest) } });
				b.style.setProperty('--ws-wr-indent', String(d.depth));
				icon(b, d.kind === 'root' ? 'book' : d.kind === 'part' ? 'book-open' : 'bookmark');
				b.createSpan({ text: d.kind === 'chapter' && m.chapterNo.get(d.id!) ? `${m.chapterNo.get(d.id!)}. ${d.title}` : d.title });
				b.addEventListener('click', () => {
					dest = d.id;
					paintList();
					paintPositions();
				});
			}
		};
		paintList();
		paintPositions();
		const act = actions(form);
		button(act, { label: 'Cancel', variant: 'ghost', onClick: () => this.close() });
		const ok = button(act, { label: 'Move', icon: 'move', variant: 'primary', cls: 'ws-wr-moveto__go' });
		ok.type = 'submit';
		form.addEventListener('submit', (e) => {
			e.preventDefault();
			try {
				const u = this.st.w.move(it.id, { parentId: dest, index: Number(posSel.value) });
				this.close();
				const where = dest ? (m.nodes.get(dest)?.title ?? 'its new place') : 'the top level';
				actionNotice(`Moved “${it.title}” to ${dest ? `“${where}”` : where}.`, { label: 'Undo', run: () => void this.st.w.undo(u).catch((err) => new Notice(errorText(err))) });
			} catch (err) {
				new Notice(errorText(err));
			}
		});
	}

	override onClose(): void {
		this.contentEl.empty();
	}
}

// ── split ───────────────────────────────────────────────────────────────────

/** Scenes being split or merged from this window (their buttons are disabled meanwhile). */
export const busyScenes = new Set<string>();

/**
 * Split a scene between two paragraphs. The dialog reads the note, shows its paragraphs and
 * a place to cut between each pair; the cut's offset is measured against exactly the text
 * read, which is passed along so the split is refused if the note changed since.
 */
export class SplitModal extends WorldsmithModal {
	private text = '';
	private paras: Paragraph[] = [];
	private at = -1;

	constructor(
		private readonly st: Studio,
		private readonly scene: ManuscriptItem,
		private readonly done?: (created: ManuscriptItem) => void,
	) {
		super(st.ws.app);
		this.modalEl.addClass('ws-wr-modal', 'ws-wr-split');
	}

	override onOpen(): void {
		this.setTitle(`Split “${this.scene.title}”`);
		const c = this.contentEl;
		c.createDiv({ cls: 'ws-wr-lead', text: 'Choose where the new scene starts. The text after that point goes into a new note right after this one; the note is written first, so nothing can be lost.' });
		const body = c.createDiv({ cls: 'ws-wr-split__text', text: 'Reading the note…' });
		const form = c.createEl('form', { cls: 'ws-wr-form' });
		const titleIn = textInput(field(form, 'Title of the new scene'), `${this.scene.title} (continued)`);
		const act = actions(form);
		button(act, { label: 'Cancel', variant: 'ghost', onClick: () => this.close() });
		const ok = button(act, { label: 'Split scene', icon: 'scissors', variant: 'primary', cls: 'ws-wr-split__go' });
		ok.type = 'submit';
		ok.disabled = true;
		const v = this.st.w.vault;
		const path = this.scene.notePath;
		if (!v || !path || !v.file(path)) {
			body.setText('This scene’s note wasn’t found, so it can’t be split.');
			return;
		}
		// What's typed in the studio but not saved yet is part of the text to split.
		void EmbeddedEditor.saveOpen([path]).then(() => v.read(path)).then(
			(text) => {
				this.text = text;
				this.paras = noteParagraphs(text);
				body.empty();
				if (this.paras.length < 2) {
					body.setText('This scene has only one paragraph. Add a blank line where the new scene should start, then split it.');
					return;
				}
				const paint = () => {
					body.empty();
					this.paras.forEach((p, i) => {
						if (i > 0) {
							const cut = body.createEl('button', { cls: cx('ws-wr-cut', i === this.at && 'is-active'), attr: { type: 'button', 'data-at': String(i), 'aria-pressed': String(i === this.at) } });
							icon(cut, 'scissors');
							cut.createSpan({ text: i === this.at ? 'The new scene starts here' : 'Split here' });
							cut.addEventListener('click', () => {
								this.at = i;
								ok.disabled = false;
								paint();
							});
						}
						body.createDiv({ cls: cx('ws-wr-para', this.at > 0 && i >= this.at && 'is-after'), text: p.text.length > 600 ? `${p.text.slice(0, 600)}…` : p.text });
					});
				};
				paint();
			},
			(err) => body.setText(`The note couldn’t be read: ${errorText(err)}`),
		);
		form.addEventListener('submit', (e) => {
			e.preventDefault();
			const p = this.paras[this.at];
			if (!p || busyScenes.has(this.scene.id)) return;
			ok.disabled = true;
			busyScenes.add(this.scene.id);
			// The text moved into the new note isn't new writing.
			holdSession(this.scene.projectId, [this.scene.notePath]);
			void this.st.w
				.split(this.scene.id, p.start, { title: titleIn.value, expectedText: this.text })
				.then(
					(res) => {
						this.close();
						actionNotice(`Split “${this.scene.title}”. The new scene is “${res.created.title}”.`, {
							label: 'Undo',
							run: () => {
								holdSession(res.undo.projectId, null);
								void this.st.w.undo(res.undo).catch((err) => new Notice(errorText(err)));
							},
						});
						this.done?.(res.created);
					},
					(err) => {
						ok.disabled = false;
						new Notice(errorText(err));
					},
				)
				.finally(() => busyScenes.delete(this.scene.id));
		});
	}

	override onClose(): void {
		this.contentEl.empty();
	}
}

// ── choose a note (relink) ──────────────────────────────────────────────────

/** Point a scene at another note: the likely matches first, then every free note. */
export class NoteChoiceModal extends FuzzySuggestModal<string> {
	private items: string[];
	private likely: Set<string>;
	constructor(
		private readonly st: Studio,
		private readonly scene: ManuscriptItem,
		candidates: string[],
	) {
		super(st.ws.app);
		this.modalEl.addClass('worldsmith-modal');
		this.setPlaceholder(`Which note is “${scene.title}”?`);
		this.emptyStateText = 'No free note matches.';
		this.likely = new Set(candidates);
		const all = (st.w.vault?.markdownFiles('') ?? []).map((f) => f.path).filter((p) => !this.likely.has(p) && !st.w.sceneByPath(p));
		this.items = [...candidates, ...all.sort()];
	}
	getItems(): string[] {
		return this.items;
	}
	getItemText(p: string): string {
		return p;
	}
	override renderSuggestion(m: FuzzyMatch<string>, el: HTMLElement): void {
		el.createSpan({ text: m.item });
		if (this.likely.has(m.item)) el.createSpan({ cls: 'ws-wr-likely', text: ' · same name' });
	}
	onChooseItem(p: string): void {
		try {
			const u = this.st.w.relink(this.scene.id, p);
			actionNotice(`“${this.scene.title}” now uses “${p}”.`, { label: 'Undo', run: () => void this.st.w.undo(u) });
		} catch (err) {
			new Notice(errorText(err));
		}
	}
}

