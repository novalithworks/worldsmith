import { Component, MarkdownRenderer, Menu, Notice, TFile, type EventRef } from 'obsidian';
import type { WorldsmithContext } from '../../app/context';
import type { EntityRecord } from '../../core/types';
import { plainText, splitNote } from '../../core/util/strings';
import type { WorldSession } from '../../services/WorldSession';
import { avatar } from '../components/avatar';
import { cardFieldsOf } from '../components/entityCard';
import { button, cx, icon } from '../components/dom';
import { EmbeddedEditor } from '../editor/EmbeddedEditor';

/**
 * Hold Ctrl (⌘ on a Mac) and hover a pin, a dot or a card to read its entry and its note
 * (0.12; a window of its own in 0.12.3). The preview follows the pointer and goes when you
 * move away; pin it (or drag, resize or edit it) and it stays: move it by its top bar,
 * resize it from the corner, switch between the entry's notes, and edit the note in place.
 */
export interface PeekTarget {
	entity?: EntityRecord;
	/** A pin's or area's own name and note, shown under the entry. */
	title?: string;
	note?: string;
}

export interface Peek {
	hide(): void;
	destroy(): void;
}

/** Long notes are shown in full up to this many characters (then "open it" for the rest). */
const NOTE_CHARS = 60000;
const MIN_W = 300;
const MIN_H = 220;
/** The last size a window was given, so the next one opens the same. */
let lastSize: { w: number; h: number } | null = null;

const EDGES = ['n', 'e', 's', 'w', 'ne', 'se', 'sw', 'nw'] as const;
type Edge = (typeof EDGES)[number];

class PeekWindow {
	readonly el: HTMLElement;
	pinned = false;
	private head: HTMLElement;
	private body: HTMLElement;
	private scope: Component | null = null;
	private notePath: string | null;
	private editing = false;
	/** What the file held when last read or written: a save checks nobody changed it since. */
	private known: string | null = null;
	private dirty = false;
	private saveTimer = 0;
	private statusEl: HTMLElement | null = null;
	private vaultRefs: EventRef[] = [];
	private pinBtn!: HTMLButtonElement;
	private dead = false;
	/** The note's editor while editing (one per window). */
	private editor: HTMLTextAreaElement | null = null;
	/** Bumped on every render of the note, so a slower earlier one never lands. */
	private gen = 0;
	/** Saves run one after another: each one checks the file against the last write. */
	private saving: Promise<boolean> = Promise.resolve(true);
	/** The note changed elsewhere (or went away) and the person hasn't chosen yet. */
	private unresolved = false;
	/** The note's own editor inside the window (Obsidian's), when it could be made. */
	private editorView: EmbeddedEditor | null = null;
	private embedded = false;

	constructor(
		private readonly root: HTMLElement,
		private readonly ws: WorldsmithContext,
		private readonly s: WorldSession,
		readonly target: PeekTarget,
		private readonly events: { onPin: (w: PeekWindow) => void; onUnpin: (w: PeekWindow) => void; onClose: (w: PeekWindow) => void; onFront: (w: PeekWindow) => void },
	) {
		const e = this.entity;
		const schema = e ? s.schemas.get(e.typeId) : undefined;
		this.notePath = e ? (ws.linkedNotes.notes(e).find((n) => n.file)?.path ?? null) : null;
		this.el = root.createDiv({ cls: cx('ws-peek', schema?.color && `ws-tint--${schema.color}`), attr: { role: 'dialog', 'aria-label': e?.name ?? target.title ?? 'Preview' } });
		const size = lastSize ?? { w: 460, h: Math.min(560, Math.round(this.win.innerHeight * 0.75)) };
		this.el.style.width = `${size.w}px`;
		this.el.style.height = `${size.h}px`;
		this.head = this.el.createDiv({ cls: 'ws-peek__head' });
		this.body = this.el.createDiv({ cls: 'ws-peek__body' });
		this.el.addEventListener('pointerdown', () => this.events.onFront(this));
		this.el.addEventListener('animationend', () => this.el.addClass('is-shown'), { once: true });
		this.bindDrag();
		this.bindResize();
		this.embedded = !!this.file && EmbeddedEditor.canEmbed(ws.app, { popover: true });
		this.renderHead();
		this.renderBody();
		const vault = ws.app.vault;
		this.vaultRefs.push(
			vault.on('modify', (f) => {
				if (!this.dead && !this.embedded && f instanceof TFile && f.path === this.notePath && !this.editing) void this.renderNote();
			}),
			// The note moved: follow it, so edits go to the same note under its new name.
			vault.on('rename', (f, oldPath) => {
				if (this.dead || oldPath !== this.notePath) return;
				this.notePath = f.path;
				this.noteBox?.querySelector('.ws-peek__note-name')?.setText(f instanceof TFile ? f.basename : f.name);
			}),
			vault.on('delete', (f) => {
				if (this.dead || this.embedded || f.path !== this.notePath) return;
				if (this.editing && this.dirty) this.goneWhileEditing();
				else if (!this.editing) void this.renderNote();
			}),
		);
	}

