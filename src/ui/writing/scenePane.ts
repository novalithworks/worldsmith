import { MarkdownView, TFile, type EventRef } from 'obsidian';
import type { ManuscriptItem } from '../../core/types';
import { debounce, type Debounced } from '../../core/util/async';
import { countWords } from '../../services/writing/wordCount';
import { button, icon } from '../components/dom';
import { EmbeddedEditor, type EmbedMode } from '../editor/EmbeddedEditor';
import { openNote, renameItem } from './actions';
import type { DeviceMemory } from './device';
import { caps, ornament, type Studio } from './kit';
import { paintSurface } from './look';

/*
 * One writing page (WS3): a scene's note in Obsidian's own editor on the page, with the
 * studio's heading above the text (chapter caps, ornament, serif title) inside the editor's
 * scroll, so it scrolls away with the text. The main page and a second scene beside it are
 * both one of these. Switching scenes switches the note in the same editor; each scene's
 * cursor and scroll are remembered on this device.
 *
 * When Obsidian won't let its editor be placed here, the page says so calmly and opens the
 * scene in a normal Obsidian tab beside the studio instead (never a home-made text box).
 */

export type SaveState = 'saved' | 'saving';

export interface ScenePaneOptions {
	st: Studio;
	/** The page element: the editor fills it. */
	el: HTMLElement;
	memory: DeviceMemory;
	mode?: EmbedMode;
	/** The heading on the page (label such as "Scene 2" and the title). */
	heading: (scene: ManuscriptItem) => { label: string; title: string } | null;
	/** Words or save state changed (status bars redraw). */
	onChange?: () => void;
	/** The person clicked or typed in this page. */
	onFocus?: () => void;
}

export class ScenePane {
	readonly el: HTMLElement;
	private host: HTMLElement;
	private ed: EmbeddedEditor | null = null;
	private headEl: HTMLElement | null = null;
	private fallbackEl: HTMLElement | null = null;
	private sceneRef: ManuscriptItem | null = null;
	/** Bumped on each show, so a slower earlier one never lands. */
	private gen = 0;
	private refs: Array<{ off(r: EventRef): void; ref: EventRef }> = [];
	private dead = false;
	private recount: Debounced<[]>;
	private keepPlace: Debounced<[]>;
	/** A while after the last keystroke, look again: an undo back to what's on disk writes nothing. */
	private settle: Debounced<[]>;
	private live: number | null = null;
	private saveStateRef: SaveState = 'saved';
	private typewriterRaf = 0;

	constructor(private readonly o: ScenePaneOptions) {
		this.el = o.el;
		this.host = this.el.createDiv({ cls: 'ws-wr-editor' });
		this.recount = debounce(() => this.countNow(), 350, 1500);
		this.keepPlace = debounce(() => this.savePlace(), 800, 4000);
		this.settle = debounce(() => {
			const f = this.ed?.file;
			if (f) void this.checkSaved(f);
		}, 2600);
		const app = o.st.ws.app;
		const ws = app.workspace;
		const vault = app.vault;
		this.refs.push(
			{ off: (r) => ws.offref(r), ref: ws.on('editor-change', (_e, info) => {
				if (this.dead || !this.ed || info !== this.ed.view) return;
				if (this.saveStateRef !== 'saving') {
					this.saveStateRef = 'saving';
					this.o.onChange?.();
				}
				this.recount();
				this.keepPlace();
				this.settle();
				this.typewriter();
			}) },
			{ off: (r) => vault.offref(r), ref: vault.on('modify', (f) => {
				if (this.dead || !(f instanceof TFile) || f !== this.ed?.file) return;
				void this.checkSaved(f);
			}) },
		);
		this.host.addEventListener('focusin', () => this.o.onFocus?.());
		// Moving the cursor (keys or a click) keeps typewriter mode centred and the place remembered.
		const moved = () => {
			this.typewriter();
			this.keepPlace();
		};
		this.host.addEventListener('keyup', moved);
		this.host.addEventListener('mouseup', moved);
		// Scrolling with the wheel or the scrollbar is remembered too (scroll doesn't bubble).
		this.host.addEventListener('scroll', () => this.keepPlace(), { capture: true, passive: true });
		// A click on the empty paper below the last line puts the cursor at the end (not a
		// press on the scrollbar or in the margins beside the text).
		this.el.addEventListener('mousedown', (e) => {
			if (e.button !== 0) return;
			const t = e.target as HTMLElement;
			if (t !== this.el && !t.classList.contains('cm-scroller')) return;
			const ed = this.ed?.editor;
			const sc = this.ed?.scroller;
			const content = sc?.querySelector('.cm-content');
			if (!ed || !sc || !content) return;
			const box = sc.getBoundingClientRect();
			if (e.clientX >= box.left + sc.clientWidth || e.clientY >= box.top + sc.clientHeight) return;
			const text = content.getBoundingClientRect();
			if (e.clientY <= text.bottom || e.clientX < text.left || e.clientX > text.right) return;
			e.preventDefault();
			const last = ed.lineCount() - 1;
			ed.setCursor({ line: last, ch: ed.getLine(last).length });
			ed.focus();
		});
	}

