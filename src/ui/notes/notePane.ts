import { Component, MarkdownRenderer, TFile, type App } from 'obsidian';
import type { WorldsmithContext } from '../../app/context';
import type { EntityRecord } from '../../core/types';
import { button, emptyState } from '../components/dom';
import { confirmModal, NotePickerModal } from '../components/modals';
import { actionNotice } from '../components/notice';
import { EmbeddedEditor } from '../editor/EmbeddedEditor';

/**
 * A note shown inside a Worldsmith page (0.18): the entry page's Note tab and the editable
 * Embedded note widget. It is Obsidian's own editor (EmbeddedEditor), so typing, undo,
 * Live Preview, hotkeys and saving are Obsidian's, and Worldsmith keeps no copy of the
 * text. Without the editor (a future Obsidian) it shows the rendered note with "Open in a
 * tab", never a substitute editor. A note that is gone gets a card to find it again.
 */
export interface NotePaneOptions {
	/** The entry whose note this is (for Find it again, Choose, Unlink); null for a chosen note. */
	entityId: string | null;
	/** Fixed height in px, or 'fill' to follow the host's CSS height. */
	height: number | 'fill';
	/** Show the read-only rendering even when the editor is possible (Customize mode). */
	readOnly?: boolean;
}

async function openInTab(app: App, path: string): Promise<void> {
	const f = app.vault.getFileByPath(path);
	if (f) await app.workspace.getLeaf('tab').openFile(f);
}

export class NotePane extends Component {
	private readonly el: HTMLElement;
	private ed: EmbeddedEditor | null = null;
	private path: string | null = null;
	private gen = 0;
	private dead = false;
	private readScope: Component | null = null;

	constructor(
		private readonly ws: WorldsmithContext,
		host: HTMLElement,
		private readonly o: NotePaneOptions,
	) {
		super();
		this.el = host.createDiv({ cls: 'ws-note-pane' });
		if (o.height !== 'fill') this.el.style.setProperty('--ws-note-pane-h', `${o.height}px`);
		else this.el.addClass('is-fill');
	}

	private get entity(): EntityRecord | null {
		return this.o.entityId ? (this.ws.worlds.session?.entities.get(this.o.entityId) ?? null) : null;
	}

	/** Show this note (same path again: nothing happens, so typing is never interrupted). */
	async show(path: string | null): Promise<void> {
		if (this.dead) return;
		const file = path ? this.ws.app.vault.getFileByPath(path) : null;
		if (path === this.path) {
			// Already showing it: the editor on this file, the missing card while it's still gone,
			// or the read-only rendering of it.
			if (this.ed && this.ed.file === file) return;
			if (!this.ed && !file && this.el.hasClass('is-missing')) return;
			if (!this.ed && file && this.el.hasClass('is-rendered')) return;
		}
		const gen = ++this.gen;
		this.path = path;
		if (!path) return this.clear();
		if (!file) return this.missing(path);
		if (file.extension !== 'md') {
			this.clear();
			emptyState(this.el, { icon: 'file-x', title: 'Not a note', body: `${file.name} isn’t a Markdown note.`, compact: true });
			return;
		}
		if (this.o.readOnly || !EmbeddedEditor.canEmbed(this.ws.app)) return this.rendered(file, gen);
		try {
			if (this.ed) {
				this.el.removeClass('is-missing');
				await this.ed.setFile(file);
			} else {
				this.clear();
				const host = this.el.createDiv({ cls: 'ws-note-pane__editor' });
				const ed = new EmbeddedEditor(this.ws.app, {
					host,
					mode: 'edit',
					livePreview: true,
					activateOnFocus: true,
					// A link followed inside opens in a tab, never over the entry's note.
					onNavigate: (p) => void openInTab(this.ws.app, p),
					onCloseRequest: () => ed.closeHome(),
					onLost: () => {
						if (this.ed !== ed) return;
						this.ed = null;
						const p = this.path;
						this.path = null;
						void this.show(p);
					},
				});
				this.ed = ed;
				await ed.open(file);
			}
		} catch (err) {
			if (this.dead || gen !== this.gen) return;
			console.warn('[Worldsmith] the note opens read-only here instead', err);
			this.ed?.dispose();
			this.ed = null;
			return this.rendered(file, gen);
		}
	}