	get win(): Window {
		return this.root.ownerDocument.defaultView ?? window;
	}

	private get entity(): EntityRecord | undefined {
		const e = this.target.entity ? this.s.entities.get(this.target.entity.id) ?? this.target.entity : undefined;
		return e && !e.trashedAt ? e : undefined;
	}

	private get file(): TFile | null {
		const f = this.notePath ? this.ws.app.vault.getAbstractFileByPath(this.notePath) : null;
		return f instanceof TFile && f.extension === 'md' ? f : null;
	}

	// ── top bar ───────────────────────────────────────────────────────────────

	private renderHead(): void {
		const h = this.head;
		h.empty();
		this.el.dataset.note = this.notePath ?? '';
		const e = this.entity;
		const schema = e ? this.s.schemas.get(e.typeId) : undefined;
		if (e) avatar(h, this.ws.app, e, schema, { size: 'sm' });
		const tt = h.createDiv({ cls: 'ws-peek__titles' });
		tt.createDiv({ cls: 'ws-peek__name', text: e?.name ?? this.target.title ?? 'Untitled' });
		if (e) {
			const status = this.s.world.statuses.find((x) => x.id === e.status);
			const sub = [schema?.singular, status?.label].filter(Boolean).join(' · ');
			if (sub) tt.createDiv({ cls: 'ws-peek__sub', text: sub });
		}
		const acts = h.createDiv({ cls: 'ws-peek__actions' });
		const notes = e ? this.ws.linkedNotes.notes(e).filter((n) => n.file) : [];
		if (notes.length > 1) {
			button(acts, {
				icon: 'files',
				label: String(notes.length),
				variant: 'quiet',
				size: 'sm',
				tooltip: 'Choose a note',
				cls: 'ws-peek__notes',
				onClick: (evt) => this.noteMenu(evt),
			});
		}
		if (this.file && !this.embedded) {
			button(acts, {
				icon: this.editing ? 'book-open' : 'pencil',
				variant: 'quiet',
				size: 'sm',
				tooltip: this.editing ? 'Back to reading' : 'Edit the note here',
				cls: cx('ws-peek__edit', this.editing && 'is-on').join(' '),
				onClick: () => void this.setEditing(!this.editing),
			});
		}
		if (this.file) button(acts, { icon: 'external-link', variant: 'quiet', size: 'sm', tooltip: 'Open the note in a tab', cls: 'ws-peek__open', onClick: () => void this.openNote() });
		this.pinBtn = button(acts, { icon: 'pin', variant: 'quiet', size: 'sm', tooltip: this.pinned ? 'Unpin' : 'Pin it open', cls: cx('ws-peek__pin', this.pinned && 'is-on').join(' '), onClick: () => this.setPinned(!this.pinned) });
		this.pinBtn.setAttr('aria-pressed', String(this.pinned));
		button(acts, { icon: 'x', variant: 'quiet', size: 'sm', tooltip: 'Close', cls: 'ws-peek__close', onClick: () => void this.close() });
	}

	private noteMenu(evt: MouseEvent): void {
		const e = this.entity;
		if (!e) return;
		const m = new Menu();
		for (const n of this.ws.linkedNotes.notes(e)) {
			if (!n.file) continue;
			m.addItem((i) =>
				i
					.setTitle(n.label || n.file!.basename)
					.setIcon(n.main ? 'file-text' : 'file')
					.setChecked(n.path === this.notePath)
					.onClick(() => void this.switchNote(n.path)),
			);
		}
		m.showAtMouseEvent(evt);
	}

