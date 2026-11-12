import { MarkdownView, TFile, WorkspaceSplit, type App, type Editor, type EventRef, type ViewState, type Workspace, type WorkspaceLeaf } from 'obsidian';

/*
 * Obsidian's own note editor, placed inside a Worldsmith page (WS3; first made for the note
 * window in 0.12.4 and 0.12.5). It is a real MarkdownView in a real WorkspaceLeaf, so Live
 * Preview, undo, spellcheck, find, the user's hotkeys, other plugins and autosave all come
 * from Obsidian, and two views of one note (this one and a normal tab) stay in step because
 * Obsidian keeps them in step.
 *
 * None of this is public API, which is why every undocumented piece Worldsmith relies on for
 * it lives in this one file and is feature-checked (`canEmbed`):
 *
 *  - `new WorkspaceSplit(workspace, 'vertical')`: a little workspace of our own, outside the
 *    main layout (so it is never saved in the layout), with `getRoot`/`getContainer` patched
 *    to say it belongs to the main area (what Hover Editor does).
 *  - `workspace.createLeafInParent(split, 0)`: one tab in it.
 *  - `workspace.getLeafPopover` / `openPopover` (older Obsidian's pop-over leaf), tried first
 *    for the note window only.
 *  - `workspace.setActiveLeaf` replaced for a moment while the leaf opens (`holdActiveLeaf`),
 *    so opening a note never switches tabs or flashes it in the main area.
 *  - For the Writing Studio (`activateOnFocus`): the leaf's own `getRoot`/`getContainer`, so
 *    `workspace.setActiveLeaf` accepts it. While the person types in it, it is Obsidian's
 *    active leaf, so Bold, Find and every other command that acts on "the active editor"
 *    act on it. Obsidian itself gives the pane back its active state on the next click
 *    anywhere else (each leaf listens for pointerdown), and `release()` does on leaving.
 *    Found in Obsidian 1.14: a leaf in a private split is not "attached" (its `getRoot()`
 *    walks up to the split), so without the patch `setActiveLeaf` ignores it; and the pane
 *    around it takes the active state back on every `focusin` (bubbling), so we take it
 *    again right after (`activate()` on focusin and once more on the next tick).
 *  - `leaf.setViewState` wrapped (`onNavigate`): following a link inside the studio's page
 *    opens that note elsewhere instead of replacing the scene.
 *  - `leaf.detach` wrapped (`onCloseRequest`): Ctrl/Cmd+W while typing closes the studio's
 *    tab (the one the person sees), not the hidden editor tab inside it.
 *  - `workspace.pushUndoHistory` skipped while our leaf closes, so "Reopen closed tab" never
 *    brings back a tab the person never had.
 *
 * Closing (`dispose`) detaches the leaf, and Obsidian saves the note as its editor closes.
 */

export type EmbedMode = 'edit' | 'preview';

export interface EmbeddedEditorOptions {
	/** Where the editor goes; it fills this element. */
	host: HTMLElement;
	mode?: EmbedMode;
	/** Editing in Live Preview (true), Source mode (false), or as the person's default (undefined). */
	livePreview?: boolean;
	/** Try Obsidian's pop-over leaf first (the note window). */
	popover?: boolean;
	/** Be Obsidian's active leaf while the person types in it, so hotkeys and commands act here. */
	activateOnFocus?: boolean;
	/**
	 * Following a link (or Back/Forward) to another note inside the editor: called instead of
	 * replacing what it shows. Without it, the editor goes to that note (`onFileChange`).
	 */
	onNavigate?: (path: string) => void;
	/** The note shown changed (a link followed inside, or a rename). */
	onFileChange?: (file: TFile | null) => void;
	/** "Close tab" while it has focus: close what the person sees instead (the studio's tab). */
	onCloseRequest?: () => void;
	/**
	 * Obsidian closed the editor's leaf itself (its note was deleted, a plugin closed it):
	 * the editor is gone (disposed); the page shows a message or opens a new one.
	 */
	onLost?: () => void;
}

