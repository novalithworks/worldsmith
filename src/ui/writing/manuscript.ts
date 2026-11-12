import { renderTodayBadge } from './progressUi';
import { sprint, sprintWords, startSprint, timeLeft } from './sprint';
import { renderSideOutline, renderSideResearch } from './sidePanes';
import { Menu, Notice, setIcon } from 'obsidian';
import type { ManuscriptItem, ManuscriptKind } from '../../core/types';
import { button, cx, icon, pinStyles } from '../components/dom';
import { observeWidth, own } from '../components/lifecycle';
import { chooseNote, createItem, createNote, findAgain, importFolder, itemMenu, mergeWithNext, moveStep, nextScene, openNote, renameItem, setStatus, takeIntent, trashItem, undoNotice } from './actions';
import { DEFAULT_SPLIT, deviceMemory, SIDE_MAX, SIDE_MIN, type DeviceMemory, type SideKind, type SplitState } from './device';
import { busyScenes, MoveToModal, SplitModal } from './dialogs';
import { Inspector, itemTextField, type FlushSlot } from './inspector';
import { bar as progressBar, caps, dot, fmt, ornament, type Studio, type StudioScreen } from './kit';
import { applyWritingLook, paintSurface } from './look';
import { binderModel, count, dropTarget, itemWord, roman, statusOf, type BinderModel, type DropTarget } from './model';
import { ScenePane } from './scenePane';
import { sessionDelta, sessionLabel } from './session';
import { openWritingSettings } from './settingsPanel';
import type { Popover } from '../components/popover';
import { renderToolbar } from './toolbar';

/*
 * The Manuscript tab: the "Contents" binder on the left (WS2), the page in the middle and a
 * side pane on the right (WS3). The binder reorders by dragging (with a drop line showing
 * exactly where things land), by keys (Alt+↑/↓), and by "Move to…" / "Move up/down" in the
 * menu, which is how it's done on touch screens.
 *
 * A scene opens on the page in Obsidian's own editor (`ScenePane`); a part or chapter (or a
 * scene whose note is missing) shows its details on paper, as in WS2. The side pane shows
 * the inspector, another scene (a second editor) or the scene's note in reading view;
 * which one, and how wide, is remembered per project on this device. Focus mode fills the
 * pane with just the page (Esc leaves).
 */

const INDENT = 14;
/** Narrower than this, the side pane is a sheet over the page. */
const SIDE_INLINE = 1000;
const SIDE_LABEL: Record<Exclude<SideKind, 'none'>, string> = { inspector: 'Inspector', outline: 'Outline', research: 'Research', scene: 'Another scene', note: 'Note' };

export class ManuscriptScreen implements StudioScreen {
	/** Unsubscribes the status bar's today counter (WS6). */
	private badgeOff: (() => void) | null = null;
	private query = '';
	private selected: string | null;
	private model!: BinderModel;
	private root!: HTMLElement;
	private listEl!: HTMLElement;
	private lineEl!: HTMLElement;
	private tipEl!: HTMLElement;
	private searchEl!: HTMLInputElement;
	private detailEl!: HTMLElement;
	private crumbsEl!: HTMLElement;
	private statusEl!: HTMLElement;
	private dragIds: string[] | null = null;
	private drop: DropTarget | null = null;
	/** The page couldn't be redrawn while something in it was being typed. */
	private detailStale = false;
	/** Saves the synopsis being edited on the page (if any) right away. */
	private synSlot: FlushSlot = { flush: null };
	private writeEl!: HTMLElement;
	private toolbarEl!: HTMLElement;
	private focusTopEl!: HTMLElement;
	private sessionEl!: HTMLElement;
	private sideEl!: HTMLElement;
	private sideHeadEl!: HTMLElement;
	private sideBodyEl!: HTMLElement;
	private resizerEl!: HTMLElement;
	private sideBtn!: HTMLButtonElement;
	private memory!: DeviceMemory;
	private split: SplitState = { ...DEFAULT_SPLIT };
	/** The main page: the selected scene in Obsidian's editor. */
	private page: ScenePane | null = null;
	/** The second page beside it: another scene, or this scene's note in reading view. */
	private sidePage: ScenePane | null = null;
	private sidePageKind: SideKind | null = null;
	private inspector: Inspector | null = null;
	/** The page the toolbar acts on (the one last written in). */
	private activePane: ScenePane | null = null;
	private focusMode = false;
	/** The writing settings opened from focus mode's top bar. */
	private settingsPop: Popover | null = null;
	/** Narrow: the side pane is a sheet over the page, open or not. */
	private narrow = false;
	private sideSheet = false;
	/** The scene shown on the page (so a redraw for the same scene keeps the editor as it is). */
	private writing: string | null = null;
	/** Settles when the page has (or failed to have) the scene open. */
	private pageReady: Promise<void> = Promise.resolve();

	constructor(
		private readonly st: Studio,
		private readonly el: HTMLElement,
		item: string | null,
		private readonly remember: (id: string | null) => void,
	) {
		this.selected = item;
	}

	private get projectId(): string {
		return this.st.project!.id;
	}