	private clear(): void {
		this.ed?.dispose();
		this.ed = null;
		if (this.readScope) {
			this.removeChild(this.readScope);
			this.readScope = null;
		}
		this.el.empty();
		this.el.removeClass('is-missing', 'is-rendered');
	}

	/** The note rendered, read-only, with Open in a tab (the fallback, and Customize mode). */
	private async rendered(file: TFile, gen: number): Promise<void> {
		this.clear();
		this.el.addClass('is-rendered');
		const bar = this.el.createDiv({ cls: 'ws-note-pane__bar' });
		bar.createSpan({ cls: 'ws-note-pane__hint', text: this.o.readOnly ? 'Shown read-only while customizing.' : 'This Obsidian can’t show its editor here.' });
		button(bar, { label: 'Open in a tab', icon: 'external-link', variant: 'ghost', size: 'sm', onClick: () => void openInTab(this.ws.app, file.path) });
		const body = this.el.createDiv({ cls: 'ws-note-pane__read markdown-rendered' });
		let md = '';
		try {
			md = (await this.ws.app.vault.cachedRead(file)).replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');
		} catch {
			md = '';
		}
		if (this.dead || gen !== this.gen) return;
		this.readScope = new Component();
		this.addChild(this.readScope);
		await MarkdownRenderer.render(this.ws.app, md, body, file.path, this.readScope);
	}

	/** The note is gone: keep the link, offer to find it again, choose another, or unlink. */
	private missing(path: string): void {
		this.clear();
		this.el.addClass('is-missing');
		const name = (path.split('/').pop() ?? path).replace(/\.md$/i, '');
		const card = emptyState(this.el, {
			icon: 'file-question',
			title: `“${name}” is missing`,
			body: `It was at ${path}. It may have been deleted or moved while Obsidian was closed. If it comes back, it reconnects by itself.`,
			compact: true,
		});
		const e = this.entity;
		if (!e) return;
		const found = this.ws.linkedNotes.findAgain(e, path);
		if (found.length) {
			const list = card.createDiv({ cls: 'ws-note-pane__found' });
			list.createDiv({ cls: 'ws-note-pane__found-head', text: found.length === 1 ? 'This looks like it:' : 'These look like it:' });
			for (const f of found) {
				button(list, {
					label: f.path,
					icon: 'file-text',
					variant: 'ghost',
					size: 'sm',
					cls: 'ws-note-pane__candidate',
					onClick: () => {
						const cur = this.entity;
						if (cur) this.ws.linkedNotes.relink(cur, path, f);
					},
				});
			}
		}
		const row = card.createDiv({ cls: 'ws-note-pane__actions' });
		button(row, {
			label: 'Choose a note…',
			icon: 'search',
			variant: 'ghost',
			size: 'sm',
			onClick: () =>
				new NotePickerModal(this.ws.app, (f) => {
					const cur = this.entity;
					if (cur) this.ws.linkedNotes.relink(cur, path, f);
				}).open(),
		});
		button(row, {
			label: 'Unlink',
			icon: 'unlink',
			variant: 'quiet',
			size: 'sm',
			onClick: () => void (async () => {
				const cur = this.entity;
				if (!cur) return;
				const ok = await confirmModal(this.ws.app, { title: 'Unlink the missing note?', body: `“${cur.name}” will no longer point to ${path}. Nothing else changes.`, confirmLabel: 'Unlink' });
				if (!ok) return;
				const before = this.ws.linkedNotes.unlink(cur, path);
				if (before) actionNotice('Note unlinked.', { label: 'Undo', run: () => this.ws.worlds.session?.entityService.update(cur.id, before) });
			})(),
		});
	}

	override onload(): void {
		// While the note is missing, a note appearing or moving elsewhere may be it: look again.
		let t: number | null = null;
		const relook = () => {
			if (!this.el.hasClass('is-missing') || !this.path) return;
			if (t !== null) window.clearTimeout(t);
			t = window.setTimeout(() => {
				t = null;
				if (this.dead || !this.path || !this.el.hasClass('is-missing')) return;
				if (this.ws.app.vault.getFileByPath(this.path)) void this.show(this.path);
				else this.missing(this.path);
			}, 250);
		};
		this.registerEvent(this.ws.app.vault.on('create', relook));
		this.registerEvent(this.ws.app.vault.on('rename', relook));
		this.register(() => {
			if (t !== null) window.clearTimeout(t);
		});
	}

	override onunload(): void {
		this.dead = true;
		this.ed?.dispose();
		this.ed = null;
	}
}