/** Older Obsidian's pop-over leaf (Hover Editor, ATLAS VTT). */
interface PopoverWorkspace {
	getLeafPopover?: () => WorkspaceLeaf | null;
	openPopover?: (leaf: WorkspaceLeaf, el: HTMLElement, o?: { focus?: boolean }) => void;
}
type InternalLeaf = WorkspaceLeaf & { getRoot(): unknown; getContainer(): unknown };
type InternalSplit = WorkspaceSplit & {
	containerEl: HTMLElement;
	children: WorkspaceLeaf[];
	getRoot(): unknown;
	getContainer(): unknown;
	insertChild(index: number, child: WorkspaceLeaf, resize?: boolean): void;
};
type TabParent = { children: unknown[]; insertChild(index: number, child: WorkspaceLeaf, resize?: boolean): void };
interface InternalWorkspace {
	activeLeaf?: WorkspaceLeaf | null;
	pushUndoHistory?: (...a: unknown[]) => void;
	setActiveLeaf?: (...a: unknown[]) => void;
	createLeafBySplit?: (leaf: WorkspaceLeaf, ...a: unknown[]) => WorkspaceLeaf;
}

/** Set while testing to show the fallback in real Obsidian. */
let embedOff = false;
/** The editors open now (so a split or merge can save what's typed first). */
const live = new Set<EmbeddedEditor>();
/** Our leaves, and the editor each belongs to. */
const ownLeaves = new Map<WorkspaceLeaf, EmbeddedEditor>();
/**
 * "Split right" (and anything else that splits the active leaf) on our leaf splits the
 * studio's tab instead, so no new leaf ends up inside our private split. Installed while
 * any of our leaves exists.
 */
const splitPatched = new WeakMap<object, { count: number; own: InternalWorkspace['createLeafBySplit']; had: boolean }>();
function patchSplitting(workspace: object): () => void {
	const w = workspace as InternalWorkspace;
	if (typeof w.createLeafBySplit !== 'function') return () => {};
	let h = splitPatched.get(w);
	if (!h) {
		const had = Object.prototype.hasOwnProperty.call(w, 'createLeafBySplit');
		const own = w.createLeafBySplit;
		h = { count: 0, own: had ? own : undefined, had };
		splitPatched.set(w, h);
		w.createLeafBySplit = function (this: unknown, leaf: WorkspaceLeaf, ...a: unknown[]) {
			const home = ownLeaves.get(leaf)?.homeLeaf();
			return own.call(this, home ?? leaf, ...a);
		};
	}
	h.count++;
	const held = h;
	let done = false;
	return () => {
		if (done) return;
		done = true;
		if (--held.count > 0) return;
		splitPatched.delete(w);
		if (held.had) w.createLeafBySplit = held.own;
		else delete w.createLeafBySplit;
	};
}

export class EmbeddedEditor {
	/** Can this Obsidian put a note editor inside a page? (False on a future Obsidian that drops the pieces.) */
	static canEmbed(app: App, o: { popover?: boolean } = {}): boolean {
		if (embedOff) return false;
		const pw = app.workspace as unknown as PopoverWorkspace;
		if (o.popover && typeof pw.getLeafPopover === 'function' && typeof pw.openPopover === 'function') return true;
		return typeof WorkspaceSplit === 'function' && typeof app.workspace.createLeafInParent === 'function';
	}

	/** Pretend embedding isn't possible (for checking the fallback). */
	static setDisabled(off: boolean): void {
		embedOff = off;
	}

	/**
	 * Save what's typed in any studio editor showing one of these notes, now (Obsidian would
	 * a moment later). Run before reading a note to change it, so the change starts from what
	 * the person sees.
	 */
	static async saveOpen(paths: Array<string | null | undefined>): Promise<void> {
		const want = new Set(paths.filter((p): p is string => !!p));
		const jobs: Promise<void>[] = [];
		for (const e of live) {
			const v = e.view;
			if (v && e.file && want.has(e.file.path)) jobs.push(Promise.resolve(v.save()).catch(() => {}));
		}
		await Promise.all(jobs);
	}

	private leafRef: WorkspaceLeaf | null = null;
	private splitRef: InternalSplit | null = null;
	private dead = false;
	private refs: EventRef[] = [];
	private vaultRefs: EventRef[] = [];
	private cleanups: Array<() => void> = [];
	/** Our own openFile is running (not a link followed inside). */
	private ownNav = 0;
	/** Our own detach is running (not a "close tab" command). */
	private closing = false;
	private lastPath: string | null = null;

	constructor(
		private readonly app: App,
		private readonly o: EmbeddedEditorOptions,
	) {}