	mount(): void {
		const c = this.st.component;
		c.register(() => this.synSlot.flush?.());
		this.memory = deviceMemory(this.st.ws.app);
		this.split = this.memory.split(this.projectId);
		this.root = this.el.createDiv({ cls: 'ws-wr-ms' });
		const binder = this.root.createEl('aside', { cls: 'ws-wr-binder' });
		const bh = binder.createDiv({ cls: 'ws-wr-binder__head' });
		bh.createEl('h2', { cls: 'ws-wr-binder__title', text: 'Contents' });
		button(bh, { icon: 'plus', variant: 'quiet', size: 'sm', tooltip: 'Add a scene, chapter or part', cls: 'ws-wr-binder__add', onClick: (e) => this.addMenu(e) });
		button(bh, { icon: 'more-horizontal', variant: 'quiet', size: 'sm', tooltip: 'Contents menu', cls: 'ws-wr-binder__more', onClick: (e) => this.binderMenu(e) });
		button(bh, { icon: 'x', variant: 'quiet', size: 'sm', tooltip: 'Close', cls: 'ws-wr-binder__close', onClick: () => this.setSheet(false) });
		const search = binder.createDiv({ cls: 'ws-wr-binder__search' });
		icon(search, 'search');
		this.searchEl = search.createEl('input', { attr: { type: 'search', placeholder: 'Find in manuscript', 'aria-label': 'Find in manuscript', spellcheck: 'false' } });
		this.searchEl.addEventListener('input', () => {
			this.query = this.searchEl.value;
			this.renderList();
		});
		const scroller = binder.createDiv({ cls: 'ws-wr-binder__scroll' });
		this.listEl = scroller.createDiv({ cls: 'ws-wr-tree', attr: { role: 'tree', 'aria-label': 'Contents' } });
		this.lineEl = scroller.createDiv({ cls: 'ws-wr-dropline', attr: { 'aria-hidden': 'true' } });
		this.tipEl = binder.createDiv({ cls: 'ws-wr-droptip', attr: { 'aria-live': 'polite' } });
		this.bindList(scroller);
		const foot = binder.createDiv({ cls: 'ws-wr-binder__foot' });
		// The design's links under Contents: revision notes and research.
		for (const [label, ic, view] of [['Revision notes', 'history', 'revision'], ['Research', 'library', 'research']] as const) {
			const l = foot.createEl('button', { cls: 'ws-wr-binder__link', attr: { type: 'button' } });
			icon(l, ic);
			l.createSpan({ text: label });
			l.addEventListener('click', () => this.st.go({ project: this.projectId, view }));
		}
		const trash = foot.createEl('button', { cls: 'ws-wr-binder__extra', attr: { type: 'button' } });
		icon(trash, 'trash');
		trash.createSpan({ cls: 'ws-wr-binder__trash', text: 'Trash' });
		trash.addEventListener('click', () => this.st.go({ project: this.projectId, view: 'trash' }));

		const main = this.root.createDiv({ cls: 'ws-wr-ms__main' });
		this.mainEl = main;
		const bar = main.createDiv({ cls: 'ws-wr-ms__bar' });
		button(bar, { label: 'Contents', icon: 'list-tree', variant: 'ghost', size: 'sm', cls: 'ws-wr-ms__contents', onClick: () => this.setSheet(true) });
		this.crumbsEl = bar.createDiv({ cls: 'ws-wr-crumbs' });
		this.sideBtn = button(bar, { icon: 'panel-right', variant: 'quiet', size: 'sm', tooltip: 'Inspector', cls: 'ws-wr-ms__sidebtn', onClick: () => this.toggleInspector() });
		const scroll = main.createDiv({ cls: 'ws-wr-ms__scroll' });
		this.detailEl = scroll.createDiv({ cls: 'ws-wr-ms__detail' });

		// The writing page: the toolbar, the page itself, and in focus mode a quiet top line and footer.
		this.writeEl = main.createDiv({ cls: 'ws-wr-write' });
		this.focusTopEl = this.writeEl.createDiv({ cls: 'ws-wr-focustop' });
		this.toolbarEl = this.writeEl.createDiv({ cls: 'ws-wr-toolbar-wrap' });
		const pageEl = this.writeEl.createDiv({ cls: 'ws-wr-page ws-wr-page--main' });
		const page = new ScenePane({
			st: this.st,
			el: pageEl,
			memory: this.memory,
			heading: (it) => this.heading(it),
			onChange: () => this.onPageChange(),
			onFocus: () => (this.activePane = page),
		});
		this.page = page;
		this.activePane = page;
		this.sessionEl = this.writeEl.createDiv({ cls: 'ws-wr-session', attr: { 'aria-live': 'polite' } });
		this.statusEl = main.createDiv({ cls: 'ws-wr-statusbar' });

		this.resizerEl = this.root.createDiv({ cls: 'ws-wr-resizer', attr: { role: 'separator', 'aria-orientation': 'vertical', 'aria-label': 'Resize the side pane', tabindex: '0' } });
		this.bindResizer();
		this.sideEl = this.root.createEl('aside', { cls: 'ws-wr-side', attr: { 'aria-label': 'Side pane' } });
		this.sideHeadEl = this.sideEl.createDiv({ cls: 'ws-wr-side__head' });
		this.sideBodyEl = this.sideEl.createDiv({ cls: 'ws-wr-side__body' });

		const scrim = this.root.createDiv({ cls: 'ws-wr-ms__scrim' });
		scrim.addEventListener('click', () => {
			this.setSheet(false);
			this.setSideSheet(false);
		});
		// Capture: the editor (and Obsidian) handle Esc on the way down and would swallow it.
		this.root.addEventListener('keydown', (e) => this.onRootKey(e), true);

		c.register(() => {
			this.page?.dispose();
			this.sidePage?.dispose();
			this.page = this.sidePage = null;
			this.settingsPop?.close();
			this.settingsPop = null;
			this.setFocusMode(false);
		});
		this.applyLook();
		own(c, this.st.ws.events.on('settings:changed', () => {
			this.applyLook();
			this.page?.repaint();
			this.sidePage?.repaint();
			this.renderToolbar();
			this.renderFocusTop();
		}));
		// The theme changed (light or dark, another theme): the Theme surface follows it.
		const css = this.st.ws.app.workspace.on('css-change', () => {
			this.applyLook();
			this.page?.repaint();
			this.sidePage?.repaint();
		});
		c.register(() => this.st.ws.app.workspace.offref(css));
		const w0 = this.root.getBoundingClientRect().width;
		this.narrow = w0 > 0 && w0 < SIDE_INLINE;
		observeWidth(c, this.root, (w) => {
			const narrow = w < SIDE_INLINE;
			if (narrow === this.narrow) return;
			this.narrow = narrow;
			this.sideSheet = false;
			this.layoutSide();
		});
		this.renderToolbar();
		this.layoutSide();
		this.refresh();
		// Opened with "Continue writing": the cursor goes straight onto the page. With "Scene
		// details": the inspector is open beside it (on a narrow pane, as its sheet).
		const asked = this.selected ? takeIntent(this.selected) : null;
		const it = asked && this.selected ? this.st.w.item(this.selected) : undefined;
		if (it && asked === 'write') this.writeIn(it);
		else if (it && asked === 'details' && this.narrow) this.setSide('inspector', true);
	}

	private mainEl: HTMLElement | null = null;

	private applyLook(): void {
		const w = this.st.ws.settings.writing;
		applyWritingLook(this.root, w);
		// The whole writing area is the surface (0.16.1): the Theme surface needs the theme's own colours there too.
		for (const el of [this.mainEl, this.sideEl]) if (el) paintSurface(el, w);
	}

	/** The heading on a scene's page: "Chapter II · Scene 4" and the scene's title. */
	private heading(it: ManuscriptItem): { label: string; title: string } {
		const m = binderModel(this.st.w.tree(this.projectId));
		const parent = it.parentId ? this.st.w.item(it.parentId) : undefined;
		const n = m.sceneNo.get(it.id) ?? '';
		const label = parent?.kind === 'chapter' ? `Chapter ${roman(m.chapterNo.get(parent.id) ?? 0)} · Scene ${n}` : `Scene ${n}`;
		return { label, title: it.title };
	}

	private setSheet(open: boolean): void {
		this.root.toggleClass('is-sheet-open', open);
		if (open) window.setTimeout(() => (this.listEl.querySelector('.ws-wr-row.is-selected'))?.focus({ preventScroll: true }), 0);
	}

	refresh(): void {
		this.model = binderModel(this.st.w.tree(this.projectId), { filter: this.query });
		// The selection must still be live (it may have been trashed or merged meanwhile).
		if (!this.selected || !this.st.w.isLive(this.selected) || this.st.w.item(this.selected)?.projectId !== this.projectId) {
			const all = binderModel(this.st.w.tree(this.projectId));
			const first = all.rows.find((r) => r.kind === 'scene') ?? all.rows[0];
			this.selected = first?.id ?? null;
		}
		this.renderList();
		const editing = this.detailEl.contains(activeDocument.activeElement) && activeDocument.activeElement instanceof HTMLTextAreaElement;
		if (editing) this.detailStale = true;
		else this.renderDetail();
		this.refreshSide();
	}

	private select(id: string | null, focus = false): void {
		if (this.selected === id) return;
		this.selected = id;
		this.remember(id);
		this.renderList();
		this.renderDetail();
		this.refreshSide();
		if (focus) (this.listEl.querySelector(`[data-id="${id}"]`))?.focus({ preventScroll: false });
		if (this.root.hasClass('is-sheet-open')) this.setSheet(false);
	}

	/** Enter or double-click on a scene: write in it (or open its note when the studio can't hold the editor). */
	private writeIn(it: ManuscriptItem): void {
		const path = it.notePath;
		if (it.kind !== 'scene' || !path || this.st.w.noteState(it.id) !== 'ok') return;
		if (this.selected !== it.id) this.select(it.id);
		if (this.root.hasClass('is-sheet-open')) this.setSheet(false);
		void this.pageReady.then(() => {
			const page = this.page;
			if (!page || this.writing !== it.id) return;
			if (page.editor) page.focus();
			else if (page.isFallback) void openNote(this.st.ws.app, path);
		});
	}