	private async switchNote(path: string): Promise<void> {
		if (path === this.notePath) return;
		if (this.embedded) {
			const f = this.ws.app.vault.getAbstractFileByPath(path);
			if (!(f instanceof TFile) || !this.editorView) return;
			this.notePath = path;
			this.renderHead();
			await this.editorView.setFile(f);
			return;
		}
		if (!(await this.flush())) return this.needsChoice();
		this.notePath = path;
		this.known = null;
		this.dirty = false;
		this.renderHead();
		void this.renderNote();
	}

	setPinned(on: boolean): void {
		if (this.pinned === on) return;
		this.pinned = on;
		this.el.toggleClass('is-pinned', on);
		this.pinBtn.toggleClass('is-on', on);
		this.pinBtn.setAttr('aria-pressed', String(on));
		this.pinBtn.setAttr('aria-label', on ? 'Unpin' : 'Pin it open');
		if (on) this.events.onPin(this);
		else this.events.onUnpin(this);
	}

	// ── contents ──────────────────────────────────────────────────────────────

	private noteBox: HTMLElement | null = null;

	private renderBody(): void {
		const b = this.body;
		b.empty();
		const e = this.entity;
		const t = this.target;
		this.el.toggleClass('has-editor', this.embedded);
		if (this.embedded) {
			// Just the note, ready to type in (a pin's own note sits on top when it has one).
			if (t.note) b.createDiv({ cls: 'ws-peek__own ws-peek__own--bar', text: t.note });
			const host = b.createDiv({ cls: 'ws-peek__leaf' });
			// Writing in it keeps the window open.
			host.addEventListener('focusin', () => this.setPinned(true));
			void this.mountEditor(host);
			return;
		}
		if (e) {
			const schema = this.s.schemas.get(e.typeId);
			const desc = plainText(e.description).trim();
			if (desc) b.createDiv({ cls: 'ws-peek__desc', text: desc });
			if (schema) {
				const facts = b.createDiv({ cls: 'ws-peek__facts' });
				let n = 0;
				for (const f of cardFieldsOf(schema, this.ws.fieldTypes)) {
					if (n >= 5) break;
					const text = this.ws.fieldTypes.toText(f, this.s.values.get(e, f));
					if (!text) continue;
					n++;
					const row = facts.createDiv({ cls: 'ws-peek__fact' });
					row.createSpan({ cls: 'ws-peek__fact-label', text: f.label });
					row.createSpan({ cls: 'ws-peek__fact-value', text });
				}
				if (!n) facts.remove();
			}
		}
		if (t.title || t.note) {
			const own = b.createDiv({ cls: 'ws-peek__own' });
			if (t.title && (!e || t.title !== e.name)) own.createDiv({ cls: 'ws-peek__own-title', text: t.title });
			if (t.note) own.createDiv({ cls: 'ws-peek__own-note', text: t.note });
			if (!own.childElementCount) own.remove();
		}
		if (t.entity?.trashedAt) b.createDiv({ cls: 'ws-peek__gone', text: `${t.entity.name} is in the trash.` });
		this.noteBox = b.createDiv({ cls: 'ws-peek__note' });
		void this.renderNote();
	}

	private async mountEditor(host: HTMLElement): Promise<void> {
		const file = this.file;
		// Following a link inside the window opens it there: the title bar follows.
		const ed = new EmbeddedEditor(this.ws.app, { host, popover: true, onFileChange: () => this.syncLeafFile() });
		this.editorView = ed;
		try {
			if (!file) throw new Error('No note');
			await ed.open(file);
			if (this.dead) ed.dispose();
		} catch (err) {
			console.warn('Worldsmith: showing the note without its editor', err);
			ed.dispose();
			if (this.editorView === ed) this.editorView = null;
			if (this.dead) return;
			this.embedded = false;
			this.renderHead();
			this.renderBody();
		}
	}