	get leaf(): WorkspaceLeaf | null {
		return this.leafRef;
	}
	get disposed(): boolean {
		return this.dead;
	}
	/** The note's view (null until open, or when Obsidian shows something else in the leaf). */
	get view(): MarkdownView | null {
		const v = this.leafRef?.view;
		return v instanceof MarkdownView ? v : null;
	}
	/** Obsidian's editor of the note (null in reading view). */
	get editor(): Editor | null {
		const v = this.view;
		return v && v.getMode() === 'source' ? v.editor : null;
	}
	get file(): TFile | null {
		const f = (this.leafRef?.view as { file?: TFile | null } | undefined)?.file;
		return f instanceof TFile ? f : null;
	}

	private get ws(): Workspace {
		return this.app.workspace;
	}

	private state(): Record<string, unknown> {
		if (this.o.mode === 'preview') return { mode: 'preview' };
		return this.o.livePreview === undefined ? { mode: 'source' } : { mode: 'source', source: !this.o.livePreview };
	}

	/**
	 * Make the leaf and show the note in it. Throws when Obsidian won't (the caller shows its
	 * fallback). Safe to `dispose()` while this runs.
	 */
	async open(file: TFile): Promise<void> {
		if (this.leafRef) return this.setFile(file);
		if (!EmbeddedEditor.canEmbed(this.app, { popover: this.o.popover })) throw new Error('Obsidian’s editor can’t be placed here.');
		const workspace = this.ws;
		const pw = workspace as unknown as PopoverWorkspace;
		const host = this.o.host;
		// The pane that's active now (Worldsmith's, wherever it is) stays active: opening the
		// note mustn't switch tabs or flash the note in the main area.
		const before = (workspace as unknown as InternalWorkspace).activeLeaf ?? null;
		live.add(this);
		const hold = holdActiveLeaf(workspace);
		try {
			let leaf: WorkspaceLeaf | null = null;
			if (this.o.popover && typeof pw.getLeafPopover === 'function' && typeof pw.openPopover === 'function') {
				leaf = pw.getLeafPopover();
				if (leaf) {
					this.leafRef = leaf;
					await this.openIn(leaf, file);
					if (this.dead) return;
					pw.openPopover(leaf, host, { focus: false });
				}
			}
			if (!leaf) {
				// A little workspace of our own with one tab in it, outside the main layout.
				const split = new (WorkspaceSplit as unknown as new (ws: Workspace, dir: string) => WorkspaceSplit)(workspace, 'vertical') as InternalSplit;
				split.getRoot = () => workspace.rootSplit;
				split.getContainer = () => workspace.rootSplit;
				// A new tab meant to go "next to" our leaf (Ctrl/Cmd+T, a link opened in a new
				// tab while ours is the active one) goes next to the studio's tab instead.
				if (typeof split.insertChild === 'function') {
					const ownInsert = split.insertChild.bind(split);
					split.insertChild = (index: number, child: WorkspaceLeaf, resize?: boolean) => {
						if (!this.leafRef || child === this.leafRef) return ownInsert(index, child, resize);
						const home = this.homeLeaf();
						const parent = (home as unknown as { parent?: TabParent } | null)?.parent;
						if (home && parent && typeof parent.insertChild === 'function' && Array.isArray(parent.children))
							return parent.insertChild(parent.children.indexOf(home) + 1, child, resize);
						return ownInsert(index, child, resize);
					};
				}
				this.splitRef = split;
				host.appendChild(split.containerEl);
				leaf = workspace.createLeafInParent(split, 0);
				this.leafRef = leaf;
				ownLeaves.set(leaf, this);
				this.cleanups.push(patchSplitting(workspace));
				this.patchLeaf(leaf);
				await this.openIn(leaf, file);
				if (this.dead) return;
			}
			hold();
			if (before && before !== leaf) workspace.setActiveLeaf(before, { focus: false });
		} catch (err) {
			this.detachLeaf();
			throw err;
		} finally {
			hold();
		}
		this.lastPath = this.file?.path ?? null;
		// A link followed inside (when not redirected) or a rename: tell the page.
		const sync = () => {
			if (this.dead) return;
			// Obsidian swapped the note out of our leaf (its note was deleted: "New tab"): the
			// editor is gone; the page shows what's wrong instead of Obsidian's empty tab.
			if (!this.ownNav && this.leafRef?.view?.getViewType?.() === 'empty') return this.lose();
			const p = this.file?.path ?? null;
			if (p === this.lastPath) return;
			this.lastPath = p;
			this.o.onFileChange?.(this.file);
		};
		this.refs.push(workspace.on('file-open', sync), workspace.on('layout-change', sync));
		this.vaultRefs.push(
			this.app.vault.on('rename', () => window.setTimeout(sync, 0)),
			this.app.vault.on('delete', () => window.setTimeout(sync, 0)),
		);
		const click = () => window.setTimeout(sync, 250);
		host.addEventListener('click', click);
		this.cleanups.push(() => host.removeEventListener('click', click));
		if (this.o.activateOnFocus) {
			const win = host.ownerDocument.defaultView ?? window;
			const onFocus = () => {
				this.activate();
				win.setTimeout(() => this.activate(), 0);
			};
			host.addEventListener('focusin', onFocus);
			// A press elsewhere in the pane that keeps the cursor in the text (a toolbar button)
			// makes the pane active again. Before any key reaches Obsidian's hotkeys (window,
			// capture: first in line), the text that has the cursor gets the active state back.
			const onKey = () => this.activate();
			win.addEventListener('keydown', onKey, true);
			this.cleanups.push(() => {
				host.removeEventListener('focusin', onFocus);
				win.removeEventListener('keydown', onKey, true);
			});
		}
	}