	// ── the binder ──────────────────────────────────────────────────────────

	private renderList(): void {
		const scroller = this.listEl.parentElement!;
		const top = scroller.scrollTop;
		const hadFocus = this.listEl.contains(activeDocument.activeElement);
		this.model = binderModel(this.st.w.tree(this.projectId), { filter: this.query });
		const m = this.model;
		const p = this.st.project!;
		this.listEl.empty();
		const searching = !!this.query.trim();
		if (!m.rows.length) {
			this.listEl.createDiv({ cls: 'ws-wr-tree__empty', text: searching ? 'Nothing matches.' : 'No chapters or scenes yet. Use + to add one.' });
		}
		for (const n of m.rows) {
			const it = this.st.w.item(n.id);
			if (!it) continue;
			const container = n.kind !== 'scene';
			const row = this.listEl.createDiv({
				cls: cx('ws-wr-row', `ws-wr-row--${n.kind}`, n.id === this.selected && 'is-selected', busyScenes.has(n.id) && 'is-busy'),
				attr: { role: 'treeitem', 'data-id': n.id, 'aria-level': String(n.depth + 1), 'aria-selected': String(n.id === this.selected), tabindex: n.id === this.selected ? '0' : '-1', draggable: searching ? 'false' : 'true' },
			});
			row.style.setProperty('--ws-wr-depth', String(n.depth));
			if (container) {
				row.setAttr('aria-expanded', String(searching || !n.collapsed));
				const chev = row.createSpan({ cls: 'ws-wr-row__chev', attr: { 'data-toggle': 'true' } });
				setIcon(chev, !searching && n.collapsed ? 'chevron-right' : 'chevron-down');
			}
			if (n.kind === 'chapter') row.createSpan({ cls: 'ws-wr-row__num', text: roman(m.chapterNo.get(n.id) ?? 0) });
			if (n.kind === 'scene') dot(row, statusOf(p, it.status));
			row.createSpan({ cls: 'ws-wr-row__name', text: n.title });
			if (n.kind === 'scene' && this.st.w.noteState(n.id) === 'missing') {
				const warn = row.createSpan({ cls: 'ws-wr-row__warn', attr: { title: 'Note not found' } });
				setIcon(warn, 'alert-triangle');
			}
			if (n.kind !== 'part') {
				const words = n.kind === 'scene' ? this.st.w.words.words(it.notePath) : this.st.w.wordCount(n.id);
				row.createSpan({ cls: 'ws-wr-row__words', text: words ? fmt(words) : '—' });
			}
			const more = row.createEl('button', { cls: 'ws-wr-row__more clickable-icon', attr: { type: 'button', 'aria-label': `Menu for ${n.title}`, tabindex: '-1' } });
			setIcon(more, 'more-horizontal');
		}
		scroller.scrollTop = top;
		if (hadFocus) (this.listEl.querySelector('.ws-wr-row.is-selected'))?.focus({ preventScroll: true });
		const trashN = this.st.w.trashed(this.projectId).length;
		const t = this.root.querySelector('.ws-wr-binder__trash');
		if (t) t.setText(trashN ? `Trash (${trashN})` : 'Trash');
	}

	private rowOf(target: EventTarget | null): HTMLElement | null {
		return target instanceof Element ? (target.closest('.ws-wr-row')) : null;
	}

	private bindList(scroller: HTMLElement): void {
		const list = this.listEl;
		list.addEventListener('click', (e) => {
			const row = this.rowOf(e.target);
			if (!row) return;
			const id = row.dataset.id!;
			const t = e.target as Element;
			if (t.closest('.ws-wr-row__more')) {
				e.stopPropagation();
				this.openMenu(id, e);
				return;
			}
			if (t.closest('[data-toggle]')) {
				const it = this.st.w.item(id);
				if (it && !this.query.trim()) this.st.w.setCollapsed(id, !it.collapsed);
				return;
			}
			this.select(id);
			row.focus({ preventScroll: true });
		});
		list.addEventListener('dblclick', (e) => {
			const row = this.rowOf(e.target);
			const it = row ? this.st.w.item(row.dataset.id) : undefined;
			if (it?.kind === 'scene') this.writeIn(it);
			else if (it) this.st.w.setCollapsed(it.id, !it.collapsed);
		});
		list.addEventListener('contextmenu', (e) => {
			const row = this.rowOf(e.target);
			if (!row) return;
			e.preventDefault();
			this.select(row.dataset.id!);
			this.openMenu(row.dataset.id!, e);
		});
		list.addEventListener('keydown', (e) => this.onKey(e));

		// Drag and drop. The drop line is drawn where the items will land.
		list.addEventListener('dragstart', (e) => {
			const row = this.rowOf(e.target);
			if (!row || this.query.trim()) {
				e.preventDefault();
				return;
			}
			const id = row.dataset.id!;
			this.dragIds = [id];
			row.addClass('is-dragging');
			e.dataTransfer?.setData('text/plain', this.st.w.item(id)?.title ?? '');
			if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
		});
		scroller.addEventListener('dragover', (e) => {
			if (!this.dragIds) return;
			this.autoScroll(scroller, e.clientY);
			const t = this.targetAt(e.clientY, e.target);
			this.showDrop(t);
			if (t && !t.noop) {
				e.preventDefault();
				if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
			}
		});
		scroller.addEventListener('dragleave', (e) => {
			if (!(e.relatedTarget instanceof Node) || !scroller.contains(e.relatedTarget)) this.showDrop(null);
		});
		scroller.addEventListener('drop', (e) => {
			if (!this.dragIds) return;
			e.preventDefault();
			const t = this.targetAt(e.clientY, e.target);
			const ids = this.dragIds;
			this.endDrag();
			if (t && !t.noop) this.applyDrop(ids, t);
		});
		list.addEventListener('dragend', () => this.endDrag());
	}

	private autoScroll(scroller: HTMLElement, y: number): void {
		const r = scroller.getBoundingClientRect();
		if (y < r.top + 28) scroller.scrollTop -= 10;
		else if (y > r.bottom - 28) scroller.scrollTop += 10;
	}

	/** The drop target under the pointer (below the last row = the end of the project). */
	private targetAt(y: number, target: EventTarget | null): DropTarget | null {
		const ids = this.dragIds;
		if (!ids) return null;
		const rows = [...this.listEl.querySelectorAll<HTMLElement>('.ws-wr-row')];
		let row = this.rowOf(target);
		if (!row) {
			// Between rows, or in the space below them.
			row = rows.find((r) => {
				const b = r.getBoundingClientRect();
				return y >= b.top && y < b.bottom;
			}) ?? null;
		}
		if (!row) {
			const last = rows[rows.length - 1];
			if (last && y >= last.getBoundingClientRect().bottom) return dropTarget(this.model, ids, this.model.rows.length, 0);
			return null;
		}
		const b = row.getBoundingClientRect();
		const index = this.model.rows.findIndex((r) => r.id === row.dataset.id);
		return dropTarget(this.model, ids, index, b.height ? (y - b.top) / b.height : 0.5);
	}