	private syncLeafFile(): void {
		const f = this.editorView?.file;
		if (this.dead || !f || f.path === this.notePath) return;
		this.notePath = f.path;
		this.el.setAttr('aria-label', f.basename);
		this.renderHead();
	}

	private async renderNote(): Promise<void> {
		const box = this.noteBox;
		if (!box) return;
		const gen = ++this.gen;
		const file = this.file;
		this.scope?.unload();
		this.scope = null;
		this.editor = null;
		box.empty();
		if (!file) {
			box.remove();
			return;
		}
		if (!box.isConnected) this.body.appendChild(box);
		const head = box.createDiv({ cls: 'ws-peek__note-head' });
		icon(head, 'file-text');
		head.createSpan({ cls: 'ws-peek__note-name', text: file.basename });
		this.statusEl = head.createSpan({ cls: 'ws-peek__status' });
		const md = await this.ws.app.vault.read(file);
		if (this.dead || gen !== this.gen || box !== this.noteBox || file.path !== this.notePath) return;
		this.known = md;
		const { body } = splitNote(md);
		if (this.editing) return this.renderEditor(box, file, md);
		const view = box.createDiv({ cls: 'ws-peek__note-body markdown-rendered' });
		if (!body.trim()) {
			view.createDiv({ cls: 'ws-peek__empty', text: 'This note is empty. Use the pencil to write in it.' });
			return;
		}
		const long = body.length > NOTE_CHARS;
		const scope = new Component();
		scope.load();
		this.scope = scope;
		await MarkdownRenderer.render(this.ws.app, long ? `${body.slice(0, NOTE_CHARS)}…` : body, view, file.path, scope);
		if (gen !== this.gen) return;
		if (long) box.createDiv({ cls: 'ws-peek__note-more', text: 'Open the note to read the rest.' });
		// Links inside the note open the way they do in Obsidian.
		view.addEventListener('click', (evt) => {
			const a = (evt.target as HTMLElement).closest('a.internal-link');
			const href = a?.getAttribute('data-href') ?? a?.getAttribute('href');
			if (!href) return;
			evt.preventDefault();
			void this.ws.app.workspace.openLinkText(href, file.path, evt.ctrlKey || evt.metaKey);
		});
	}

	// ── editing ───────────────────────────────────────────────────────────────

	async setEditing(on: boolean): Promise<void> {
		if (on === this.editing) return;
		// Back to reading only once the text is safely in the note.
		if (!on && !(await this.flush())) return this.needsChoice();
		if (this.dead || on === this.editing) return;
		this.editing = on;
		if (on) this.setPinned(true);
		this.el.toggleClass('is-editing', on);
		this.renderHead();
		void this.renderNote();
	}

	private renderEditor(box: HTMLElement, file: TFile, md: string): void {
		const { body } = splitNote(md);
		const ta = box.createEl('textarea', { cls: 'ws-peek__editor', attr: { spellcheck: 'true', 'aria-label': `Edit ${file.basename}` } });
		ta.value = body;
		this.editor = ta;
		ta.addEventListener('input', () => {
			this.dirty = true;
			this.setStatus('Editing…');
			this.win.clearTimeout(this.saveTimer);
			this.saveTimer = this.win.setTimeout(() => void this.flush(), 700);
		});
		ta.addEventListener('blur', () => void this.flush());
		ta.addEventListener('keydown', (evt) => {
			if (evt.key === 'Escape') {
				evt.preventDefault();
				evt.stopPropagation();
				void this.setEditing(false);
				return;
			}
			// Typing here is for the note, not the map or the page; Obsidian's shortcuts
			// (Ctrl/⌘ + a key) still work.
			if (!evt.ctrlKey && !evt.metaKey && !evt.altKey) evt.stopPropagation();
		});
		this.win.setTimeout(() => ta.focus({ preventScroll: true }), 20);
	}

	private setStatus(text: string, warn = false): void {
		this.statusEl?.setText(text);
		this.statusEl?.toggleClass('is-warning', warn);
	}

	/**
	 * Write the editor's text, unless the file was changed somewhere else meanwhile. True when
	 * nothing is left unsaved; false when the person has to choose (changed elsewhere, gone).
	 */
	flush(): Promise<boolean> {
		this.win.clearTimeout(this.saveTimer);
		const run = this.saving.then(() => this.save()).catch((err) => {
			console.error('Worldsmith: could not save the note', err);
			this.setStatus('Could not save', true);
			return false;
		});
		this.saving = run;
		return run;
	}