	get scene(): ManuscriptItem | null {
		return this.sceneRef;
	}
	/** Obsidian's editor of the page (null in the fallback or reading view). */
	get editor() {
		return this.ed?.editor ?? null;
	}
	get embedded(): EmbeddedEditor | null {
		return this.ed;
	}
	/** Words in the page right now (counted a moment after typing), or null before it's open. */
	get liveWords(): number | null {
		return this.live;
	}
	get saveState(): SaveState {
		return this.saveStateRef;
	}
	get isFallback(): boolean {
		return !!this.fallbackEl;
	}

	/**
	 * Show a scene (its note must exist). The same scene again only redraws the heading.
	 * One at a time: a request made while one runs waits, and only the newest runs.
	 */
	show(scene: ManuscriptItem): Promise<void> {
		const ticket = ++this.wanted;
		const run = () => (ticket === this.wanted && !this.dead ? this.showNow(scene) : Promise.resolve());
		this.queue = this.queue.then(run, run);
		return this.queue;
	}

	private wanted = 0;
	private queue: Promise<void> = Promise.resolve();

	private async showNow(scene: ManuscriptItem): Promise<void> {
		const st = this.o.st;
		const file = scene.notePath ? st.ws.app.vault.getAbstractFileByPath(scene.notePath) : null;
		const same = this.sceneRef?.id === scene.id && (!(file instanceof TFile) || this.ed?.file === file);
		// Remember where the last scene was left, under its own name, before switching.
		if (!same) this.savePlace();
		this.sceneRef = scene;
		if (same && (this.ed || this.fallbackEl)) {
			this.paintHead();
			if (this.fallbackEl) this.renderFallback(scene);
			return;
		}
		const gen = ++this.gen;
		if (!(file instanceof TFile)) return;
		paintSurface(this.el, st.ws.settings.writing);
		if (!this.ed && !EmbeddedEditor.canEmbed(st.ws.app)) return this.renderFallback(scene);
		this.clearFallback();
		try {
			if (!this.ed) {
				const ed = new EmbeddedEditor(st.ws.app, {
					host: this.host,
					mode: this.o.mode ?? 'edit',
					livePreview: true,
					activateOnFocus: true,
					// A link followed in the text opens beside the studio, not over the scene.
					onNavigate: (path) => void openNote(st.ws.app, path),
					// Ctrl/Cmd+W while writing closes the studio's tab (Obsidian saves first).
					onCloseRequest: () => ed.closeHome(),
					onFileChange: () => this.o.onChange?.(),
					// Obsidian closed the editor itself (the note deleted, say): open it again
					// if the note is still there; the page says what's wrong otherwise.
					onLost: () => this.lost(ed),
				});
				this.ed = ed;
				// WS6: the day's first snapshot of this scene, before any change.
				await st.ws.snapshots.autoDaily(scene);
				await ed.open(file);
			} else {
				await st.ws.snapshots.autoDaily(scene);
				await this.ed.setFile(file);
			}
		} catch (err) {
			if (this.dead || gen !== this.gen) return;
			console.warn('Worldsmith: the scene opens in a tab instead of the studio', err);
			this.ed?.dispose();
			this.ed = null;
			return this.renderFallback(scene);
		}
		if (this.dead || gen !== this.gen) return;
		this.saveStateRef = 'saved';
		this.paintHead();
		this.countNow();
		// Only when the editor really shows this scene's note.
		if (this.ed?.file === file) this.restorePlace(scene.id);
		this.o.onChange?.();
	}