	private async openIn(leaf: WorkspaceLeaf, file: TFile): Promise<void> {
		this.ownNav++;
		try {
			await leaf.openFile(file, { active: false, state: this.state() });
		} finally {
			this.ownNav--;
		}
	}

	/** Is this editor's leaf the active one? (Its view is a note view, so the active note view tells.) */
	private isActive(leaf: WorkspaceLeaf | null): boolean {
		return !!leaf && this.ws.getActiveViewOfType(MarkdownView)?.leaf === leaf;
	}

	/** Show another note in the same editor (no remount). */
	async setFile(file: TFile): Promise<void> {
		const leaf = this.leafRef;
		if (!leaf || this.dead) return;
		if (this.file === file) return;
		const hold = this.isActive(leaf) ? () => {} : holdActiveLeaf(this.ws);
		try {
			await this.openIn(leaf, file);
		} finally {
			hold();
		}
		this.lastPath = this.file?.path ?? null;
	}

	/** Switch between editing and reading. */
	async setMode(mode: EmbedMode): Promise<void> {
		this.o.mode = mode;
		const leaf = this.leafRef;
		const file = this.file;
		if (!leaf || !file || this.dead) return;
		this.ownNav++;
		try {
			await leaf.setViewState({ type: 'markdown', state: { ...this.state(), file: file.path }, active: false });
		} finally {
			this.ownNav--;
		}
	}

	/** Become Obsidian's active leaf, when the person's focus is in the editor. */
	activate(): void {
		const leaf = this.leafRef;
		if (this.dead || !leaf || !this.o.activateOnFocus) return;
		const doc = this.o.host.ownerDocument;
		if (!this.o.host.contains(doc.activeElement)) return;
		if (!this.isActive(leaf)) this.ws.setActiveLeaf(leaf, { focus: false });
	}

	/** Give the active state back to the pane the editor sits in. */
	release(): void {
		const leaf = this.leafRef;
		if (!leaf || !this.isActive(leaf)) return;
		const home = this.homeLeaf();
		if (home) this.ws.setActiveLeaf(home, { focus: false });
	}

	/** Close the tab the editor sits in (the one the person sees). */
	closeHome(): void {
		const home = this.homeLeaf();
		this.release();
		home?.detach();
	}

	/** The (real) leaf whose page holds the editor. */
	homeLeaf(): WorkspaceLeaf | null {
		let found: WorkspaceLeaf | null = null;
		this.ws.iterateAllLeaves((l) => {
			if (!found && l !== this.leafRef && l.view.containerEl.contains(this.o.host)) found = l;
		});
		return found;
	}

	focus(): void {
		this.editor?.focus();
	}

	/** The editor's own scrolling element (CodeMirror's), for typewriter mode and scroll memory. */
	get scroller(): HTMLElement | null {
		return (this.view?.contentEl.querySelector('.markdown-source-view .cm-scroller') as HTMLElement | null) ?? null;
	}

