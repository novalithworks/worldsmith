import { Notice, Platform } from 'obsidian';
import { uuid } from '../../core/util/ids';
import { buildDocument, cleanStyle, DEFAULT_COMPILE, documentWords, type BookStyle, toDocx, toEpub, toHtml, toMarkdown, toText, type ChapterStyle, type CompileOptions } from '../../services/writing/compile';
import { button, cx, icon } from '../components/dom';
import { WorldsmithModal } from '../components/modals';
import { actionNotice } from '../components/notice';
import { toPdf } from '../../services/writing/pdf';
import { renderHtmlPdf } from './pdfRender';
import { dateStamp, exportsFolder } from '../transfer/files';
import type { Studio } from './kit';

/**
 * WS7 (0.26): Compile. The book's scenes in reading order become one file: Markdown, plain
 * text, Word, EPUB or a print-ready web page, saved in the exports folder (a new file each
 * time). PDF is a file too (0.29.3): no print dialog.
 * Choices are remembered per project.
 */

export type Target = 'md' | 'txt' | 'docx' | 'epub' | 'html' | 'print';

export const TARGETS: Array<{ id: Target; label: string; icon: string; hint: string }> = [
	{ id: 'docx', label: 'Word', icon: 'file-text', hint: 'A .docx for editors, agents and print layout.' },
	{ id: 'epub', label: 'EPUB', icon: 'book-open', hint: 'An e-book for readers and e-ink devices.' },
	{ id: 'print', label: 'PDF', icon: 'file-text', hint: 'A PDF file in your vault, ready to read or share; it opens in Obsidian.' },
	{ id: 'md', label: 'Markdown', icon: 'hash', hint: 'One clean Markdown note.' },
	{ id: 'txt', label: 'Plain text', icon: 'type', hint: 'A .txt with no formatting.' },
	{ id: 'html', label: 'Web page', icon: 'globe', hint: 'A formatted .html to read or print in a browser.' },
];

export const STYLES: Array<[ChapterStyle, string]> = [
	['number-title', 'Chapter One: Title'],
	['number', 'Chapter One'],
	['title', 'Title only'],
	['none', 'No heading (a page break)'],
];

export const SEPS: Array<[string, string]> = [
	['* * *', '* * *'],
	['#', '#'],
	['⁂', '⁂'],
	['', 'A blank line'],
];