	private lost(ed: EmbeddedEditor): void {
		if (this.ed !== ed) return;
		this.ed = null;
		this.headEl = null;
		this.live = null;
		const scene = this.sceneRef;
		this.sceneRef = null;
		this.o.onChange?.();
		if (this.dead || !scene) return;
		const file = scene.notePath ? this.o.st.ws.app.vault.getAbstractFileByPath(scene.notePath) : null;
		if (file instanceof TFile) void this.show(scene);
	}

	/** The heading inside the editor's scroll, above the text. */
	private paintHead(): void {
		const scene = this.sceneRef;
		if (!scene) return;
		const h = this.o.heading(scene);
		const sizer = this.ed?.view?.contentEl.querySelector('.markdown-source-view .cm-sizer, .markdown-preview-view .markdown-preview-sizer');
		if (!h || !sizer) {
			this.headEl?.remove();
			this.headEl = null;
			return;
		}
		if (!this.headEl) {
			this.headEl = createDiv({ cls: 'ws-wr-pagehead', attr: { contenteditable: 'false' } });
			// Clicks here are not clicks in the text.
			this.headEl.addEventListener('mousedown', (e) => e.stopPropagation());
		}
		if (this.headEl.parentElement !== sizer || sizer.firstElementChild !== this.headEl) sizer.prepend(this.headEl);
		const el = this.headEl;
		el.empty();
		caps(el, h.label, 'ws-wr-pagehead__label');
		ornament(el);
		const row = el.createDiv({ cls: 'ws-wr-pagehead__row' });
		row.createEl('h1', { cls: 'ws-wr-pagehead__title', text: h.title });
		button(row, { icon: 'pencil', variant: 'quiet', size: 'sm', tooltip: 'Rename', cls: 'ws-wr-pagehead__rename', onClick: () => void renameItem(this.o.st, scene) });
	}

	private renderFallback(scene: ManuscriptItem): void {
		this.clearFallback();
		const box = this.el.createDiv({ cls: 'ws-wr-fallback' });
		this.fallbackEl = box;
		const h = this.o.heading(scene);
		if (h) {
			caps(box, h.label, 'ws-wr-pagehead__label');
			ornament(box);
			box.createEl('h1', { cls: 'ws-wr-pagehead__title', text: h.title });
		}
		const msg = box.createDiv({ cls: 'ws-wr-fallback__msg' });
		icon(msg, 'feather');
		msg.createSpan({ text: 'This version of Obsidian doesn’t let the studio hold its editor, so this scene opens in a normal Obsidian tab beside the studio. Your text is safe in its note, and everything else here works as usual.' });
		const path = scene.notePath;
		if (path) {
			const row = box.createDiv({ cls: 'ws-wr-sheet__actions' });
			button(row, { label: 'Open in a tab', icon: 'file-plus-2', variant: 'primary', size: 'sm', cls: 'ws-wr-fallback__open', onClick: () => void openNote(this.o.st.ws.app, path) });
			box.createDiv({ cls: 'ws-wr-sheet__help', text: path });
		}
		this.live = null;
		this.o.onChange?.();
	}

	private clearFallback(): void {
		this.fallbackEl?.remove();
		this.fallbackEl = null;
	}