	private patchLeaf(leaf: WorkspaceLeaf): void {
		const l = leaf as InternalLeaf;
		const workspace = this.ws;
		if (this.o.activateOnFocus) {
			l.getRoot = () => workspace.rootSplit;
			l.getContainer = () => workspace.rootSplit;
		}
		if (this.o.onNavigate) {
			const own = leaf.setViewState.bind(leaf);
			leaf.setViewState = (vs: ViewState, eState?: unknown) => {
				const path = (vs?.state as { file?: unknown } | undefined)?.file;
				const cur = this.file?.path ?? null;
				if (!this.ownNav && !this.dead && typeof path === 'string' && cur && path !== cur) {
					this.release();
					this.o.onNavigate?.(path);
					return Promise.resolve();
				}
				return own(vs, eState);
			};
		}
		if (this.o.onCloseRequest) {
			const own = leaf.detach.bind(leaf);
			leaf.detach = () => {
				if (this.dead || this.closing) return own();
				// Only "Close tab" pressed while typing here closes the studio's tab. Anything
				// else closing our leaf (the note deleted, another plugin) closes just the editor.
				const doc = this.o.host.ownerDocument;
				if (this.isActive(leaf) && this.o.host.contains(doc.activeElement)) {
					this.release();
					this.o.onCloseRequest?.();
					return;
				}
				this.closing = true;
				const restore = skipUndoHistory(this.ws);
				try {
					own();
				} finally {
					this.closing = false;
					restore();
				}
				this.leafRef = null;
				this.lose();
			};
			this.cleanups.push(() => (leaf.detach = own));
		}
	}

	/** The editor is gone without the person closing it: dispose, and tell the page. */
	private lose(): void {
		if (this.dead) return;
		this.dispose();
		this.o.onLost?.();
	}

	private detachLeaf(): void {
		const leaf = this.leafRef;
		this.leafRef = null;
		const split = this.splitRef;
		this.splitRef = null;
		if (leaf) ownLeaves.delete(leaf);
		// Every leaf in our split goes (one that slipped in too), and the split's element.
		const extra = split ? [...(split.children ?? [])].filter((c) => c !== leaf) : [];
		const removeSplit = () => split?.containerEl.remove();
		if (!leaf && !extra.length) return removeSplit();
		const restore = skipUndoHistory(this.ws);
		this.closing = true;
		try {
			leaf?.detach();
			for (const c of extra) c.detach();
		} finally {
			this.closing = false;
			restore();
			removeSplit();
		}
	}

	/** Close the editor (Obsidian saves the note as it closes). */
	dispose(): void {
		if (this.dead) return;
		this.release();
		this.dead = true;
		live.delete(this);
		for (const r of this.refs) this.ws.offref(r);
		for (const r of this.vaultRefs) this.app.vault.offref(r);
		this.refs = [];
		this.vaultRefs = [];
		for (const c of this.cleanups.splice(0)) c();
		this.detachLeaf();
	}
}

/** "Reopen closed tab" never brings back a leaf the person never had: skip its history entry. */
function skipUndoHistory(workspace: object): () => void {
	const w = workspace as InternalWorkspace;
	const had = Object.prototype.hasOwnProperty.call(w, 'pushUndoHistory');
	const own = w.pushUndoHistory;
	if (typeof own !== 'function') return () => {};
	w.pushUndoHistory = () => {};
	return () => {
		if (had) w.pushUndoHistory = own;
		else delete w.pushUndoHistory;
	};
}

/**
 * Holds on the workspace's active pane, counted: two editors opening at once (the page and
 * the side pane) share one hold, and the workspace gets its own `setActiveLeaf` back only
 * when the last of them lets go — never a stand-in left behind by the other.
 */
const holds = new WeakMap<object, { count: number; own: InternalWorkspace['setActiveLeaf'] | undefined; had: boolean }>();

/** Stop the workspace switching panes until the returned function is called (once is enough). */
function holdActiveLeaf(workspace: object): () => void {
	const w = workspace as InternalWorkspace;
	if (typeof w.setActiveLeaf !== 'function') return () => {};
	let h = holds.get(w);
	if (!h) {
		const had = Object.prototype.hasOwnProperty.call(w, 'setActiveLeaf');
		h = { count: 0, own: had ? w.setActiveLeaf : undefined, had };
		holds.set(w, h);
		w.setActiveLeaf = () => {};
	}
	h.count++;
	const held = h;
	let done = false;
	return () => {
		if (done) return;
		done = true;
		if (--held.count > 0) return;
		holds.delete(w);
		if (held.had) w.setActiveLeaf = held.own;
		else delete w.setActiveLeaf;
	};
}
