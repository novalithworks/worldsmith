import { Menu, Notice, setIcon } from 'obsidian';
import type { StoryBeat, WritingProject } from '../../core/types';
import { STORY_STRUCTURES } from '../../services/writing/structures';
import { button, cx, icon } from '../components/dom';
import { confirmModal, promptModal } from '../components/modals';
import { actionNotice } from '../components/notice';
import { undoNotice } from './actions';
import { head, type Studio, type StudioScreen } from './kit';
import { binderModel, count, roman, chapterOf as chapterNode } from './model';
import { SaveTemplateModal, ScenePickerModal, ThreadsModal } from './planDialogs';

/*
 * The Plot tab (WS4): a story structure to plan against, the plot threads across the book,
 * and the templates you saved. A structure's beats are only planning marks: choosing one
 * never creates, moves or changes chapters or scenes. "Add empty chapters for these beats"
 * is a separate, undoable step that only adds new, empty chapters at the end.
 */

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export class PlotScreen implements StudioScreen {
	private root!: HTMLElement;

	constructor(
		private readonly st: Studio,
		private readonly el: HTMLElement,
	) {}

	private get p(): WritingProject {
		return this.st.project!;
	}

	mount(): void {
		this.root = this.el.createDiv({ cls: 'ws-wr-plot' });
		this.refresh();
	}

	refresh(): void {
		const a = activeDocument.activeElement;
		const focusKey = a instanceof HTMLElement && this.root.contains(a) ? (a.dataset.key ?? null) : null;
		this.root.empty();
		const p = this.p;
		const tools = head(this.root, { eyebrow: 'Plot', title: 'Story structure', sub: 'A shape to plan against. Choosing one only adds beats here: your chapters and scenes stay exactly as they are.' });
		button(tools, { label: 'New plot thread', icon: 'plus', variant: 'ghost', size: 'sm', cls: 'ws-wr-plot__newthread', onClick: () => new ThreadsModal(this.st, p, { addOne: true }).open() });
		this.structurePicker();
		this.beats();
		this.threads();
		this.templates();
		if (focusKey) this.root.querySelector<HTMLElement>(`[data-key="${CSS.escape(focusKey)}"]`)?.focus({ preventScroll: true });
	}

	// ── structure ───────────────────────────────────────────────────────────

	private structurePicker(): void {
		const p = this.p;
		const own = this.st.w.templates().filter((t) => t.beats.length);
		const bar = this.root.createDiv({ cls: 'ws-segmented ws-wr-plot__structures', attr: { role: 'radiogroup', 'aria-label': 'Story structure' } });
		const opt = (id: string | null, label: string, title?: string) => {
			const on = (p.structure ?? null) === id;
			const b = bar.createEl('button', { cls: cx('ws-segmented__item', on && 'is-active'), text: label, attr: { type: 'button', role: 'radio', 'aria-checked': String(on), 'data-structure': id ?? 'none', 'data-key': `s:${id ?? 'none'}` } });
			if (title) b.setAttr('title', title);
			b.addEventListener('click', () => {
				if (on) return;
				try {
					const { before, after } = this.st.w.useStructure(p.id, id);
					const added = after.beats.length - before.beats.length;
					actionNotice(id ? `${label}${added ? `: ${count(added, 'beat')} added` : ''}. Your chapters and scenes didn’t change.` : 'No structure shown. The beats are kept for when you choose it again.', { label: 'Undo', run: () => this.st.w.restoreProject(before, after) });
				} catch (e) {
					new Notice(errorText(e));
				}
			});
		};
		opt(null, 'None');
		for (const s of STORY_STRUCTURES) opt(s.id, s.name, s.description);
		for (const t of own) opt(`own:${t.id}`, t.name, t.description);
		opt('custom', 'Your own beats', 'Start with no beats and add your own');
	}

	private beats(): void {
		const p = this.p;
		const st = this.st;
		const box = this.root.createDiv({ cls: 'ws-wr-plot__beats' });
		if (!p.structure) {
			box.createDiv({ cls: 'ws-wr-none', text: 'Choose a structure above to see its beats, or “Your own beats” to make your own.' });
			return;
		}
		const beats = p.beats.filter((b) => b.source === p.structure);
		const scenes = st.w.scenes(p.id);
		const at = new Map(scenes.map((s, i) => [s.id, { s, i }]));
		const groups: Array<{ name: string; beats: StoryBeat[] }> = [];
		for (const b of beats) {
			let g = groups.find((x) => x.name === b.group);
			if (!g) groups.push((g = { name: b.group, beats: [] }));
			g.beats.push(b);
		}
		const cols = box.createDiv({ cls: 'ws-wr-plot__groups' });
		for (const g of groups) {
			const col = cols.createDiv({ cls: 'ws-wr-plot__group' });
			col.createDiv({ cls: 'ws-wr-caps ws-wr-plot__gname', text: g.name || 'Beats' });
			for (const b of g.beats) {
				const card = col.createDiv({ cls: cx('ws-wr-beat', !b.sceneIds.some((id) => at.has(id)) && 'is-open'), attr: { 'data-beat': b.id } });
				const h = card.createDiv({ cls: 'ws-wr-beat__head' });
				h.createSpan({ cls: 'ws-wr-beat__name', text: b.label });
				if (b.position !== null) h.createSpan({ cls: 'ws-wr-beat__pos', text: `${Math.round(b.position)}%`, attr: { title: 'Where this beat usually falls in the book' } });
				const more = h.createEl('button', { cls: 'ws-wr-beat__more clickable-icon', attr: { type: 'button', 'aria-label': `Menu for ${b.label}`, 'data-key': `b:${b.id}` } });
				setIcon(more, 'more-horizontal');
				more.addEventListener('click', (e) => this.beatMenu(b, e));
				if (b.description) card.createDiv({ cls: 'ws-wr-beat__desc', text: b.description });
				const chips = card.createDiv({ cls: 'ws-wr-beat__scenes' });
				for (const id of b.sceneIds) {
					const x = at.get(id);
					if (!x) continue;
					const pct = scenes.length ? Math.round(((x.i + 0.5) / scenes.length) * 100) : 0;
					const chip = chips.createDiv({ cls: 'ws-wr-beat__scene' });
					const open = chip.createEl('button', { cls: 'ws-wr-beat__open', attr: { type: 'button', title: `Scene ${x.i + 1}, ${pct}% through the book` } });
					icon(open, 'file-text');
					open.createSpan({ text: x.s.title });
					open.addEventListener('click', () => st.go({ project: p.id, view: 'manuscript', item: id }));
					const rm = chip.createEl('button', { cls: 'ws-wr-beat__unlink clickable-icon', attr: { type: 'button', 'aria-label': `Take “${x.s.title}” off ${b.label}` } });
					setIcon(rm, 'x');
					rm.addEventListener('click', () => this.link(b, id, false));
				}
				const add = chips.createEl('button', { cls: 'ws-wr-beat__add', attr: { type: 'button', 'data-key': `a:${b.id}` } });
				add.setText(b.sceneIds.some((id) => at.has(id)) ? '+ Another scene' : '+ Choose a scene');
				add.addEventListener('click', () => new ScenePickerModal(st, scenes.filter((s) => !b.sceneIds.includes(s.id)), (s) => this.link(b, s.id, true)).open());
			}
		}
		const foot = box.createDiv({ cls: 'ws-wr-plot__beatfoot' });
		button(foot, { label: 'Add a beat', icon: 'plus', variant: 'ghost', size: 'sm', cls: 'ws-wr-plot__addbeat', onClick: () => void this.addBeat(groups[groups.length - 1]?.name ?? '') });
		if (beats.length)
			button(foot, {
				label: 'Add empty chapters for these beats',
				icon: 'bookmark-plus',
				variant: 'ghost',
				size: 'sm',
				cls: 'ws-wr-plot__plan',
				tooltip: 'Adds one new, empty chapter per beat at the end of the book. Nothing existing changes; Undo takes them away again.',
				onClick: () => void this.planChapters(beats.length),
			});
		if (!beats.length) foot.createSpan({ cls: 'ws-wr-muted', text: 'No beats yet.' });
	}

	private link(b: StoryBeat, sceneId: string, on: boolean): void {
		const p = this.p;
		const scene = this.st.w.item(sceneId);
		try {
			const { before, after } = this.st.w.editBeats(p.id, (list) => list.map((x) => (x.id !== b.id ? x : { ...x, sceneIds: on ? [...x.sceneIds, sceneId] : x.sceneIds.filter((y) => y !== sceneId) })));
			actionNotice(on ? `“${scene?.title ?? 'The scene'}” carries ${b.label} now.` : `“${scene?.title ?? 'The scene'}” is off ${b.label}.`, { label: 'Undo', run: () => this.st.w.restoreProject(before, after) });
		} catch (e) {
			new Notice(errorText(e));
		}
	}

	private beatMenu(b: StoryBeat, e: MouseEvent): void {
		const p = this.p;
		const m = new Menu();
		const edit = (patch: Partial<StoryBeat>, msg: string) => {
			const { before, after } = this.st.w.editBeats(p.id, (list) => list.map((x) => (x.id === b.id ? { ...x, ...patch } : x)));
			actionNotice(msg, { label: 'Undo', run: () => this.st.w.restoreProject(before, after) });
		};
		m.addItem((i) =>
			i
				.setTitle('Rename…')
				.setIcon('pencil')
				.onClick(async () => {
					const v = await promptModal(this.st.ws.app, { title: 'Rename beat', label: 'Name', value: b.label, confirmLabel: 'Rename' });
					if (v?.trim() && v.trim() !== b.label) edit({ label: v.trim() }, `Renamed to “${v.trim()}”.`);
				}),
		);
		m.addItem((i) =>
			i
				.setTitle('Describe…')
				.setIcon('text')
				.onClick(async () => {
					const v = await promptModal(this.st.ws.app, { title: `About ${b.label}`, label: 'What happens here', value: b.description, confirmLabel: 'Save' });
					if (v !== null && v !== b.description) edit({ description: v.trim() }, 'Beat saved.');
				}),
		);
		m.addItem((i) =>
			i
				.setTitle('Where it falls…')
				.setIcon('percent')
				.onClick(async () => {
					const v = await promptModal(this.st.ws.app, { title: `Where ${b.label} falls`, label: 'Percent through the book (0–100), or empty', value: b.position === null ? '' : String(b.position), confirmLabel: 'Save' });
					if (v === null) return;
					const n = v.trim() === '' ? null : Number(v.replace('%', ''));
					if (n !== null && (!Number.isFinite(n) || n < 0 || n > 100)) return void new Notice('That should be a number from 0 to 100.');
					edit({ position: n }, 'Beat saved.');
				}),
		);
		m.addSeparator();
		m.addItem((i) =>
			i
				.setTitle('Remove beat')
				.setIcon('trash-2')
				.setWarning(true)
				.onClick(() => {
					const { before, after } = this.st.w.editBeats(p.id, (list) => list.filter((x) => x.id !== b.id));
					actionNotice(`Removed the beat “${b.label}”. Its scenes didn’t change.`, { label: 'Undo', run: () => this.st.w.restoreProject(before, after) });
				}),
		);
		m.showAtMouseEvent(e);
	}

	private async addBeat(group: string): Promise<void> {
		const p = this.p;
		const v = await promptModal(this.st.ws.app, { title: 'New beat', label: 'Name', placeholder: 'e.g. The betrayal', confirmLabel: 'Add beat' });
		if (!v?.trim()) return;
		const id = `beat-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
		const { before, after } = this.st.w.editBeats(p.id, (list) => [...list, { id, label: v.trim(), description: '', group, position: null, sceneIds: [], source: p.structure ?? 'custom' }]);
		actionNotice(`Added the beat “${v.trim()}”.`, { label: 'Undo', run: () => this.st.w.restoreProject(before, after) });
	}

	private async planChapters(n: number): Promise<void> {
		const ok = await confirmModal(this.st.ws.app, {
			title: `Add ${count(n, 'empty chapter')}?`,
			body: 'One new chapter per beat, named after it, at the end of the book. They have no notes and no scenes yet. Nothing that is there now moves or changes, and Undo takes them away again.',
			confirmLabel: 'Add chapters',
		});
		if (!ok) return;
		try {
			const r = this.st.w.planChapters(this.p.id);
			undoNotice(this.st, `Added ${count(r.items.length, 'empty chapter')} at the end of the book.`, r.undo);
		} catch (e) {
			new Notice(errorText(e));
		}
	}

	// ── plot threads ────────────────────────────────────────────────────────

	private threads(): void {
		const p = this.p;
		const st = this.st;
		const sec = this.root.createEl('section', { cls: 'ws-wr-panel ws-wr-plot__threads' });
		const h = sec.createDiv({ cls: 'ws-wr-panel__head' });
		h.createEl('h3', { cls: 'ws-wr-panel__title', text: 'Plot threads across the book' });
		button(h, { label: p.threads.length ? 'Edit plot threads…' : 'New plot thread', icon: p.threads.length ? 'pencil' : 'plus', variant: 'ghost', size: 'sm', cls: 'ws-wr-plot__editthreads', onClick: () => new ThreadsModal(st, p, { addOne: !p.threads.length }).open() });
		if (!p.threads.length) {
			sec.createDiv({ cls: 'ws-wr-muted', text: 'Plot threads are the storylines that run through the book: the main plot, a romance, a mystery. Put scenes in them from a scene’s menu, the inspector or the boards, and see here where each one appears.' });
			return;
		}
		const tree = st.w.tree(p.id);
		const m = binderModel(tree);
		const scenes = st.w.scenes(p.id);
		// Columns: each chapter in order, and a column for scenes outside chapters when there are any.
		const chapterOf = (id: string): string => {
			const ch = chapterNode(m, id);
			if (ch) return ch.id;
			return '';
		};
		const chapters = m.rows.length ? [...m.nodes.values()].filter((n) => n.kind === 'chapter') : [];
		const cols: Array<{ id: string; label: string }> = chapters.map((c) => ({ id: c.id, label: `Ch ${roman(m.chapterNo.get(c.id) ?? 0)}` }));
		if (scenes.some((s) => !chapterOf(s.id))) cols.unshift({ id: '', label: 'No chapter' });
		const wrap = sec.createDiv({ cls: 'ws-wr-plot__gridwrap' });
		const grid = wrap.createDiv({ cls: 'ws-wr-plot__grid', attr: { role: 'grid', 'aria-label': 'Plot threads by chapter' } });
		grid.style.setProperty('--ws-wr-plot-cols', String(Math.max(1, cols.length)));
		const hr = grid.createDiv({ cls: 'ws-wr-plot__row ws-wr-plot__row--head', attr: { role: 'row' } });
		hr.createDiv({ cls: 'ws-wr-plot__thread', attr: { role: 'columnheader' } });
		for (const c of cols) hr.createDiv({ cls: 'ws-wr-caps ws-wr-plot__col', text: c.label, attr: { role: 'columnheader', title: c.id ? (m.nodes.get(c.id)?.title ?? '') : 'Scenes outside chapters' } });
		for (const t of p.threads) {
			const mine = scenes.filter((s) => s.threads.includes(t.id));
			const row = grid.createDiv({ cls: 'ws-wr-plot__row', attr: { role: 'row', 'data-thread': t.id } });
			const name = row.createDiv({ cls: 'ws-wr-plot__thread', attr: { role: 'rowheader' } });
			name.createSpan({ cls: cx('ws-wr-dot', `ws-tint--${t.color ?? 'gray'}`) });
			const tx = name.createDiv({ cls: 'ws-wr-plot__tname' });
			tx.createDiv({ text: t.label });
			const last = mine[mine.length - 1];
			const lastCh = last ? chapterOf(last.id) : '';
			tx.createDiv({ cls: 'ws-wr-muted', text: mine.length ? `${count(mine.length, 'scene')}${lastCh ? ` · last in Ch ${roman(m.chapterNo.get(lastCh) ?? 0)}` : ''}` : 'No scenes yet' });
			for (const c of cols) {
				const cell = row.createDiv({ cls: 'ws-wr-plot__cell', attr: { role: 'gridcell' } });
				for (const s of mine.filter((x) => chapterOf(x.id) === c.id)) {
					const pill = cell.createEl('button', { cls: cx('ws-wr-plot__pill', `ws-tint--${t.color ?? 'gray'}`), attr: { type: 'button', title: s.title, 'aria-label': `${s.title}, in ${t.label}` } });
					pill.addEventListener('click', () => st.go({ project: p.id, view: 'manuscript', item: s.id }));
				}
			}
		}
	}

	// ── your templates ──────────────────────────────────────────────────────

	private templates(): void {
		const p = this.p;
		const st = this.st;
		const sec = this.root.createEl('section', { cls: 'ws-wr-panel ws-wr-plot__tpls' });
		const h = sec.createDiv({ cls: 'ws-wr-panel__head' });
		h.createEl('h3', { cls: 'ws-wr-panel__title', text: 'Your templates' });
		button(h, { label: 'Save this project as a template…', icon: 'bookmark-plus', variant: 'ghost', size: 'sm', cls: 'ws-wr-plot__savetpl', onClick: () => new SaveTemplateModal(st, p).open() });
		const list = st.w.templates();
		if (!list.length) {
			sec.createDiv({ cls: 'ws-wr-muted', text: 'Save a project’s structure (parts, chapters, scene titles and synopses, beats, statuses and plot threads; never the text) to start new projects from it.' });
			return;
		}
		for (const t of list) {
			const row = sec.createDiv({ cls: 'ws-wr-plot__tpl', attr: { 'data-template': t.id } });
			icon(row, 'bookmark');
			const tx = row.createDiv({ cls: 'ws-wr-plot__tpltext' });
			tx.createDiv({ cls: 'ws-wr-plot__tplname', text: t.name });
			if (t.description) tx.createDiv({ cls: 'ws-wr-muted', text: t.description });
			button(row, {
				label: 'Delete',
				variant: 'quiet',
				size: 'sm',
				cls: 'ws-wr-plot__deltpl',
				onClick: () => {
					st.w.removeTemplate(t.id);
					actionNotice(`Deleted the template “${t.name}”. Projects made from it don’t change.`, { label: 'Undo', run: () => st.w.restoreTemplate(t.id) });
				},
			});
		}
	}
}