function freeName(st: Studio, folder: string, base: string, ext: string): string {
	const vault = st.ws.app.vault;
	const clean = base.replace(/[\\/:*?"<>|#^[\]]/g, '-').trim() || 'Manuscript';
	for (let n = 1; n < 1000; n++) {
		const p = `${folder ? `${folder}/` : ''}${clean}${n > 1 ? ` ${n}` : ''}.${ext}`;
		if (!vault.getAbstractFileByPath(p)) return p;
	}
	throw new Error('Couldn’t find a free name for the file.');
}

async function ensureFolder(st: Studio, folder: string): Promise<void> {
	const vault = st.ws.app.vault;
	const parts = folder.split('/').filter(Boolean);
	for (let n = 1; n <= parts.length; n++) {
		const p = parts.slice(0, n).join('/');
		if (!vault.getAbstractFileByPath(p)) await vault.createFolder(p).catch(() => undefined);
	}
}


export class CompileModal extends WorldsmithModal {
	private o: CompileOptions;
	private target: Target;

	constructor(private readonly st: Studio) {
		super(st.ws.app);
		this.modalEl.addClass('ws-arch-modal', 'ws-wr-compile-modal');
		const p = st.project!;
		const saved = p.compile ?? {};
		this.o = {
			...DEFAULT_COMPILE,
			title: p.name,
			author: p.author ?? '',
			titlePage: saved.titlePage !== false,
			chapterStyle: (STYLES.some(([k]) => k === saved.chapterStyle) ? saved.chapterStyle : DEFAULT_COMPILE.chapterStyle) as ChapterStyle,
			sceneTitles: saved.sceneTitles === true,
			separator: typeof saved.separator === 'string' ? saved.separator : DEFAULT_COMPILE.separator,
			language: typeof saved.language === 'string' && saved.language ? saved.language : DEFAULT_COMPILE.language,
		};
		const t = saved.target as Target | undefined;
		this.target = t && TARGETS.some((x) => x.id === t) && !(t === 'print' && Platform.isMobile) ? t : 'docx';
	}

	override onOpen(): void {
		this.setTitle(`Compile “${this.st.project!.name}”`);
		this.paint();
	}

	private paint(): void {
		const st = this.st;
		const p = st.project!;
		const c = this.contentEl;
		c.empty();
		const wrap = c.createDiv({ cls: 'ws-arch ws-wr-compile' });
		const scenes = st.w.scenes(p.id).filter((s) => !s.trashedAt);
		wrap.createEl('p', { cls: 'ws-arch__lead', text: `All ${scenes.length} scenes in reading order become one file. Your notes aren’t changed.` });

		const grid = wrap.createDiv({ cls: 'ws-wr-compile__targets', attr: { role: 'radiogroup', 'aria-label': 'Format' } });
		for (const t of TARGETS) {
			if (t.id === 'print' && Platform.isMobile) continue;
			const on = t.id === this.target;
			const b = grid.createEl('button', { cls: cx('ws-wr-compile__target', on && 'is-active'), attr: { type: 'button', role: 'radio', 'aria-checked': String(on), 'data-target': t.id } });
			icon(b, t.icon, 'ws-wr-compile__ticon');
			const tx = b.createSpan({ cls: 'ws-wr-compile__ttext' });
			tx.createSpan({ cls: 'ws-wr-compile__tlabel', text: t.label });
			tx.createSpan({ cls: 'ws-wr-compile__thint', text: t.hint });
			b.tabIndex = on ? 0 : -1;
			b.addEventListener('click', () => {
				this.target = t.id;
				this.paint();
			});
		}
		// A radio group: one stop for Tab; the arrow keys move the choice (WS8).
		grid.addEventListener('keydown', (e) => {
			const keys: Record<string, number> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
			const d = keys[e.key];
			if (!d) return;
			e.preventDefault();
			const list = [...grid.querySelectorAll<HTMLElement>('.ws-wr-compile__target')];
			const i = list.findIndex((x) => x.dataset.target === this.target);
			const next = list[(i + d + list.length) % list.length];
			if (!next) return;
			this.target = next.dataset.target as Target;
			this.paint();
			this.contentEl.querySelector<HTMLElement>(`.ws-wr-compile__target[data-target="${this.target}"]`)?.focus();
		});

		const form = wrap.createDiv({ cls: 'ws-wr-compile__form' });
		const row = (label: string) => {
			const r = form.createEl('label', { cls: 'ws-wr-compile__row' });
			r.createSpan({ cls: 'ws-wr-compile__label', text: label });
			return r;
		};
		const titleIn = row('Title').createEl('input', { cls: 'ws-input', attr: { type: 'text', 'data-opt': 'title' } });
		titleIn.value = this.o.title;
		titleIn.addEventListener('input', () => (this.o.title = titleIn.value));
		const authorIn = row('Author').createEl('input', { cls: 'ws-input', attr: { type: 'text', placeholder: 'Your name', 'data-opt': 'author' } });
		authorIn.value = this.o.author;
		authorIn.addEventListener('input', () => (this.o.author = authorIn.value));
		const tp = row('Title page').createEl('input', { attr: { type: 'checkbox', 'data-opt': 'titlePage' } });
		tp.checked = this.o.titlePage;
		tp.addEventListener('change', () => (this.o.titlePage = tp.checked));
		const cs = row('Chapter headings').createEl('select', { cls: 'dropdown', attr: { 'data-opt': 'chapterStyle' } });
		for (const [k, l] of STYLES) cs.createEl('option', { text: l, attr: { value: k } });
		cs.value = this.o.chapterStyle;
		cs.addEventListener('change', () => (this.o.chapterStyle = cs.value as ChapterStyle));
		const stl = row('Scene titles').createEl('input', { attr: { type: 'checkbox', 'data-opt': 'sceneTitles' } });
		stl.checked = this.o.sceneTitles;
		const sepSel = row('Between scenes').createEl('select', { cls: 'dropdown', attr: { 'data-opt': 'separator' } });
		for (const [k, l] of SEPS) sepSel.createEl('option', { text: l, attr: { value: k } });
		sepSel.value = this.o.separator;
		sepSel.disabled = this.o.sceneTitles;
		sepSel.addEventListener('change', () => (this.o.separator = sepSel.value));
		stl.addEventListener('change', () => {
			this.o.sceneTitles = stl.checked;
			sepSel.disabled = stl.checked;
		});
		if (this.target === 'epub' || this.target === 'html' || this.target === 'docx') {
			const lang = row('Language').createEl('input', { cls: 'ws-input ws-wr-compile__lang', attr: { type: 'text', 'data-opt': 'language', placeholder: 'en' } });
			lang.value = this.o.language;
			lang.addEventListener('input', () => (this.o.language = lang.value.trim() || 'en'));
		}
		wrap.createDiv({ cls: 'ws-arch-where', text: 'Obsidian-only things are left out: comments, embeds and images; links become their words. Bold and italics are kept.' });
		const actions = wrap.createDiv({ cls: 'ws-modal-actions' });
		button(actions, { label: 'Cancel', variant: 'ghost', onClick: () => this.close() });
		button(actions, { label: 'Compile', icon: 'file-output', variant: 'primary', cls: 'ws-wr-compile__go', onClick: () => void this.run() });
	}

	private async run(): Promise<void> {
		const ok = await compileTo(this.st, this.target, this.o);
		if (ok) this.close();
	}
}

/** The scenes’ texts, the document, and the file. Shared by the dialog and the Compile page. */
export async function compileTo(st: Studio, target: Target, opts: CompileOptions): Promise<string | null> {
	const p = st.project!;
	const o = { ...opts, title: opts.title.trim() || p.name, author: opts.author.trim() };
	st.w.updateProject(p.id, {
		author: o.author,
		compile: { target, titlePage: o.titlePage, chapterStyle: o.chapterStyle, sceneTitles: o.sceneTitles, separator: o.separator, language: o.language, order: o.order ?? 'story', dedication: o.dedication ?? '', epigraph: o.epigraph ?? '', epigraphBy: o.epigraphBy ?? '', acknowledgements: o.acknowledgements ?? '', about: o.about ?? '', exclude: (o.exclude ?? []).join(','), style: JSON.stringify(cleanStyle(o.style)) },
	});
	// The studio's title face travels with web pages, PDF and EPUB; the series goes on the title page.
	const face = studioFontFace();
	o.fontCss = face.css;
	o.fontWoff2 = face.woff2;
	o.subtitle = o.subtitle ?? (p.series || undefined);
	const doc = await compileDocument(st, o);
	const words = documentWords(doc);
	try {
		const folder = exportsFolder(st.ws);
		await ensureFolder(st, folder);
		const base = `${o.title} ${dateStamp()}`;
		let path: string;
		if (target === 'print') {
			// A PDF file (0.29.3): Obsidian's own renderer on the desktop (the studio's fonts),
			// else written directly (the PDF format's fonts). No print dialog.
			await ensureFolder(st, folder);
			const bytes = (await renderHtmlPdf(toHtml(doc, o))) ?? (await toPdf(doc, o));
			path = freeName(st, folder, base, 'pdf');
			await st.ws.app.vault.createBinary(path, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
			const file = st.ws.app.vault.getFileByPath(path);
			if (file) void st.ws.app.workspace.getLeaf('tab').openFile(file);
			const show = (st.ws.app as unknown as { showInFolder?: (p: string) => void }).showInFolder;
			if (show) actionNotice(`Compiled ${words.toLocaleString()} words into ${path}.`, { label: 'Show in folder', run: () => show.call(st.ws.app, path) });
			else new Notice(`Compiled ${words.toLocaleString()} words into ${path}.`, 10000);
			return path;
		}
		if (target === 'md' || target === 'txt' || target === 'html') {
			const text = target === 'md' ? toMarkdown(doc, o) : target === 'txt' ? toText(doc, o) : toHtml(doc, o);
			path = freeName(st, folder, base, target);
			await st.ws.app.vault.create(path, text);
		} else {
			const bytes = target === 'docx' ? await toDocx(doc, o) : await toEpub(doc, o, uuid());
			path = freeName(st, folder, base, target);
			await st.ws.app.vault.createBinary(path, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
		}
		new Notice(`Compiled ${words.toLocaleString()} words into ${path}.`, 10000);
		return path;
	} catch (e) {
		new Notice(`The book couldn’t be compiled: ${e instanceof Error ? e.message : String(e)}`, 10000);
		return null;
	}
}

/** The book as blocks, with the options (reads each scene's note). */
export async function compileDocument(st: Studio, o: CompileOptions): Promise<ReturnType<typeof buildDocument>> {
	const p = st.project!;
	const texts = new Map<string, string>();
	for (const s of st.w.scenes(p.id)) {
		const f = s.notePath ? st.ws.app.vault.getFileByPath(s.notePath) : null;
		if (f) texts.set(s.id, await st.ws.app.vault.cachedRead(f));
	}
	return buildDocument(st.w.tree(p.id), (it) => texts.get(it.id) ?? null, o);
}

/** The options a project last compiled with (or the defaults). */
export function savedOptions(p: { name: string; author?: string; compile?: Record<string, string | boolean> }): CompileOptions {
	const c = p.compile ?? {};
	const str = (k: string) => (typeof c[k] === 'string' ? (c[k]) : '');
	return {
		...DEFAULT_COMPILE,
		title: p.name,
		author: p.author ?? '',
		titlePage: c.titlePage !== false,
		chapterStyle: (STYLES.some(([k]) => k === c.chapterStyle) ? c.chapterStyle : DEFAULT_COMPILE.chapterStyle) as ChapterStyle,
		sceneTitles: c.sceneTitles === true,
		separator: typeof c.separator === 'string' ? c.separator : DEFAULT_COMPILE.separator,
		language: str('language') || DEFAULT_COMPILE.language,
		order: c.order === 'time' ? 'time' : 'story',
		dedication: str('dedication'),
		epigraph: str('epigraph'),
		epigraphBy: str('epigraphBy'),
		acknowledgements: str('acknowledgements'),
		about: str('about'),
		exclude: str('exclude') ? str('exclude').split(',').filter(Boolean) : [],
		style: (() => {
			try {
				return cleanStyle(str('style') ? (JSON.parse(str('style')) as Partial<BookStyle>) : undefined);
			} catch {
				return cleanStyle(undefined);
			}
		})(),
	};
}

/**
 * The studio's title face (Cormorant Garamond, bundled) from Worldsmith's loaded stylesheet:
 * as @font-face CSS for web pages and PDF, and as WOFF2 (base64) for EPUB. Empty when absent.
 */
export function studioFontFace(): { css: string; woff2: string | undefined } {
	let css = '';
	let woff2: string | undefined;
	for (const sheet of Array.from(activeDocument.styleSheets)) {
		let rules: CSSRuleList;
		try {
			rules = sheet.cssRules;
		} catch {
			continue;
		}
		for (const r of Array.from(rules)) {
			if (r instanceof CSSFontFaceRule && /Worldsmith Codex/.test(r.style.getPropertyValue('font-family'))) {
				css += `${r.cssText}\n`;
				if (!woff2 && !/italic/.test(r.style.getPropertyValue('font-style'))) woff2 = /base64,([A-Za-z0-9+/=]+)/.exec(r.cssText)?.[1];
			}
		}
	}
	return { css, woff2 };
}