	private async save(): Promise<boolean> {
		if (!this.dirty) return true;
		if (this.unresolved) return false;
		const ta = this.editor;
		if (!ta || this.known === null) return false;
		const file = this.file;
		if (!file) {
			this.goneWhileEditing();
			return false;
		}
		const now = await this.ws.app.vault.read(file);
		if (now !== this.known) {
			this.conflict(file);
			return false;
		}
		const front = splitNote(now).front;
		// Typing during a write goes in another round, so a save ends with nothing left over.
		for (let round = 0; round < 5; round++) {
			const text = ta.value;
			const next = front + text;
			if (next !== this.known) {
				await this.ws.app.vault.modify(file, next);
				this.known = next;
			}
			if (ta.value === text) {
				this.dirty = false;
				break;
			}
		}
		this.setStatus(this.dirty ? 'Editing…' : 'Saved');
		return !this.dirty;
	}

	/** What's typed in the window now (the editor may have been redrawn since). */
	private mine(): string {
		return this.editor?.value ?? '';
	}

	private choiceBox(text: string): HTMLElement | null {
		const box = this.noteBox;
		if (!box) return null;
		box.querySelector('.ws-peek__conflict')?.remove();
		this.unresolved = true;
		const c = box.createDiv({ cls: 'ws-peek__conflict' });
		c.createDiv({ text });
		return c;
	}

	private resolved(c: HTMLElement): void {
		this.unresolved = false;
		c.remove();
	}

	/** Someone else changed the note: never write over it without asking. */
	private conflict(file: TFile): void {
		this.setStatus('Changed elsewhere', true);
		const c = this.choiceBox(`“${file.basename}” was changed somewhere else while you were writing here.`);
		if (!c) return;
		const row = c.createDiv({ cls: 'ws-peek__conflict-actions' });
		button(row, {
			label: 'Keep my version',
			variant: 'primary',
			size: 'sm',
			onClick: () => {
				this.saving = this.saving.catch(() => false).then(async () => {
					const f = this.file;
					if (!f) {
						this.resolved(c);
						this.goneWhileEditing();
						return false;
					}
					const text = this.mine();
					const now = await this.ws.app.vault.read(f);
					const next = splitNote(now).front + text;
					await this.ws.app.vault.modify(f, next);
					this.known = next;
					if (this.mine() === text) this.dirty = false;
					this.resolved(c);
					this.setStatus(this.dirty ? 'Editing…' : 'Saved');
					return !this.dirty;
				}).catch((err) => {
					console.error('Worldsmith: could not save the note', err);
					this.setStatus('Could not save', true);
					return false;
				});
			},
		});
		button(row, {
			label: 'Use the other version',
			variant: 'ghost',
			size: 'sm',
			onClick: () => {
				void this.copyMine();
				this.dirty = false;
				this.resolved(c);
				void this.renderNote();
			},
		});
		c.createDiv({ cls: 'ws-peek__conflict-hint', text: 'Using the other version copies what you wrote here to the clipboard first.' });
	}

	/** The note was deleted (or can't be found) while there's unsaved text here. */
	private goneWhileEditing(): void {
		if (this.unresolved) return;
		this.setStatus('Note not found', true);
		const c = this.choiceBox('This note was deleted or can’t be found. Your text is still here.');
		if (!c) return;
		const row = c.createDiv({ cls: 'ws-peek__conflict-actions' });
		button(row, {
			label: 'Save as a new note',
			variant: 'primary',
			size: 'sm',
			onClick: () => void (async () => {
				const f = await this.rescue();
				if (!f) return;
				this.resolved(c);
				this.notePath = f.path;
				this.known = null;
				this.renderHead();
				void this.renderNote();
			})(),
		});
		button(row, { label: 'Copy my text', variant: 'ghost', size: 'sm', onClick: () => void this.copyMine() });
	}

	private async copyMine(): Promise<void> {
		await navigator.clipboard?.writeText(this.mine()).catch(() => {});
	}