	private countNow(): void {
		const ed = this.ed?.editor;
		const view = this.ed?.view;
		const text = ed ? ed.getValue() : view instanceof MarkdownView ? view.getViewData() : null;
		const n = text === null ? null : countWords(text);
		if (n === this.live) return;
		this.live = n;
		this.o.onChange?.();
	}

	/** Saved for real: the note on disk (Obsidian's copy) has what the editor has. */
	private async checkSaved(f: TFile): Promise<void> {
		const ed = this.ed?.editor;
		if (!ed) return;
		let disk: string;
		try {
			disk = await this.o.st.ws.app.vault.cachedRead(f);
		} catch {
			return;
		}
		if (this.dead || this.ed?.file !== f) return;
		const next: SaveState = disk === ed.getValue() ? 'saved' : 'saving';
		if (next !== this.saveStateRef) {
			this.saveStateRef = next;
			this.o.onChange?.();
		}
	}

	/** Typewriter mode: keep the cursor's line in the middle of the page. */
	private typewriter(): void {
		if (!this.o.st.ws.settings.writing.typewriter || this.typewriterRaf) return;
		this.typewriterRaf = window.requestAnimationFrame(() => {
			this.typewriterRaf = 0;
			const ed = this.ed?.editor;
			if (!ed || this.dead || !this.host.contains(activeDocument.activeElement)) return;
			const c = ed.getCursor('head');
			ed.scrollIntoView({ from: c, to: c }, true);
		});
	}

	/** Centre the cursor now (typewriter turned on). */
	centre(): void {
		const ed = this.ed?.editor;
		if (!ed) return;
		const c = ed.getCursor('head');
		ed.scrollIntoView({ from: c, to: c }, true);
	}

	private savePlace(): void {
		const id = this.sceneRef?.id;
		const ed = this.ed?.editor;
		if (!id || !ed || this.fallbackEl) return;
		// Mid-switch the editor still shows the last scene: nothing to remember yet.
		if (this.ed?.file?.path !== this.sceneRef?.notePath) return;
		// Off screen (the tab closing, or hidden) the scroll reads 0: keep what was saved.
		const sc = this.ed?.scroller;
		if (!sc || !sc.isConnected || sc.clientHeight === 0) return;
		const c = ed.getCursor('head');
		this.o.memory.setPlace(id, { line: c.line, ch: c.ch, top: ed.getScrollInfo().top });
	}

	private restorePlace(id: string): void {
		const ed = this.ed?.editor;
		const p = this.o.memory.place(id);
		if (!ed) return;
		if (!p) {
			ed.scrollTo(null, 0);
			return;
		}
		const line = Math.min(p.line, ed.lineCount() - 1);
		ed.setCursor({ line, ch: Math.min(p.ch, ed.getLine(line).length) });
		// After the editor has laid out the text.
		const apply = () => !this.dead && this.sceneRef?.id === id && ed.scrollTo(null, p.top);
		apply();
		window.requestAnimationFrame(() => {
			apply();
			window.setTimeout(apply, 120);
			// Long notes settle their line heights a little later.
			window.setTimeout(apply, 450);
		});
	}

	/** Re-read the look settings (surface colours for the Theme surface). */
	repaint(): void {
		paintSurface(this.el, this.o.st.ws.settings.writing);
		this.paintHead();
	}

	focus(): void {
		this.ed?.focus();
		// Already focused means no focusin: make it the active editor by hand.
		this.ed?.activate();
		window.setTimeout(() => this.ed?.activate(), 0);
	}

	dispose(): void {
		if (this.dead) return;
		this.keepPlace.cancel();
		this.recount.cancel();
		this.settle.cancel();
		this.savePlace();
		this.dead = true;
		if (this.typewriterRaf) window.cancelAnimationFrame(this.typewriterRaf);
		for (const r of this.refs) r.off(r.ref);
		this.refs = [];
		this.ed?.dispose();
		this.ed = null;
	}
}