	private showDrop(t: DropTarget | null): void {
		this.drop = t;
		this.listEl.querySelectorAll('.is-drop-into').forEach((x) => x.removeClass('is-drop-into'));
		const ids = this.dragIds;
		if (!t || t.noop || !ids) {
			this.lineEl.removeClass('is-on');
			this.tipEl.removeClass('is-on');
			return;
		}
		const rows = [...this.listEl.querySelectorAll<HTMLElement>('.ws-wr-row')];
		const ref = t.lineAfter >= 0 ? rows[t.lineAfter] : rows[0];
		if (!ref) return;
		const y = t.lineAfter >= 0 ? ref.offsetTop + ref.offsetHeight : ref.offsetTop;
		this.lineEl.style.top = `${y - 1}px`;
		this.lineEl.style.left = `${10 + t.depth * INDENT}px`;
		this.lineEl.addClass('is-on');
		if (t.into) this.listEl.querySelector(`[data-id="${t.into}"]`)?.addClass('is-drop-into');
		const name = this.st.w.item(ids[0])?.title ?? '';
		const parent = t.parentId ? this.st.w.item(t.parentId) : null;
		this.tipEl.setText(parent ? `Move “${name}” into “${parent.title}”. The note keeps its name.` : `Move “${name}” to the top level. The note keeps its name.`);
		this.tipEl.addClass('is-on');
	}

	private endDrag(): void {
		this.dragIds = null;
		this.showDrop(null);
		this.listEl.querySelectorAll('.is-dragging').forEach((x) => x.removeClass('is-dragging'));
	}

	private applyDrop(ids: string[], t: DropTarget): void {
		const it = this.st.w.item(ids[0]);
		try {
			const u = this.st.w.move(ids, { parentId: t.parentId, index: t.index });
			const parent = t.parentId ? this.st.w.item(t.parentId) : null;
			undoNotice(this.st, `Moved “${it?.title ?? ''}”${parent ? ` into “${parent.title}”` : ''}.`, u);
		} catch (e) {
			new Notice(e instanceof Error ? e.message : String(e));
		}
	}

