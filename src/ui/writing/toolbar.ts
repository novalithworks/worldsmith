import { FuzzySuggestModal, Menu, Notice, TFile, type App, type Editor } from 'obsidian';
import { WorldsmithModal } from '../components/modals';
import type { WorldSession } from '../../services/WorldSession';
import { button, cx } from '../components/dom';
import { headingOf, insertSceneBreak, setHeading, toggleLines, toggleMark } from '../editor/format';
import type { WorldsmithContext } from '../../app/context';

/*
 * The writing toolbar (WS3): a pill above the page. Formatting goes through Obsidian's
 * Editor API, so it lands in the editor's own undo history and is saved like typing. The
 * buttons never take the focus away from the text.
 */

export interface ToolbarHost {
	/** The editor the buttons act on (the page last written in), or null. */
	editor(): Editor | null;
	/** After a button: give the editor its focus and Obsidian's active state back. */
	refocus(): void;
	/** The note the editor shows (links are made relative to it). */
	sourcePath(): string;
	focusMode(): boolean;
	toggleFocus(): void;
	toggleTypewriter(): void;
	typewriter(): boolean;
	layoutMenu(e: MouseEvent, anchor: HTMLElement): void;
}

export function renderToolbar(parent: HTMLElement, ws: WorldsmithContext, s: WorldSession, host: ToolbarHost): HTMLElement {
	const bar = parent.createDiv({ cls: 'ws-wr-toolbar', attr: { role: 'toolbar', 'aria-label': 'Writing tools' } });
	// Pressing a button keeps the cursor (and the selection) in the text.
	bar.addEventListener('mousedown', (e) => {
		if ((e.target as HTMLElement).closest('button')) e.preventDefault();
	});
	// The press made the studio pane active; the text that kept the cursor gets it back.
	bar.addEventListener('click', () => window.setTimeout(() => host.refocus(), 0));
	const act = (fn: (ed: Editor) => void) => () => {
		const ed = host.editor();
		if (!ed) return;
		ed.focus();
		fn(ed);
		host.refocus();
	};
	const group = () => bar.createDiv({ cls: 'ws-wr-toolbar__group' });
	const g1 = group();
	button(g1, {
		icon: 'heading',
		variant: 'quiet',
		size: 'sm',
		tooltip: 'Heading',
		cls: 'ws-wr-tool ws-wr-tool--heading',
		onClick: (e) => {
			const ed = host.editor();
			if (!ed) return;
			const cur = headingOf(ed.getLine(ed.getCursor('from').line));
			const m = new Menu();
			for (const [lvl, label] of [
				[0, 'Normal text'],
				[1, 'Heading 1'],
				[2, 'Heading 2'],
				[3, 'Heading 3'],
			] as const) {
				m.addItem((i) =>
					i
						.setTitle(label)
						.setChecked(cur === lvl)
						.onClick(() => act((x) => setHeading(x, lvl))()),
				);
			}
			const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
			m.showAtPosition({ x: r.left, y: r.bottom + 4 });
		},
	});
	button(g1, { icon: 'bold', variant: 'quiet', size: 'sm', tooltip: 'Bold', cls: 'ws-wr-tool ws-wr-tool--bold', onClick: act((ed) => toggleMark(ed, '**')) });
	button(g1, { icon: 'italic', variant: 'quiet', size: 'sm', tooltip: 'Italic', cls: 'ws-wr-tool ws-wr-tool--italic', onClick: act((ed) => toggleMark(ed, '*')) });
	const g2 = group();
	button(g2, { icon: 'list', variant: 'quiet', size: 'sm', tooltip: 'List', cls: 'ws-wr-tool ws-wr-tool--list', onClick: act((ed) => toggleLines(ed, 'bullet')) });
	button(g2, { icon: 'quote', variant: 'quiet', size: 'sm', tooltip: 'Quote', cls: 'ws-wr-tool ws-wr-tool--quote', onClick: act((ed) => toggleLines(ed, 'quote')) });
	button(g2, {
		icon: 'link',
		variant: 'quiet',
		size: 'sm',
		tooltip: 'Link to a note or an entry',
		cls: 'ws-wr-tool ws-wr-tool--link',
		onClick: () => {
			const ed = host.editor();
			if (!ed) return;
			insertLinkAt(ws, s, ed, host.sourcePath(), () => host.refocus());
		},
	});
	const g3 = group();
	button(g3, { icon: 'asterisk', variant: 'quiet', size: 'sm', tooltip: 'Scene break', cls: 'ws-wr-tool ws-wr-tool--break', onClick: act((ed) => insertSceneBreak(ed)) });
	const g4 = group();
	const focus = button(g4, { icon: host.focusMode() ? 'minimize-2' : 'maximize-2', variant: 'quiet', size: 'sm', tooltip: host.focusMode() ? 'Leave focus mode (Esc)' : 'Focus mode', cls: cx('ws-wr-tool ws-wr-tool--focus', host.focusMode() && 'is-on').join(' '), onClick: () => host.toggleFocus() });
	focus.setAttr('aria-pressed', String(host.focusMode()));
	const tw = button(g4, { icon: 'type', variant: 'quiet', size: 'sm', tooltip: 'Typewriter mode: keep the line you’re writing in the middle', cls: cx('ws-wr-tool ws-wr-tool--typewriter', host.typewriter() && 'is-on').join(' '), onClick: () => host.toggleTypewriter() });
	tw.setAttr('aria-pressed', String(host.typewriter()));
	const lay = button(g4, { icon: 'columns-2', variant: 'quiet', size: 'sm', tooltip: 'Layout', cls: 'ws-wr-tool ws-wr-tool--layout', onClick: (e) => host.layoutMenu(e, lay) });
	lay.setAttr('aria-haspopup', 'menu');
	return bar;
}