	/** Keep the text typed here as a new note next to where the old one was (never over one). */
	private async rescue(): Promise<TFile | null> {
		const vault = this.ws.app.vault;
		const path = this.notePath ?? 'Untitled.md';
		const slash = path.lastIndexOf('/');
		const folder = slash > 0 ? path.slice(0, slash) : '';
		const base = path.slice(slash + 1).replace(/\.md$/i, '');
		const front = this.known ? splitNote(this.known).front : '';
		// Beside the old note, or at the top of the vault if its folder went too.
		for (const dir of folder ? [folder, ''] : ['']) {
			let fails = 0;
			for (let i = 1; i < 200 && fails < 3; i++) {
				const name = `${base} (unsaved edits${i > 1 ? ` ${i}` : ''}).md`;
				const p = dir ? `${dir}/${name}` : name;
				if (vault.getAbstractFileByPath(p)) continue;
				try {
					const f = await vault.create(p, front + this.mine());
					new Notice(`Your unsaved text was kept in “${name}”.`);
					this.dirty = false;
					return f;
				} catch (err) {
					// Taken under another spelling, or the folder is gone: try the next name.
					console.warn('Worldsmith: could not keep the unsaved text in', p, err);
					fails++;
				}
			}
		}
		void this.copyMine();
		new Notice('Couldn’t save your text as a note, so it was copied to the clipboard.');
		return null;
	}

	/** The window stays until the person chooses what happens to their text. */
	private needsChoice(): void {
		this.setPinned(true);
		this.events.onFront(this);
		this.el.addClass('is-flash');
		this.win.setTimeout(() => this.el.removeClass('is-flash'), 500);
	}

	private async openNote(): Promise<void> {
		if (!(await this.flush())) return this.needsChoice();
		if (this.notePath) await this.ws.linkedNotes.openPath(this.notePath, 'tab');
	}

	// ── moving and sizing ─────────────────────────────────────────────────────

	place(anchor: HTMLElement): void {
		const r = anchor.getBoundingClientRect();
		const vw = this.win.innerWidth;
		const vh = this.win.innerHeight;
		const w = Math.min(this.el.offsetWidth || 460, vw - 16);
		const h = Math.min(this.el.offsetHeight || 400, vh - 16);
		let x = r.right + 12;
		if (x + w > vw - 8) x = r.left - w - 12;
		x = Math.max(8, Math.min(x, vw - w - 8));
		let y = r.top + r.height / 2 - h / 2;
		y = Math.max(8, Math.min(y, vh - h - 8));
		this.moveTo(x, y);
	}

	/** Put the window's top-left corner at (x, y) on screen. */
	private moveTo(x: number, y: number): void {
		// "Fixed" can be measured from the Worldsmith pane rather than the screen (Obsidian's
		// panes contain their layout), which made the window jump when grabbed: a still marker
		// at (0, 0) says where that origin really is.
		const probe = this.root.createDiv({ cls: 'ws-peek-origin' });
		const o = probe.getBoundingClientRect();
		probe.remove();
		this.el.style.left = `${Math.round(x - o.left)}px`;
		this.el.style.top = `${Math.round(y - o.top)}px`;
	}

	private bindDrag(): void {
		this.head.addEventListener('pointerdown', (evt) => {
			if (evt.button !== 0 || (evt.target as HTMLElement).closest('button')) return;
			evt.preventDefault();
			const r = this.el.getBoundingClientRect();
			const dx = evt.clientX - r.left;
			const dy = evt.clientY - r.top;
			let moved = false;
			const move = (ev: PointerEvent) => {
				const vw = this.win.innerWidth;
				const vh = this.win.innerHeight;
				// Keep the top bar reachable.
				const x = Math.max(-r.width + 80, Math.min(ev.clientX - dx, vw - 80));
				const y = Math.max(0, Math.min(ev.clientY - dy, vh - 40));
				if (!moved && Math.hypot(ev.clientX - evt.clientX, ev.clientY - evt.clientY) > 3) {
					moved = true;
					this.el.addClass('is-moving');
					this.setPinned(true);
				}
				if (moved) this.moveTo(x, y);
			};
			const up = () => {
				this.win.removeEventListener('pointermove', move);
				this.win.removeEventListener('pointerup', up);
				this.el.removeClass('is-moving');
			};
			this.win.addEventListener('pointermove', move);
			this.win.addEventListener('pointerup', up);
		});
	}