	private onKey(e: KeyboardEvent): void {
		const row = this.rowOf(e.target);
		if (!row) return;
		const id = row.dataset.id!;
		const it = this.st.w.item(id);
		if (!it) return;
		const rows = this.model.rows;
		const i = rows.findIndex((r) => r.id === id);
		const go = (j: number) => {
			const r = rows[Math.max(0, Math.min(rows.length - 1, j))];
			if (r) this.select(r.id, true);
		};
		if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
			e.preventDefault();
			moveStep(this.st, it, e.key === 'ArrowUp' ? -1 : 1);
			window.setTimeout(() => (this.listEl.querySelector(`[data-id="${id}"]`))?.focus(), 0);
			return;
		}
		switch (e.key) {
			case 'ArrowDown':
				e.preventDefault();
				go(i + 1);
				break;
			case 'ArrowUp':
				e.preventDefault();
				go(i - 1);
				break;
			case 'Home':
				e.preventDefault();
				go(0);
				break;
			case 'End':
				e.preventDefault();
				go(rows.length - 1);
				break;
			case 'ArrowRight':
				if (it.kind !== 'scene' && it.collapsed) {
					e.preventDefault();
					this.st.w.setCollapsed(id, false);
				} else if (rows[i + 1]?.parentId === id) {
					e.preventDefault();
					go(i + 1);
				}
				break;
			case 'ArrowLeft':
				if (it.kind !== 'scene' && !it.collapsed && !this.query.trim()) {
					e.preventDefault();
					this.st.w.setCollapsed(id, true);
				} else if (rows[i]?.parentId) {
					e.preventDefault();
					this.select(rows[i].parentId, true);
				}
				break;
			case 'Enter':
				e.preventDefault();
				if (it.kind === 'scene') this.writeIn(it);
				else this.st.w.setCollapsed(id, !it.collapsed);
				break;
			case 'F2':
				e.preventDefault();
				void renameItem(this.st, it);
				break;
			case 'Delete':
			case 'Backspace':
				e.preventDefault();
				trashItem(this.st, it);
				break;
			case 'ContextMenu':
				e.preventDefault();
				this.openMenu(id, row);
				break;
			default:
				if (e.key === 'F10' && e.shiftKey) {
					e.preventDefault();
					this.openMenu(id, row);
				}
		}
	}

	private openMenu(id: string, at: MouseEvent | HTMLElement): void {
		const it = this.st.w.item(id);
		if (!it) return;
		const m = itemMenu(this.st, it, { onSelect: (x) => this.select(x) });
		if (at instanceof HTMLElement) {
			const r = at.getBoundingClientRect();
			m.showAtPosition({ x: r.left + 24, y: r.bottom });
		} else m.showAtMouseEvent(at);
	}

	private addMenu(e: MouseEvent): void {
		const near = this.st.w.item(this.selected);
		const m = new Menu();
		const add = (kind: ManuscriptKind, ic: string) =>
			m.addItem((i) =>
				i
					.setTitle(`New ${itemWord(kind).toLowerCase()}…`)
					.setIcon(ic)
					.onClick(() => void createItem(this.st, this.projectId, kind, near ?? null, (x) => this.select(x.id))),
			);
		add('scene', 'square-plus');
		add('chapter', 'bookmark-plus');
		add('part', 'book-plus');
		m.showAtMouseEvent(e);
	}

	private binderMenu(e: MouseEvent): void {
		const m = new Menu();
		m.addItem((i) => i.setTitle('Expand all').setIcon('chevrons-up-down').onClick(() => this.st.w.setAllCollapsed(this.projectId, false)));
		m.addItem((i) => i.setTitle('Collapse all').setIcon('chevrons-down-up').onClick(() => this.st.w.setAllCollapsed(this.projectId, true)));
		m.addSeparator();
		m.addItem((i) => i.setTitle('Import notes…').setIcon('file-input').onClick(() => importFolder(this.st, this.projectId)));
		const missing = this.st.w.missingNotes(this.projectId).length;
		if (missing) m.addItem((i) => i.setTitle(`Find ${count(missing, 'missing note')}`).setIcon('search').onClick(() => this.st.go({ project: this.projectId, view: 'overview' })));
		m.addItem((i) => i.setTitle('Trash').setIcon('trash').onClick(() => this.st.go({ project: this.projectId, view: 'trash' })));
		m.showAtMouseEvent(e);
	}


	// ── the page ────────────────────────────────────────────────────────────

	private renderCrumbs(it: ManuscriptItem, m: BinderModel): void {
		this.crumbsEl.empty();
		const chain: ManuscriptItem[] = [];
		for (let cur = it.parentId ? this.st.w.item(it.parentId) : undefined; cur && chain.length < 6; cur = cur.parentId ? this.st.w.item(cur.parentId) : undefined) chain.unshift(cur);
		for (const c of chain) {
			const a = this.crumbsEl.createEl('button', { cls: 'ws-wr-crumbs__step', text: c.kind === 'chapter' ? `Chapter ${m.chapterNo.get(c.id) ?? ''} · ${c.title}` : c.title, attr: { type: 'button' } });
			a.addEventListener('click', () => this.select(c.id));
			icon(this.crumbsEl, 'chevron-right', 'ws-wr-crumbs__sep');
		}
		this.crumbsEl.createSpan({ cls: 'ws-wr-crumbs__here', text: it.title });
	}

	private renderDetail(): void {
		this.detailStale = false;
		const d = this.detailEl;
		const p = this.st.project!;
		const it = this.st.w.item(this.selected);
		const writable = !!it && it.kind === 'scene' && this.st.w.noteState(it.id) === 'ok';
		this.root.toggleClass('is-writing', writable);
		this.crumbsEl.empty();
		if (it && writable) {
			// The scene in Obsidian's editor on the page (the same editor, another note).
			d.empty();
			this.synSlot.flush?.();
			this.renderCrumbs(it, binderModel(this.st.w.tree(p.id)));
			this.writing = it.id;
			this.pageReady = this.page ? this.page.show(it).catch(() => undefined) : Promise.resolve();
			void this.pageReady.then(() => this.onPageChange());
			this.renderFocusTop();
			this.renderStatus();
			return;
		}
		this.writing = null;
		if (this.focusMode) this.setFocusMode(false);
		d.empty();
		if (!it) {
			const sheet = d.createDiv({ cls: 'ws-wr-paper ws-wr-sheet ws-wr-sheet--empty' });
			caps(sheet, p.name, 'ws-wr-sheet__eyebrow');
			ornament(sheet);
			sheet.createEl('h1', { cls: 'ws-wr-sheet__title', text: 'An empty manuscript' });
			sheet.createEl('p', { text: 'Add the first chapter or scene. Each scene is a note in your vault, made for you in the project’s folder.' });
			const row = sheet.createDiv({ cls: 'ws-wr-sheet__actions' });
			button(row, { label: 'New scene', icon: 'square-plus', variant: 'primary', size: 'sm', onClick: () => void createItem(this.st, p.id, 'scene', null, (x) => this.select(x.id)) });
			button(row, { label: 'New chapter', icon: 'bookmark-plus', variant: 'ghost', size: 'sm', onClick: () => void createItem(this.st, p.id, 'chapter', null, (x) => this.select(x.id)) });
			button(row, { label: 'Import notes', icon: 'file-input', variant: 'ghost', size: 'sm', onClick: () => importFolder(this.st, p.id) });
			this.renderStatus();
			return;
		}
		const m = binderModel(this.st.w.tree(p.id));
		this.renderCrumbs(it, m);

		const sheet = d.createDiv({ cls: cx('ws-wr-paper ws-wr-sheet', `ws-wr-sheet--${it.kind}`), attr: { 'data-id': it.id } });
		const label = it.kind === 'chapter' ? `Chapter ${roman(m.chapterNo.get(it.id) ?? 0)}` : it.kind === 'scene' ? `Scene ${m.sceneNo.get(it.id) ?? ''}` : 'Part';
		caps(sheet, label, 'ws-wr-sheet__eyebrow');
		ornament(sheet);
		const titleRow = sheet.createDiv({ cls: 'ws-wr-sheet__titlerow' });
		titleRow.createEl('h1', { cls: 'ws-wr-sheet__title', text: it.title });
		button(titleRow, { icon: 'pencil', variant: 'quiet', size: 'sm', tooltip: 'Rename', cls: 'ws-wr-sheet__rename', onClick: () => void renameItem(this.st, it) });

		if (it.kind === 'scene') {
			const status = sheet.createDiv({ cls: 'ws-wr-sheet__field' });
			caps(status, 'Status', 'ws-wr-sheet__label');
			const chips = status.createDiv({ cls: 'ws-wr-statuses', attr: { role: 'radiogroup', 'aria-label': 'Status' } });
			for (const s of p.statuses) {
				const c = chips.createEl('button', { cls: cx('ws-wr-status', `ws-tint--${s.color}`, it.status === s.id && 'is-active'), attr: { type: 'button', role: 'radio', 'aria-checked': String(it.status === s.id), 'data-status': s.id } });
				c.createSpan({ cls: 'ws-wr-dot' });
				c.createSpan({ text: s.label });
				c.addEventListener('click', () => setStatus(this.st, it, s.id));
			}
		}
		itemTextField(sheet.createDiv({ cls: 'ws-wr-sheet__field' }), this.st, it, {
			key: 'synopsis',
			cls: 'ws-wr-synopsis',
			label: 'Synopsis',
			placeholder: `What happens in this ${it.kind}?`,
			slot: this.synSlot,
			// Changes that arrived while typing are drawn now.
			onBlur: () => {
				if (this.detailStale) window.setTimeout(() => !this.detailEl.contains(activeDocument.activeElement) && this.renderDetail(), 0);
			},
		});
		if (it.kind === 'scene') this.sceneNote(sheet, it);
		else this.children(sheet, it, m);
		this.renderStatus();
	}

	/** The status bar under the page: words, reading time, target, this session, and whether it's saved. */
	/** 0.28 (the design): in focus mode, a slim bar at the foot: the sprint's time, a line, the words. */
	private focusBarEl: HTMLElement | null = null;
	private focusTick: number | null = null;

	private renderFocusBar(): void {
		if (!this.focusBarEl) {
			this.focusBarEl = this.statusEl.parentElement!.createDiv({ cls: 'ws-wr-focusbar', attr: { role: 'status', 'aria-live': 'off' } });
			this.st.component.register(() => {
				if (this.focusTick !== null) window.clearInterval(this.focusTick);
				this.focusTick = null;
			});
		}
		const bar = this.focusBarEl;
		bar.empty();
		bar.toggleClass('is-hidden', !this.focusMode);
		const p = this.st.project!;
		const run = sprint();
		const running = !!run && run.projectId === p.id;
		if (this.focusMode && running && this.focusTick === null) this.focusTick = window.setInterval(() => (this.focusMode && sprint() ? this.renderFocusBar() : this.stopFocusTick()), 1000);
		if ((!this.focusMode || !running) && this.focusTick !== null) this.stopFocusTick();
		if (!this.focusMode) return;
		const goal = p.dailyGoal ?? null;
		const today = this.st.w.wordsToday(p.id);
		if (running) {
			const t = bar.createSpan({ cls: 'ws-wr-focusbar__time' });
			icon(t, 'timer');
			t.createSpan({ text: `${timeLeft()} left` });
		} else {
			const b = bar.createEl('button', { cls: 'ws-wr-focusbar__start', attr: { type: 'button', 'aria-haspopup': 'menu' } });
			icon(b, 'timer');
			b.createSpan({ text: 'Sprint' });
			b.addEventListener('click', (e) => {
				const m = new Menu();
				for (const min of [15, 25, 45]) m.addItem((i) => i.setTitle(`${min}-minute sprint`).setIcon('timer').onClick(() => (startSprint(this.st.w, p.id, min), this.renderFocusBar())));
				m.showAtMouseEvent(e);
			});
		}
		const words = running ? sprintWords(this.st.w) : today;
		const line = bar.createDiv({ cls: 'ws-wr-focusbar__line' });
		line.createDiv().style.width = `${goal ? Math.max(0, Math.min(100, Math.round((words / goal) * 100))) : 0}%`;
		bar.createSpan({ cls: 'ws-wr-focusbar__words', text: running ? `${fmt(Math.max(0, words))} words this sprint` : goal ? `${fmt(Math.max(0, today))} of ${fmt(goal)} words today` : `${fmt(today)} words today` });
	}

	private stopFocusTick(): void {
		if (this.focusTick !== null) window.clearInterval(this.focusTick);
		this.focusTick = null;
	}

	private renderStatus(): void {
		this.renderFocusBar();
		const sb = this.statusEl;
		sb.empty();
		const it = this.st.w.item(this.selected);
		if (!it) return;
		if (it.kind === 'scene' && this.writing === it.id) {
			const words = this.sceneWords(it);
			sb.createSpan({ cls: 'ws-wr-sb__words', text: words === null ? 'Words not counted yet' : count(words, 'word') });
			if (words) sb.createSpan({ cls: 'ws-wr-muted ws-wr-sb__read', text: `${Math.max(1, Math.round(words / 230))} min read` });
			if (it.wordTarget) {
				progressBar(sb, (words ?? 0) / it.wordTarget, 'ws-wr-statusbar__bar');
				sb.createSpan({ cls: 'ws-wr-muted ws-wr-sb__target', text: `target ${fmt(it.wordTarget)}` });
			}
			const session = this.sessionDelta();
			if (session !== null) sb.createSpan({ cls: 'ws-wr-muted ws-wr-sb__session', text: sessionLabel(session) });
			sb.createDiv({ cls: 'ws-wr-spacer' });
			// WS6: today's words, the streak, and sprints.
			this.badgeOff?.();
			renderTodayBadge(this.st, sb, (fn) => (this.badgeOff = fn));
			const page = this.page;
			const path = it.notePath ?? '';
			if (page?.isFallback) {
				const s = sb.createSpan({ cls: 'ws-wr-saved is-ok' });
				icon(s, 'file-text');
				s.createSpan({ text: path });
			} else {
				const saving = page?.saveState === 'saving';
				const s = sb.createSpan({ cls: cx('ws-wr-saved', saving ? 'is-saving' : 'is-ok'), attr: { 'aria-live': 'polite' } });
				icon(s, saving ? 'loader' : 'check');
				s.createSpan({ text: saving ? `Saving to ${path}…` : `Saved to ${path}` });
			}
			this.sessionEl.empty();
			this.sessionEl.createSpan({ text: words === null ? '' : count(words, 'word') });
			if (session !== null) this.sessionEl.createSpan({ cls: 'ws-wr-session__delta', text: sessionLabel(session) });
			return;
		}
		// The status bar of a part, chapter or a scene without its note.
		const words = it.kind === 'scene' ? this.st.w.words.words(it.notePath) : this.st.w.wordCount(it.id);
		sb.createSpan({ text: words === null ? 'Words not counted yet' : count(words, 'word') });
		if (it.kind === 'scene' && words) sb.createSpan({ cls: 'ws-wr-muted', text: `${Math.max(1, Math.round(words / 230))} min read` });
		if (it.kind !== 'scene') sb.createSpan({ cls: 'ws-wr-muted', text: count(this.st.w.scenesIn(it.id).length, 'scene') });
		sb.createDiv({ cls: 'ws-wr-spacer' });
		if (it.kind === 'scene') {
			const state = this.st.w.noteState(it.id);
			const s = sb.createSpan({ cls: cx('ws-wr-saved', `is-${state}`) });
			icon(s, state === 'ok' ? 'check' : state === 'missing' ? 'alert-triangle' : 'file-question');
			s.createSpan({ text: state === 'ok' ? it.notePath! : state === 'missing' ? `Not found: ${it.notePath}` : 'No note yet' });
		}
	}

	/** A scene's words: what's on the page right now when it's open, else the last count of its note. */
	private sceneWords(it: ManuscriptItem): number | null {
		if (this.writing === it.id && this.page?.liveWords != null) return this.page.liveWords;
		if (this.sidePage?.scene?.id === it.id && this.sidePageKind === 'scene' && this.sidePage.liveWords != null) return this.sidePage.liveWords;
		return this.st.w.words.words(it.notePath);
	}

	/** Words written this session in this project, note by note (null until one is counted). */
	private sessionDelta(): number | null {
		const notes = new Map<string, number | null>();
		for (const sc of this.st.w.scenes(this.projectId)) {
			// What's typed but not saved yet counts already (sceneWords reads the open pages).
			if (sc.notePath && !notes.has(sc.notePath)) notes.set(sc.notePath, this.sceneWords(sc));
		}
		return sessionDelta(this.projectId, notes);
	}

	/** The page's words or save state changed. */
	private onPageChange(): void {
		this.writeEl.toggleClass('is-fallback', !!this.page?.isFallback);
		this.renderStatus();
		this.inspector?.paintWords();
	}

	private sceneNote(sheet: HTMLElement, it: ManuscriptItem): void {
		const state = this.st.w.noteState(it.id);
		const box = sheet.createDiv({ cls: cx('ws-wr-notebox', `is-${state}`) });
		const busy = busyScenes.has(it.id);
		if (state === 'missing') {
			const msg = box.createDiv({ cls: 'ws-wr-notebox__msg' });
			icon(msg, 'alert-triangle');
			msg.createSpan({ text: `The note “${it.notePath}” wasn’t found. It may have been renamed or moved while Obsidian was closed. The scene is safe; link it to its note again.` });
			const row = box.createDiv({ cls: 'ws-wr-sheet__actions' });
			button(row, { label: 'Find it again', icon: 'search', variant: 'primary', size: 'sm', cls: 'ws-wr-findagain', onClick: () => findAgain(this.st, it) });
			button(row, { label: 'Choose a note', icon: 'file-search', variant: 'ghost', size: 'sm', onClick: () => chooseNote(this.st, it) });
		} else {
			const msg = box.createDiv({ cls: 'ws-wr-notebox__msg' });
			icon(msg, 'file-question');
			msg.createSpan({ text: state === 'unknown' ? 'The vault isn’t ready yet.' : 'This scene has no note yet.' });
			const row = box.createDiv({ cls: 'ws-wr-sheet__actions' });
			button(row, { label: 'Create note', icon: 'file-plus', variant: 'primary', size: 'sm', cls: 'ws-wr-createnote', onClick: () => createNote(this.st, it) });
			button(row, { label: 'Choose a note', icon: 'file-search', variant: 'ghost', size: 'sm', onClick: () => chooseNote(this.st, it) });
		}
		const tools = sheet.createDiv({ cls: 'ws-wr-sheet__tools' });
		button(tools, { label: 'Split…', icon: 'scissors', variant: 'ghost', size: 'sm', cls: 'ws-wr-split-btn', disabled: state !== 'ok' || busy, onClick: () => new SplitModal(this.st, it, (c) => this.select(c.id)).open() });
		const next = nextScene(this.st, it);
		button(tools, { label: 'Merge with next', icon: 'merge', variant: 'ghost', size: 'sm', cls: 'ws-wr-merge-btn', tooltip: next ? `Add “${next.title}” to the end of this scene` : 'This is the last scene', disabled: !next || busy, onClick: () => void mergeWithNext(this.st, it) });
		button(tools, { label: 'Move to…', icon: 'move', variant: 'ghost', size: 'sm', onClick: () => new MoveToModal(this.st, it).open() });
		button(tools, { icon: 'more-horizontal', variant: 'quiet', size: 'sm', tooltip: 'More', onClick: (e) => itemMenu(this.st, it, { onSelect: (x) => this.select(x) }).showAtMouseEvent(e) });
	}

	private children(sheet: HTMLElement, it: ManuscriptItem, m: BinderModel): void {
		const p = this.st.project!;
		const kids = (m.kids.get(it.id) ?? []).map((id) => this.st.w.item(id)).filter((x): x is ManuscriptItem => !!x);
		const f = sheet.createDiv({ cls: 'ws-wr-sheet__field' });
		caps(f, it.kind === 'part' ? 'In this part' : 'Scenes', 'ws-wr-sheet__label');
		if (!kids.length) f.createDiv({ cls: 'ws-wr-muted', text: 'Nothing in it yet.' });
		const list = f.createDiv({ cls: 'ws-wr-kids' });
		for (const k of kids) {
			const r = list.createEl('button', { cls: cx('ws-wr-kid', `is-${k.kind}`), attr: { type: 'button', 'data-id': k.id } });
			if (k.kind === 'scene') dot(r, statusOf(p, k.status));
			else r.createSpan({ cls: 'ws-wr-kid__num', text: k.kind === 'chapter' ? roman(m.chapterNo.get(k.id) ?? 0) : '' });
			r.createSpan({ cls: 'ws-wr-kid__title', text: k.title });
			const n = k.kind === 'scene' ? this.st.w.words.words(k.notePath) : this.st.w.wordCount(k.id);
			r.createSpan({ cls: 'ws-wr-kid__words', text: n ? fmt(n) : '—' });
			r.addEventListener('click', () => this.select(k.id));
		}
		const row = sheet.createDiv({ cls: 'ws-wr-sheet__actions' });
		button(row, { label: 'New scene here', icon: 'square-plus', variant: 'ghost', size: 'sm', onClick: () => void createItem(this.st, p.id, 'scene', it, (x) => this.select(x.id)) });
		if (it.kind === 'part') button(row, { label: 'New chapter here', icon: 'bookmark-plus', variant: 'ghost', size: 'sm', onClick: () => void createItem(this.st, p.id, 'chapter', it, (x) => this.select(x.id)) });
		button(row, { label: it.collapsed ? 'Expand in Contents' : 'Collapse in Contents', icon: it.collapsed ? 'chevrons-up-down' : 'chevrons-down-up', variant: 'ghost', size: 'sm', onClick: () => this.st.w.setCollapsed(it.id, !it.collapsed) });
		button(row, { icon: 'more-horizontal', variant: 'quiet', size: 'sm', tooltip: 'More', onClick: (e) => itemMenu(this.st, it, { onSelect: (x) => this.select(x) }).showAtMouseEvent(e) });
	}

	// ── toolbar and focus mode ──────────────────────────────────────────────

	private renderToolbar(): void {
		this.toolbarEl.empty();
		const pane = () => (this.activePane && this.activePane.editor ? this.activePane : this.page);
		renderToolbar(this.toolbarEl, this.st.ws, this.st.s, {
			editor: () => pane()?.editor ?? null,
			refocus: () => pane()?.embedded?.activate(),
			sourcePath: () => pane()?.embedded?.file?.path ?? '',
			focusMode: () => this.focusMode,
			toggleFocus: () => this.setFocusMode(!this.focusMode),
			typewriter: () => this.st.ws.settings.writing.typewriter,
			toggleTypewriter: () => this.toggleTypewriter(),
			layoutMenu: (_e, anchor) => this.layoutMenu(anchor),
		});
	}

	private toggleTypewriter(): void {
		const ws = this.st.ws;
		ws.settings.writing = { ...ws.settings.writing, typewriter: !ws.settings.writing.typewriter };
		void ws.saveSettings();
		if (ws.settings.writing.typewriter) (this.activePane ?? this.page)?.centre();
	}

	/** The quiet line above the page in focus mode: the scene, typewriter, settings, leave. */
	private renderFocusTop(): void {
		const el = this.focusTopEl;
		el.empty();
		const it = this.st.w.item(this.writing);
		el.createSpan({ cls: 'ws-wr-focustop__title', text: it?.title ?? '' });
		el.createDiv({ cls: 'ws-wr-spacer' });
		const tw = this.st.ws.settings.writing.typewriter;
		button(el, { icon: 'type', variant: 'quiet', size: 'sm', tooltip: tw ? 'Typewriter mode (on)' : 'Typewriter mode', cls: cx('ws-wr-focustop__typewriter', tw && 'is-on').join(' '), onClick: () => this.toggleTypewriter() }).setAttr('aria-pressed', String(tw));
		button(el, { icon: 'sliders-horizontal', variant: 'quiet', size: 'sm', tooltip: 'Writing settings', cls: 'ws-wr-focustop__settings', onClick: (e) => this.openSettings(e.currentTarget as HTMLElement) });
		button(el, { icon: 'minimize-2', variant: 'quiet', size: 'sm', tooltip: 'Leave focus mode (Esc)', cls: 'ws-wr-focustop__leave', onClick: () => this.setFocusMode(false) });
	}

	private openSettings(anchor: HTMLElement): void {
		if (this.settingsPop?.isOpen) {
			this.settingsPop.close();
			return;
		}
		this.settingsPop = openWritingSettings(this.st.ws, anchor);
	}

	/** Just the page, filling the pane (Esc or the button leaves). */
	setFocusMode(on: boolean): void {
		if (this.focusMode === on) return;
		if (on && !this.writing) return;
		this.focusMode = on;
		// Its settings button goes with the focus bar.
		if (!on) this.settingsPop?.close();
		const studio = this.root.closest('.ws-wr');
		studio?.toggleClass('is-focus', on);
		this.root.toggleClass('is-focus', on);
		if (!this.root.isConnected) return;
		this.renderToolbar();
		this.renderFocusTop();
		this.renderStatus();
		const page = this.page;
		if (on && page?.editor) {
			page.focus();
			if (this.st.ws.settings.writing.typewriter) page.centre();
		}
	}

	private onRootKey(e: KeyboardEvent): void {
		if (e.key !== 'Escape' || !this.focusMode || e.defaultPrevented || e.isComposing) return;
		const t = e.target as HTMLElement | null;
		// Esc in the find bar, a link suggestion, a menu or a popover closes that first.
		if (t?.closest('.document-search-container, .suggestion-container, .menu, .modal, .ws-popover')) return;
		if (activeDocument.querySelector('.suggestion-container, .menu, .modal-container')) return;
		// In Vim mode Esc belongs to the editor.
		if (t?.closest('.cm-editor') && (this.st.ws.app.vault as unknown as { getConfig?(k: string): unknown }).getConfig?.('vimMode')) return;
		e.preventDefault();
		e.stopPropagation();
		this.setFocusMode(false);
	}

	private layoutMenu(anchor: HTMLElement): void {
		const m = new Menu();
		const side = this.split.side;
		const opts: Array<[SideKind, string, string]> = [
			['none', 'Just the page', 'file'],
			['inspector', 'Page and inspector', 'panel-right'],
			['scene', 'Page and another scene', 'columns-2'],
			['note', 'Page and its note, to read', 'book-open'],
		];
		for (const [k, label, ic] of opts) m.addItem((i) => i.setTitle(label).setIcon(ic).setChecked(side === k && (!this.narrow || this.sideSheet || k === 'none')).onClick(() => this.setSide(k, true)));
		m.addSeparator();
		m.addItem((i) => i.setTitle('Focus mode').setIcon('maximize-2').setChecked(this.focusMode).onClick(() => this.setFocusMode(!this.focusMode)));
		const r = anchor.getBoundingClientRect();
		m.showAtPosition({ x: r.left, y: r.bottom + 4 });
	}

	// ── the side pane ───────────────────────────────────────────────────────

	private sideOpen(): boolean {
		return this.split.side !== 'none' && (!this.narrow || this.sideSheet);
	}

	private saveSplit(): void {
		this.memory.setSplit(this.projectId, this.split);
	}

	/** Show this in the side pane (and open it as a sheet on a narrow pane). */
	private setSide(kind: SideKind, open = true): void {
		if (kind === 'scene' && !this.st.w.isLive(this.split.scene ?? '')) this.split.scene = this.otherScene();
		this.split.side = kind;
		this.saveSplit();
		if (this.narrow) this.sideSheet = open && kind !== 'none';
		this.layoutSide();
	}

	private toggleInspector(): void {
		if (this.narrow) {
			if (this.sideSheet) this.setSideSheet(false);
			else this.setSide(this.split.side === 'none' ? 'inspector' : this.split.side, true);
			return;
		}
		this.setSide(this.split.side === 'none' ? 'inspector' : 'none');
	}

	private setSideSheet(open: boolean): void {
		if (!this.narrow || this.sideSheet === open) return;
		this.sideSheet = open;
		this.layoutSide();
	}

	/** A scene to show beside this one: the next in reading order (or the one before). */
	private otherScene(): string | null {
		const order = this.st.w.scenes(this.projectId);
		const i = order.findIndex((s) => s.id === this.selected);
		return (order[i + 1] ?? order[i - 1] ?? order.find((s) => s.id !== this.selected))?.id ?? null;
	}

	private layoutSide(): void {
		const open = this.sideOpen();
		this.root.dataset.side = open ? this.split.side : 'none';
		this.root.toggleClass('is-side-sheet', this.narrow);
		this.root.toggleClass('is-side-open', open);
		this.root.style.setProperty('--ws-wr-side-w', `${this.split.width}px`);
		this.sideBtn.toggleClass('is-on', open);
		this.sideBtn.setAttr('aria-pressed', String(open));
		this.renderSideHead();
		this.refreshSide();
	}

	private renderSideHead(): void {
		const h = this.sideHeadEl;
		h.empty();
		const tabs = h.createDiv({ cls: 'ws-wr-side__tabs', attr: { role: 'tablist', 'aria-label': 'Side pane' } });
		for (const k of ['inspector', 'outline', 'research', 'scene', 'note'] as const) {
			const on = this.split.side === k;
			const b = tabs.createEl('button', { cls: cx('ws-wr-side__tab', on && 'is-active'), text: SIDE_LABEL[k], attr: { type: 'button', role: 'tab', 'aria-selected': String(on), 'data-side': k } });
			b.addEventListener('click', () => !on && this.setSide(k));
		}
		button(h, { icon: 'x', variant: 'quiet', size: 'sm', tooltip: 'Close the side pane', cls: 'ws-wr-side__close', onClick: () => (this.narrow ? this.setSideSheet(false) : this.setSide('none')) });
	}

	/** Fill the side pane with what it shows now (keeping an open editor as it is). */
	private refreshSide(): void {
		if (!this.sideBodyEl) return;
		const kind = this.split.side;
		const open = this.sideOpen();
		const it = this.st.w.item(this.selected) ?? null;
		this.sideBodyEl.toggleClass('is-hidden', !open);
		// The inspector.
		if (kind === 'inspector' && open) {
			if (!this.inspector) {
				this.inspector = new Inspector(this.st, this.sideBodyEl, this.split.tab, {
					onTab: (t) => {
						this.split.tab = t;
						this.saveSplit();
					},
					liveWords: (x) => this.sceneWords(x),
					onSelect: (id) => this.select(id),
				});
			}
			this.inspector.el.removeClass('is-hidden');
			this.inspector.show(it);
		} else this.inspector?.el.addClass('is-hidden');
		// 0.28: the book's outline, or its research, beside the page.
		let listEl = this.sideBodyEl.querySelector<HTMLElement>(':scope > .ws-wr-side__list');
		if ((kind === 'outline' || kind === 'research') && open) {
			if (!listEl) listEl = this.sideBodyEl.createDiv({ cls: 'ws-wr-side__list' });
			listEl.removeClass('is-hidden');
			listEl.empty();
			if (kind === 'outline') renderSideOutline(this.st, listEl, this.selected, (id) => this.select(id));
			else renderSideResearch(this.st, listEl);
		} else listEl?.addClass('is-hidden');
		// Another scene, or this scene's note to read.
		// A narrow pane only folds the side away: its editor stays open (closing and reopening
		// it on every resize would only churn), it's just not shown until the sheet opens.
		const pageKind: SideKind | null = kind === 'scene' || kind === 'note' ? kind : null;
		if (this.sidePageKind !== pageKind) {
			this.sidePage?.dispose();
			this.sidePage = null;
			this.sideBodyEl.querySelector('.ws-wr-side__page')?.remove();
			this.sidePageKind = pageKind;
			if (this.activePane && this.activePane !== this.page) this.activePane = this.page;
		}
		if (!pageKind) return;
		let wrap = this.sideBodyEl.querySelector<HTMLElement>('.ws-wr-side__page');
		if (!wrap) {
			wrap = this.sideBodyEl.createDiv({ cls: cx('ws-wr-side__page', `is-${pageKind}`) });
			wrap.createDiv({ cls: 'ws-wr-side__pick' });
			const pageEl = wrap.createDiv({ cls: cx('ws-wr-page ws-wr-page--side', pageKind === 'note' && 'ws-wr-page--reading') });
			if (pageKind === 'note') pinStyles(pageEl, '.markdown-preview-sizer', { minHeight: 'calc(100% - 70px)' });
			wrap.createDiv({ cls: 'ws-wr-side__msg' });
			const pane: ScenePane = new ScenePane({
				st: this.st,
				el: pageEl,
				memory: this.memory,
				mode: pageKind === 'note' ? 'preview' : 'edit',
				heading: (x) => (pageKind === 'note' ? null : this.heading(x)),
				onChange: () => {
					this.renderStatus();
					this.inspector?.paintWords();
				},
				onFocus: () => (this.activePane = pane),
			});
			this.sidePage = pane;
		}
		const pick = wrap.querySelector<HTMLElement>('.ws-wr-side__pick')!;
		const msg = wrap.querySelector<HTMLElement>('.ws-wr-side__msg')!;
		pick.empty();
		msg.empty();
		const target = pageKind === 'scene' ? this.st.w.item(this.split.scene) : it;
		if (pageKind === 'scene') {
			const b = pick.createEl('button', { cls: 'ws-wr-side__pickbtn', attr: { type: 'button', 'aria-haspopup': 'menu' } });
			icon(b, 'file-text');
			b.createSpan({ text: target?.title ?? 'Choose a scene' });
			icon(b, 'chevrons-up-down');
			b.addEventListener('click', () => this.sceneMenu(b));
		} else {
			pick.createSpan({ cls: 'ws-wr-muted', text: target?.kind === 'scene' && target.notePath ? target.notePath : '' });
		}
		const ok = !!target && target.kind === 'scene' && this.st.w.isLive(target.id) && this.st.w.noteState(target.id) === 'ok';
		wrap.toggleClass('is-empty', !ok);
		if (!ok) {
			msg.setText(pageKind === 'scene' ? 'Choose a scene to write in beside this one.' : 'Choose a scene in Contents to read its note here.');
			return;
		}
		void this.sidePage?.show(target);
	}

	private sceneMenu(anchor: HTMLElement): void {
		const m = new Menu();
		for (const sc of this.st.w.scenes(this.projectId)) {
			m.addItem((i) =>
				i
					.setTitle(sc.title)
					.setChecked(sc.id === this.split.scene)
					.setDisabled(this.st.w.noteState(sc.id) !== 'ok')
					.onClick(() => {
						this.split.scene = sc.id;
						this.saveSplit();
						this.refreshSide();
					}),
			);
		}
		const r = anchor.getBoundingClientRect();
		m.showAtPosition({ x: r.left, y: r.bottom + 4 });
	}

	private bindResizer(): void {
		const el = this.resizerEl;
		const clamp = (w: number) => {
			const room = this.root.getBoundingClientRect().width - 420;
			return Math.round(Math.max(SIDE_MIN, Math.min(SIDE_MAX, Math.min(room, w))));
		};
		const set = (w: number, save: boolean) => {
			this.split.width = clamp(w);
			this.root.style.setProperty('--ws-wr-side-w', `${this.split.width}px`);
			if (save) this.saveSplit();
		};
		el.addEventListener('pointerdown', (e) => {
			if (e.button !== 0) return;
			e.preventDefault();
			el.setPointerCapture(e.pointerId);
			el.addClass('is-dragging');
			const right = this.root.getBoundingClientRect().right;
			const move = (ev: PointerEvent) => set(right - ev.clientX, false);
			const up = () => {
				el.removeClass('is-dragging');
				el.removeEventListener('pointermove', move);
				el.removeEventListener('pointerup', up);
				el.removeEventListener('pointercancel', up);
				this.saveSplit();
			};
			el.addEventListener('pointermove', move);
			el.addEventListener('pointerup', up);
			el.addEventListener('pointercancel', up);
		});
		el.addEventListener('dblclick', () => set(DEFAULT_SPLIT.width, true));
		el.addEventListener('keydown', (e) => {
			if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
			e.preventDefault();
			set(this.split.width + (e.key === 'ArrowLeft' ? 24 : -24), true);
		});
	}
}