interface LinkTarget {
	/** The note to link to; null for an entry without a note yet (WS5). */
	file: TFile | null;
	/** An entry's name (its note may be called something else). */
	label: string;
	entry: boolean;
	entityId?: string;
}

/**
 * Pick a note or an entry and put a link to it at the cursor (or around the selection, which
 * becomes the link's text). An entry without a note (WS5): create its native note and link it,
 * or just write its name. Used by the studio toolbar and the "Insert link to a world entry"
 * command in any note.
 */
export function insertLinkAt(ws: WorldsmithContext, s: WorldSession, ed: Editor, sourcePath: string, after: () => void = () => {}): void {
	const from = ed.getCursor('from');
	const to = ed.getCursor('to');
	const selected = ed.getSelection();
	const put = (text: string) => {
		ed.focus();
		ed.replaceRange(text, from, to);
		ed.setCursor({ line: from.line, ch: from.ch + text.length });
		after();
	};
	const link = (file: TFile, label: string) => {
		const alias = selected.trim() || (label && label !== file.basename ? label : undefined);
		put(ws.app.fileManager.generateMarkdownLink(file, sourcePath, undefined, alias));
	};
	new LinkPicker(ws, s, (t) => {
		if (t.file) return link(t.file, t.label);
		const e = t.entityId ? s.entities.get(t.entityId) : undefined;
		if (!e) return;
		new NoNoteModal(ws, e.name, () => void (async () => {
			try {
				const f = await ws.nativeNotes.create(e);
				if (f) link(f, e.name);
			} catch (err) {
				new Notice(`The note couldn’t be created: ${err instanceof Error ? err.message : String(err)}`);
			}
		})(), () => put(selected.trim() || e.name)).open();
	}).open();
}

/** “Ava” has no note yet: make one and link it, or just write the name. */
class NoNoteModal extends WorldsmithModal {
	constructor(
		ws: WorldsmithContext,
		private readonly name: string,
		private readonly onCreate: () => void,
		private readonly onName: () => void,
	) {
		super(ws.app);
		this.modalEl.addClass('ws-wr-nonote');
	}
	override onOpen(): void {
		this.setTitle(`“${this.name}” has no note yet`);
		const c = this.contentEl.createDiv({ cls: 'ws-confirm' });
		c.createEl('p', { cls: 'ws-confirm__body', text: 'A link needs a note to point to. Worldsmith can make the entry its native note (an ordinary note that stays in step with the entry), or just write the name here.' });
		const row = c.createDiv({ cls: 'ws-modal-actions' });
		button(row, { label: 'Just the name', variant: 'ghost', cls: 'ws-wr-nonote__name', onClick: () => (this.close(), this.onName()) });
		button(row, { label: 'Create its note and link it', icon: 'file-plus-2', variant: 'primary', cls: 'ws-wr-nonote__create', onClick: () => (this.close(), this.onCreate()) });
	}
}

/** Pick a note, or a Worldsmith entry (its linked note), to link to. */
class LinkPicker extends FuzzySuggestModal<LinkTarget> {
	constructor(
		private readonly ws: WorldsmithContext,
		private readonly s: WorldSession,
		private readonly onPick: (t: LinkTarget) => void,
	) {
		super(ws.app);
		this.modalEl.addClass('worldsmith-modal');
		this.setPlaceholder('Link to a note or an entry…');
	}
	private items: LinkTarget[] | null = null;
	getItems(): LinkTarget[] {
		this.items ??= this.collect();
		return this.items;
	}
	private collect(): LinkTarget[] {
		const out: LinkTarget[] = [];
		const seen = new Set<string>();
		for (const e of this.s.entities.values()) {
			if (e.trashedAt) continue;
			const f = this.ws.linkedNotes.notes(e).find((n) => n.main && n.file)?.file;
			if (!(f instanceof TFile)) {
				// WS5: entries without a note are offered too.
				out.push({ file: null, label: e.name, entry: true, entityId: e.id });
				continue;
			}
			out.push({ file: f, label: e.name, entry: true, entityId: e.id });
			seen.add(f.path);
		}
		const notes = this.app.vault
			.getMarkdownFiles()
			.filter((f) => !seen.has(f.path))
			.sort((a, b) => b.stat.mtime - a.stat.mtime);
		for (const f of notes) out.push({ file: f, label: f.basename, entry: false });
		return out;
	}
	getItemText(t: LinkTarget): string {
		return t.entry ? `${t.label} — ${t.file ? t.file.path : 'no note yet'}` : t.file!.path;
	}
	onChooseItem(t: LinkTarget): void {
		this.onPick(t);
	}
}