	private bindResize(): void {
		const grip = this.el.createDiv({ cls: 'ws-peek__grip', attr: { 'aria-hidden': 'true' } });
		icon(grip, 'grip');
		this.resizeFrom(grip, 'se');
		// Every edge and corner can be dragged too.
		for (const edge of EDGES) this.resizeFrom(this.el.createDiv({ cls: `ws-peek__edge ws-peek__edge--${edge}`, attr: { 'aria-hidden': 'true' } }), edge);
	}

	private resizeFrom(handle: HTMLElement, edge: Edge): void {
		handle.addEventListener('pointerdown', (evt) => {
			if (evt.button !== 0) return;
			evt.preventDefault();
			evt.stopPropagation();
			this.events.onFront(this);
			const r = this.el.getBoundingClientRect();
			const sx = evt.clientX;
			const sy = evt.clientY;
			const move = (ev: PointerEvent) => {
				const vw = this.win.innerWidth;
				const vh = this.win.innerHeight;
				const ddx = ev.clientX - sx;
				const ddy = ev.clientY - sy;
				let { left, top, width: w, height: h } = r;
				const maxW = vw - 16;
				const maxH = vh - 16;
				if (edge.includes('e')) w = Math.min(r.width + ddx, vw - r.left - 4);
				if (edge.includes('s')) h = Math.min(r.height + ddy, vh - r.top - 4);
				if (edge.includes('w')) {
					w = Math.min(r.width - ddx, r.right - 4);
					w = Math.max(MIN_W, w);
					left = r.right - w;
				}
				if (edge.includes('n')) {
					h = Math.min(r.height - ddy, r.bottom);
					h = Math.max(MIN_H, h);
					top = r.bottom - h;
				}
				w = Math.max(MIN_W, Math.min(w, maxW));
				h = Math.max(MIN_H, Math.min(h, maxH));
				if (edge.includes('w')) left = r.right - w;
				if (edge.includes('n')) top = r.bottom - h;
				this.el.style.width = `${Math.round(w)}px`;
				this.el.style.height = `${Math.round(h)}px`;
				if (edge.includes('w') || edge.includes('n')) this.moveTo(left, top);
				lastSize = { w: Math.round(w), h: Math.round(h) };
				this.setPinned(true);
			};
			const up = () => {
				this.win.removeEventListener('pointermove', move);
				this.win.removeEventListener('pointerup', up);
				this.el.removeClass('is-resizing');
			};
			this.el.addClass('is-resizing');
			this.win.addEventListener('pointermove', move);
			this.win.addEventListener('pointerup', up);
		});
	}

	/**
	 * Save and close. With text that can't be saved yet, the window stays open for the person
	 * to choose; `force` (the page is going away) keeps that text as a new note instead.
	 */
	async close(force = false): Promise<void> {
		if (this.dead) return;
		try {
			const ok = await this.flush();
			if (!ok && this.dirty) {
				if (!force) return this.needsChoice();
				await this.rescue();
			}
		} finally {
			if (force || !this.dirty) {
				this.dispose();
				this.events.onClose(this);
			}
		}
	}

	private dispose(): void {
		if (this.dead) return;
		this.dead = true;
		this.win.clearTimeout(this.saveTimer);
		this.scope?.unload();
		for (const ref of this.vaultRefs) this.ws.app.vault.offref(ref);
		// Obsidian saves the note as its editor closes.
		this.editorView?.dispose();
		this.editorView = null;
		this.el.remove();
	}
}

export function hoverPeek(host: HTMLElement, ws: WorldsmithContext, s: WorldSession, selector: string, resolve: (el: HTMLElement) => PeekTarget | null): Peek {
	const doc = host.ownerDocument;
	let hovered: HTMLElement | null = null;
	/** The window that follows the pointer (not pinned). */
	let preview: { win: PeekWindow; for: HTMLElement | null } | null = null;
	const pinned = new Set<PeekWindow>();
	let timer = 0;
	let z = 40;
	// The windows float over everything, outside the pane (which would cut them off at its edge).
	let layer: HTMLElement | null = null;
	const root = () => {
		if (!layer?.isConnected) layer = doc.body.createDiv({ cls: 'worldsmith ws-peek-layer' });
		return layer;
	};

	const front = (w: PeekWindow) => (w.el.style.zIndex = String(++z));
	const hidePreview = () => {
		window.clearTimeout(timer);
		const p = preview;
		preview = null;
		if (p && !p.win.pinned) void p.win.close();
	};
	const hideSoon = () => {
		window.clearTimeout(timer);
		timer = window.setTimeout(hidePreview, 220);
	};

	const show = (el: HTMLElement) => {
		if (preview?.for === el) return;
		if (!el.isConnected) return;
		const t = resolve(el);
		if (!t || (!t.entity && !t.note && !t.title)) return;
		// Already pinned open: bring that one forward instead of a second copy.
		const open = t.entity && [...pinned].find((w) => w.target.entity?.id === t.entity!.id);
		if (open) {
			front(open);
			open.el.addClass('is-flash');
			window.setTimeout(() => open.el.removeClass('is-flash'), 500);
			return;
		}
		hidePreview();
		const win = new PeekWindow(root(), ws, s, t, {
			onPin: (w) => {
				pinned.add(w);
				if (preview?.win === w) preview = null;
			},
			// Unpinned: it's the preview again (closing the one there was), and goes when left.
			onUnpin: (w) => {
				pinned.delete(w);
				if (preview?.win === w) return;
				hidePreview();
				preview = { win: w, for: null };
			},
			onClose: (w) => {
				pinned.delete(w);
				if (preview?.win === w) preview = null;
			},
			onFront: front,
		});
		front(win);
		win.el.addEventListener('pointerenter', () => window.clearTimeout(timer));
		win.el.addEventListener('pointerleave', () => !win.pinned && hideSoon());
		preview = { win, for: el };
		win.place(el);
	};

	const over = (evt: PointerEvent) => {
		const el = (evt.target as HTMLElement).closest?.<HTMLElement>(selector);
		if (!el || !host.contains(el)) return;
		hovered = el;
		if (preview?.for === el) window.clearTimeout(timer);
		else if (evt.ctrlKey || evt.metaKey) show(el);
	};
	const out = (evt: PointerEvent) => {
		if (!hovered) return;
		const to = evt.relatedTarget as Node | null;
		if (to && hovered.contains(to)) return;
		hovered = null;
		if (preview && !(to && preview.win.el.contains(to))) hideSoon();
	};
	const key = (evt: KeyboardEvent) => {
		// Ctrl pressed while typing somewhere (a note window, a search box) isn't a peek.
		const typing = (evt.target as HTMLElement | null)?.closest?.('input, textarea, select, [contenteditable="true"]');
		if ((evt.key === 'Control' || evt.key === 'Meta') && !typing && hovered?.isConnected && host.isConnected) show(hovered);
		else if (evt.key === 'Escape' && preview && !preview.win.el.contains(evt.target as Node)) hidePreview();
	};
	const down = (evt: PointerEvent) => {
		if (preview && !preview.win.el.contains(evt.target as Node)) hidePreview();
	};
	host.addEventListener('pointerover', over);
	host.addEventListener('pointerout', out);
	host.addEventListener('pointerdown', down, true);
	host.addEventListener('wheel', hidePreview, { passive: true });
	doc.addEventListener('keydown', key);
	return {
		hide: hidePreview,
		destroy() {
			window.clearTimeout(timer);
			if (preview) void preview.win.close(true);
			preview = null;
			// Pinned windows go with the page; anything typed is saved first.
			for (const w of [...pinned]) void w.close(true);
			pinned.clear();
			hovered = null;
			// Windows still saving remove themselves; the empty layer goes once they have.
			window.setTimeout(() => {
				if (layer && !layer.childElementCount) layer.remove();
			}, 1500);
			host.removeEventListener('pointerover', over);
			host.removeEventListener('pointerout', out);
			host.removeEventListener('pointerdown', down, true);
			host.removeEventListener('wheel', hidePreview);
			doc.removeEventListener('keydown', key);
		},
	};
}
