import type { ManuscriptItem } from '../../core/types';
import { zip } from '../../core/util/zip';

/**
 * WS7 (0.26): compiling a manuscript. The book's parts, chapters and scenes in reading order
 * become one document (`buildDocument`), cleaned of Obsidian-only syntax, then written out as
 * Markdown, plain text, print-ready HTML, Word (.docx) or EPUB. Word and EPUB are ZIP files of
 * XML written here with Worldsmith's own ZIP writer: no library. Pure (no Obsidian, no DOM).
 */

export type CompileFormat = 'md' | 'txt' | 'html' | 'docx' | 'epub';
export type ChapterStyle = 'title' | 'number' | 'number-title' | 'none';

export interface CompileOptions {
	title: string;
	author: string;
	titlePage: boolean;
	chapterStyle: ChapterStyle;
	sceneTitles: boolean;
	/** Between scenes of one chapter: "* * *", "#", or "" (a blank line). */
	separator: string;
	/** BCP-47 language for EPUB/HTML ("en"). */
	language: string;
	/** 0.28: story order (the manuscript's) or in-world time order (by each scene's date). */
	order?: 'story' | 'time';
	/** 0.28: parts, chapters or scenes left out (their ids). */
	exclude?: string[];
	/** 0.28: front and back matter (empty = none). */
	dedication?: string;
	epigraph?: string;
	epigraphBy?: string;
	acknowledgements?: string;
	about?: string;
	/** 0.28.2: how the book looks (Word, PDF, EPUB, web page). */
	style?: BookStyle;
	/** A line over the title on the title page (the series). */
	subtitle?: string;
	/** The studio's title face as CSS @font-face (embedded in web pages and PDF). */
	fontCss?: string;
	/** …and as WOFF2 bytes, base64 (embedded in EPUB). */
	fontWoff2?: string;
}

// ── Style (0.28.2) ──────────────────────────────────────────────────────────

export type BodyFont = 'studio' | 'georgia' | 'times' | 'palatino' | 'garamond' | 'sans';
export type PageSize = 'a5' | 'a4' | 'letter' | 'trade';

export interface BookStyle {
	preset: 'studio' | 'classic' | 'plain' | 'dark' | 'custom';
	paper: string;
	ink: string;
	accent: string;
	body: BodyFont;
	/** Headings in the studio's title face, or the body font. */
	headings: 'studio' | 'body';
	/** Text size in points. */
	size: number;
	leading: number;
	margins: 'narrow' | 'normal' | 'wide';
	page: PageSize;
	dropCap: boolean;
	indent: boolean;
	ornaments: boolean;
}

export const STYLE_PRESETS: Record<Exclude<BookStyle['preset'], 'custom'>, BookStyle> = {
	studio: { preset: 'studio', paper: '#f4ecdc', ink: '#2a251d', accent: '#8f6236', body: 'studio', headings: 'studio', size: 12, leading: 1.6, margins: 'normal', page: 'a5', dropCap: true, indent: true, ornaments: true },
	classic: { preset: 'classic', paper: '#ffffff', ink: '#000000', accent: '#000000', body: 'times', headings: 'body', size: 12, leading: 2, margins: 'wide', page: 'a4', dropCap: false, indent: true, ornaments: false },
	plain: { preset: 'plain', paper: '#ffffff', ink: '#1a1a1a', accent: '#555555', body: 'georgia', headings: 'body', size: 11.5, leading: 1.5, margins: 'normal', page: 'a5', dropCap: false, indent: true, ornaments: false },
	dark: { preset: 'dark', paper: '#1d1b18', ink: '#e8e1d3', accent: '#c9a06a', body: 'studio', headings: 'studio', size: 12, leading: 1.6, margins: 'normal', page: 'a5', dropCap: true, indent: true, ornaments: true },
};

export const BODY_FONTS: Record<BodyFont, { label: string; css: string; word: string }> = {
	studio: { label: 'Book serif (as in the studio)', css: "Charter, 'Bitstream Charter', 'Iowan Old Style', 'Palatino Linotype', Georgia, serif", word: 'Palatino Linotype' },
	georgia: { label: 'Georgia', css: 'Georgia, serif', word: 'Georgia' },
	times: { label: 'Times New Roman', css: "'Times New Roman', Times, serif", word: 'Times New Roman' },
	palatino: { label: 'Palatino', css: "'Palatino Linotype', Palatino, 'Book Antiqua', serif", word: 'Palatino Linotype' },
	garamond: { label: 'Garamond', css: "'EB Garamond', Garamond, 'Adobe Garamond Pro', Georgia, serif", word: 'Garamond' },
	sans: { label: 'Sans serif', css: "-apple-system, 'Segoe UI', Helvetica, Arial, sans-serif", word: 'Calibri' },
};
export const STUDIO_HEADING_CSS = "'Worldsmith Codex', 'Cormorant Garamond', Georgia, serif";
export const STUDIO_HEADING_WORD = 'Cormorant Garamond';
/** Page sizes: CSS size, and Word's in twips (w × h). */
export const PAGE_SIZES: Record<PageSize, { label: string; css: string; w: number; h: number; ratio: number }> = {
	a5: { label: 'A5 (book)', css: 'A5', w: 8391, h: 11906, ratio: 148 / 210 },
	trade: { label: '6 × 9 in (trade paperback)', css: '6in 9in', w: 8640, h: 12960, ratio: 6 / 9 },
	a4: { label: 'A4', css: 'A4', w: 11906, h: 16838, ratio: 210 / 297 },
	letter: { label: 'US Letter', css: 'letter', w: 12240, h: 15840, ratio: 8.5 / 11 },
};
export const MARGIN_CM: Record<BookStyle['margins'], number> = { narrow: 1.5, normal: 2.2, wide: 3 };

const hexOk = (c: unknown, d: string): string => (typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c) ? c : d);

/** A style made safe to use (odd values replaced by the studio's). */
export function cleanStyle(s: Partial<BookStyle> | undefined): BookStyle {
	const v = s ?? {};
	const base = v.preset && v.preset !== 'custom' && v.preset in STYLE_PRESETS ? STYLE_PRESETS[v.preset] : STYLE_PRESETS.studio;
	return {
		preset: ['studio', 'classic', 'plain', 'dark', 'custom'].includes(v.preset as string) ? (v.preset as BookStyle['preset']) : 'studio',
		paper: hexOk(v.paper, base.paper),
		ink: hexOk(v.ink, base.ink),
		accent: hexOk(v.accent, base.accent),
		body: (typeof v.body === 'string' && v.body in BODY_FONTS ? v.body : base.body),
		headings: v.headings === 'body' ? 'body' : v.headings === 'studio' ? 'studio' : base.headings,
		size: typeof v.size === 'number' && v.size >= 8 && v.size <= 20 ? v.size : base.size,
		leading: typeof v.leading === 'number' && v.leading >= 1 && v.leading <= 2.5 ? v.leading : base.leading,
		margins: v.margins === 'narrow' || v.margins === 'wide' || v.margins === 'normal' ? v.margins : base.margins,
		page: (typeof v.page === 'string' && v.page in PAGE_SIZES ? v.page : base.page),
		dropCap: typeof v.dropCap === 'boolean' ? v.dropCap : base.dropCap,
		indent: typeof v.indent === 'boolean' ? v.indent : base.indent,
		ornaments: typeof v.ornaments === 'boolean' ? v.ornaments : base.ornaments,
	};
}

/**
 * The book's CSS for a style. On screen, a page-width column on the paper colour; printed (PDF),
 * full-bleed paper on every page with the margins repeated on each page (printer margins are
 * zero and the column's padding is cloned across pages, so the margins aren't left white).
 */
export function bookCss(st: BookStyle, fontCss = ''): string {
	const body = BODY_FONTS[st.body].css;
	const heading = st.headings === 'studio' ? STUDIO_HEADING_CSS : body;
	const m = MARGIN_CM[st.margins];
	return `${fontCss}
:root { --paper: ${st.paper}; --ink: ${st.ink}; --accent: ${st.accent}; --muted: color-mix(in srgb, ${st.ink} 62%, ${st.paper}); }
html { background: var(--paper); -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body { margin: 0; color: var(--ink); font-family: ${body}; font-size: ${st.size}pt; line-height: ${st.leading}; }
.book { max-width: 34em; margin: 0 auto; padding: 3em 1.5em; }
h1, h2, h3, .book-title, .ctitle { font-family: ${heading}; font-weight: 500; color: var(--ink); }
.title-page { text-align: center; padding-top: 28vh; page-break-after: always; break-after: page; }
.title-page .series { color: var(--accent); font-family: ${body}; font-size: 0.7em; letter-spacing: 0.22em; text-transform: uppercase; margin: 0 0 1.2em; text-indent: 0; text-align: center; }
.book-title { font-size: 2.6em; line-height: 1.1; margin: 0 0 0.6em; }
.book-author { font-size: 0.95em; letter-spacing: 0.3em; text-transform: uppercase; text-indent: 0; text-align: center; }
.title-page .arch { width: 1.6em; height: 2em; margin: 0 auto 2em; border: 1px solid var(--accent); border-radius: 999px 999px 2px 2px; display: ${st.ornaments ? 'block' : 'none'}; }
h1.part { text-align: center; font-size: 1.9em; padding-top: 30vh; margin: 0; page-break-before: always; break-before: page; page-break-after: always; break-after: page; }
h2.chapter { text-align: center; margin: 3.5em 0 2em; page-break-before: always; break-before: page; font-size: 1em; }
h2.chapter .kicker { display: block; color: var(--accent); font-family: ${body}; font-size: 0.7em; font-weight: 600; letter-spacing: 0.22em; text-transform: uppercase; margin-bottom: 0.6em; }
h2.chapter .ctitle { display: block; font-size: 1.9em; line-height: 1.15; }
h2.chapter .orn { display: ${st.ornaments ? 'block' : 'none'}; color: var(--accent); font-size: 0.6em; margin-top: 0.9em; }
hr.chapter-break { border: none; page-break-before: always; break-before: page; margin: 2em 0; }
h3.scene { font-size: 1.15em; font-style: italic; font-weight: 500; margin: 2em 0 1em; }
p { margin: 0 0 ${st.indent ? '0' : '0.85em'}; text-indent: ${st.indent ? '1.5em' : '0'}; text-align: justify; hyphens: auto; overflow-wrap: break-word; }
p.first { text-indent: 0; }
${st.dropCap ? `p.opening::first-letter { float: left; font-family: ${heading}; font-size: 3.4em; line-height: 0.82; margin: 0.06em 0.08em 0 0; color: var(--accent); }` : ''}
p.scene-break { text-align: center; text-indent: 0; margin: 1.2em 0; color: var(--accent); letter-spacing: 0.4em; }
blockquote { margin: 1em 2em; font-style: italic; }
blockquote p { text-indent: 0; }
.dedication, .epigraph { text-align: center; padding-top: 25vh; page-break-after: always; break-after: page; font-style: italic; }
.dedication p, .epigraph p { text-indent: 0; text-align: center; }
.epigraph .by { font-style: normal; margin-top: 0.6em; color: var(--muted); }
@page { size: ${PAGE_SIZES[st.page].css}; margin: 0; }
@media print {
	.book { max-width: none; padding: ${m}cm ${(m * 0.9).toFixed(2)}cm; box-decoration-break: clone; -webkit-box-decoration-break: clone; }
	.title-page, .dedication, .epigraph, h1.part { padding-top: 35%; }
}
`;
}


export const DEFAULT_COMPILE: CompileOptions = { title: '', author: '', titlePage: true, chapterStyle: 'number-title', sceneTitles: false, separator: '* * *', language: 'en' };

export interface Run {
	text: string;
	b?: boolean;
	i?: boolean;
}

export type Block =
	| { t: 'title'; title: string; author: string }
	| { t: 'part'; text: string }
	| { t: 'chapter'; text: string }
	| { t: 'scene'; text: string }
	| { t: 'sep' }
	| { t: 'h'; text: string }
	| { t: 'p'; runs: Run[] }
	| { t: 'quote'; runs: Run[] }
	| { t: 'matter'; kind: 'dedication' | 'epigraph' | 'acknowledgements' | 'about'; text: string; by?: string };

/** A tree node of the manuscript (as WritingService.tree gives it). */
export interface CompileNode {
	item: Pick<ManuscriptItem, 'id' | 'kind' | 'title' | 'notePath'> & Partial<Pick<ManuscriptItem, 'date' | 'time'>>;
	children: CompileNode[];
}

// ── Obsidian syntax ─────────────────────────────────────────────────────────

/**
 * A note's text without what only means something in Obsidian: front matter, %% comments %%,
 * HTML comments, embeds and images, block ids; links become their text ([[Ava|her]] → her,
 * [[Notes/Ava#Past]] → Ava, [text](url) → text); highlights become plain text; a callout
 * keeps its title and text as a quotation.
 */
export function cleanObsidian(md: string): string {
	let s = md.replace(/\r\n?/g, '\n');
	s = s.replace(/^---\n[\s\S]*?\n---\n?/, '');
	s = s.replace(/%%[\s\S]*?%%/g, '');
	s = s.replace(/<!--[\s\S]*?-->/g, '');
	s = s.replace(/!\[\[[^\]]*\]\]/g, '');
	s = s.replace(/!\[[^\]]*\]\([^)]*\)/g, '');
	s = s.replace(/\[\[([^\]|#]*)(?:#[^\]|]*)?\|([^\]]*)\]\]/g, '$2');
	s = s.replace(/\[\[([^\]|#]*)(?:#[^\]]*)?\]\]/g, (_m, target: string) => (target.split('/').pop() ?? target).replace(/\.md$/i, ''));
	s = s.replace(/\[([^\]]*)\]\((?:[^()]|\([^)]*\))*\)/g, '$1');
	s = s.replace(/==([^=\n]+)==/g, '$1');
	s = s.replace(/^(>\s*)\[![^\]]*\][+-]?\s*/gm, '$1');
	s = s.replace(/\s\^[A-Za-z0-9-]+$/gm, '');
	return s;
}

/** Bold and italic in a line of Markdown, as runs. Unmatched markers stay as text. */
export function parseInline(line: string): Run[] {
	const out: Run[] = [];
	// No lookbehind (older iPhones and iPads can't load it): the character before an italic
	// marker is matched (group 5) and written out as plain text.
	const re = /(\*\*\*|___)(.+?)\1|(\*\*|__)(.+?)\3|(^|[^\p{L}\p{N}*])(\*|_)(?![\s*_])([^\s*_](?:.*?[^\s*_])?)\6(?![\p{L}\p{N}*])/gu;
	let last = 0;
	let m: RegExpExecArray | null;
	while ((m = re.exec(line))) {
		const start = m.index + (m[1] || m[3] ? 0 : (m[5] ?? '').length);
		if (start > last) out.push({ text: line.slice(last, start) });
		if (m[1]) out.push({ text: m[2]!, b: true, i: true });
		else if (m[3]) out.push(...parseInline(m[4]!).map((r) => ({ ...r, b: true })));
		else out.push(...parseInline(m[7]!).map((r) => ({ ...r, i: true })));
		last = m.index + m[0].length;
	}
	if (last < line.length) out.push({ text: line.slice(last) });
	return out.filter((r) => r.text);
}

/** A scene's cleaned text as blocks: paragraphs, headings inside it, quotations, breaks. */
export function sceneBlocks(text: string): Block[] {
	const out: Block[] = [];
	const paras = cleanObsidian(text)
		.split(/\n\s*\n/)
		.map((p) => p.trim())
		.filter(Boolean);
	for (const p of paras) {
		if (/^(\*\s*\*\s*\*|-{3,}|_{3,}|#)$/.test(p.replace(/\s+/g, ' '))) {
			out.push({ t: 'sep' });
			continue;
		}
		const h = /^#{1,6}\s+(.+)$/.exec(p);
		if (h && !p.includes('\n')) {
			out.push({ t: 'h', text: h[1]!.trim() });
			continue;
		}
		if (p.split('\n').every((l) => /^>/.test(l))) {
			const q = p
				.split('\n')
				.map((l) => l.replace(/^>\s?/, ''))
				.join(' ')
				.trim();
			if (q) out.push({ t: 'quote', runs: parseInline(q) });
			continue;
		}
		// Lines of a paragraph join with spaces (Markdown's soft breaks); list items keep a bullet.
		const lines = p.split('\n').map((l) => l.trim().replace(/^[-*+]\s+(\[[ xX]\]\s+)?/, '• ').replace(/^(\d+)[.)]\s+/, '$1. '));
		const isList = lines.every((l) => /^(• |\d+\. )/.test(l));
		if (isList) for (const l of lines) out.push({ t: 'p', runs: parseInline(l) });
		else out.push({ t: 'p', runs: parseInline(lines.join(' ')) });
	}
	return out;
}

const ONES = ['Zero', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

/** 1 → "One", 42 → "Forty-Two" (up to 999; beyond that, digits). */
export function numberWords(n: number): string {
	if (n < 20) return ONES[n] ?? String(n);
	if (n < 100) return TENS[Math.floor(n / 10)]! + (n % 10 ? `-${ONES[n % 10]}` : '');
	if (n < 1000) return `${ONES[Math.floor(n / 100)]} Hundred${n % 100 ? ` ${numberWords(n % 100)}` : ''}`;
	return String(n);
}

export function chapterHeading(style: ChapterStyle, n: number, title: string): string | null {
	switch (style) {
		case 'title':
			return title;
		case 'number':
			return `Chapter ${numberWords(n)}`;
		case 'number-title':
			return title ? `Chapter ${numberWords(n)}: ${title}` : `Chapter ${numberWords(n)}`;
		default:
			return null;
	}
}

/**
 * The whole book as blocks, in reading order. `textOf` gives a scene's note text (null when it
 * has none). Scenes of one chapter are separated by the separator, unless scene titles are shown.
 */
export function buildDocument(tree: CompileNode[], textOf: (item: CompileNode['item']) => string | null, o: CompileOptions): Block[] {
	const out: Block[] = [];
	if (o.titlePage) out.push({ t: 'title', title: o.title, author: o.author });
	if (o.dedication?.trim()) out.push({ t: 'matter', kind: 'dedication', text: o.dedication.trim() });
	if (o.epigraph?.trim()) out.push({ t: 'matter', kind: 'epigraph', text: o.epigraph.trim(), by: o.epigraphBy?.trim() || undefined });
	const skip = new Set(o.exclude ?? []);
	const keep = (nodes: CompileNode[]): CompileNode[] => nodes.filter((n) => !skip.has(n.item.id)).map((n) => ({ ...n, children: keep(n.children) }));
	tree = keep(tree);
	if (o.order === 'time') {
		// In-world time: every scene by its date (undated ones after, in story order), no chapters.
		const scenes: CompileNode[] = [];
		const collect = (nodes: CompileNode[]) => nodes.forEach((n) => (n.item.kind === 'scene' ? scenes.push(n) : collect(n.children)));
		collect(tree);
		const key = (n: CompileNode) => {
			const d = n.item.date;
			if (!d) return Infinity;
			return d.year * 10000 + (d.month ?? 0) * 100 + (d.day ?? 0) + (n.item.time ? Number(n.item.time.replace(':', '')) / 10000 : 0);
		};
		const ordered = scenes.map((n, i) => ({ n, i })).sort((a, b) => key(a.n) - key(b.n) || a.i - b.i);
		let first = true;
		for (const { n } of ordered) {
			if (o.sceneTitles) out.push({ t: 'scene', text: n.item.title });
			else if (!first) out.push({ t: 'sep' });
			out.push(...sceneBlocks(textOf(n.item) ?? ''));
			first = false;
		}
		matterAfter(out, o);
		return out;
	}
	let chapterNo = 0;
	let lastWasScene = false;
	const walk = (nodes: CompileNode[]) => {
		for (const n of nodes) {
			const it = n.item;
			if (it.kind === 'part') {
				out.push({ t: 'part', text: it.title });
				lastWasScene = false;
				walk(n.children);
			} else if (it.kind === 'chapter') {
				chapterNo++;
				const h = chapterHeading(o.chapterStyle, chapterNo, it.title);
				out.push({ t: 'chapter', text: h ?? '' });
				lastWasScene = false;
				walk(n.children);
			} else if (it.kind === 'scene') {
				if (o.sceneTitles) out.push({ t: 'scene', text: it.title });
				else if (lastWasScene) out.push({ t: 'sep' });
				out.push(...sceneBlocks(textOf(it) ?? ''));
				lastWasScene = true;
				walk(n.children);
			} else walk(n.children);
		}
	};
	walk(tree);
	matterAfter(out, o);
	return out;
}

function matterAfter(out: Block[], o: CompileOptions): void {
	if (o.acknowledgements?.trim()) out.push({ t: 'matter', kind: 'acknowledgements', text: o.acknowledgements.trim() });
	if (o.about?.trim()) out.push({ t: 'matter', kind: 'about', text: o.about.trim() });
}

const MATTER_TITLE: Record<string, string> = { acknowledgements: 'Acknowledgements', about: 'About the author' };

/** Words in the compiled book. */
export function documentWords(blocks: Block[]): number {
	let n = 0;
	for (const b of blocks) if (b.t === 'p' || b.t === 'quote') for (const r of b.runs) n += (r.text.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) ?? []).length;
	return n;
}

// ── Markdown and text ───────────────────────────────────────────────────────

const mdRuns = (runs: Run[]) => runs.map((r) => (r.b && r.i ? `***${r.text}***` : r.b ? `**${r.text}**` : r.i ? `*${r.text}*` : r.text)).join('');

export function toMarkdown(blocks: Block[], o: CompileOptions): string {
	const out: string[] = [];
	const sep = o.separator ? (o.separator === '* * *' ? '\\* \\* \\*' : o.separator === '#' ? '\\#' : o.separator) : '&nbsp;';
	for (const b of blocks) {
		if (b.t === 'title') out.push(`# ${b.title}`, ...(b.author ? [`*${b.author}*`] : []));
		else if (b.t === 'part') out.push(`# ${b.text}`);
		else if (b.t === 'chapter') out.push(b.text ? `## ${b.text}` : '---');
		else if (b.t === 'scene') out.push(`### ${b.text}`);
		else if (b.t === 'h') out.push(`#### ${b.text}`);
		else if (b.t === 'sep') out.push(sep);
		else if (b.t === 'quote') out.push(`> ${mdRuns(b.runs)}`);
		else if (b.t === 'matter') out.push(b.kind === 'dedication' ? `*${b.text}*` : b.kind === 'epigraph' ? `> *${b.text}*${b.by ? `\n>\n> — ${b.by}` : ''}` : `## ${MATTER_TITLE[b.kind]}\n\n${b.text}`);
		else out.push(mdRuns(b.runs));
	}
	return out.join('\n\n') + '\n';
}

export function toText(blocks: Block[], o: CompileOptions): string {
	const out: string[] = [];
	const plain = (runs: Run[]) => runs.map((r) => r.text).join('');
	for (const b of blocks) {
		if (b.t === 'title') out.push(b.title.toUpperCase(), ...(b.author ? [b.author] : []), '');
		else if (b.t === 'part') out.push('', b.text.toUpperCase());
		else if (b.t === 'chapter') out.push('', b.text || '');
		else if (b.t === 'scene' || b.t === 'h') out.push(b.text);
		else if (b.t === 'sep') out.push(o.separator ? `        ${o.separator}` : '');
		else if (b.t === 'quote') out.push(`    ${plain(b.runs)}`);
		else if (b.t === 'matter') out.push(b.kind === 'dedication' || b.kind === 'epigraph' ? `        ${b.text}${b.by ? `\n        — ${b.by}` : ''}` : `${MATTER_TITLE[b.kind]!.toUpperCase()}\n\n${b.text}`);
		else out.push(plain(b.runs));
	}
	return out.join('\n\n').replace(/\n{4,}/g, '\n\n\n') + '\n';
}

// ── HTML ────────────────────────────────────────────────────────────────────

export function esc(s: string): string {
	return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const htmlRuns = (runs: Run[]) => runs.map((r) => (r.b && r.i ? `<strong><em>${esc(r.text)}</em></strong>` : r.b ? `<strong>${esc(r.text)}</strong>` : r.i ? `<em>${esc(r.text)}</em>` : esc(r.text))).join('');

/** The body of the book as XHTML-safe HTML (used by the HTML page and by EPUB chapters). */
export function htmlBody(blocks: Block[], o: CompileOptions): string {
	const out: string[] = [];
	let afterHeading = true;
	let opening = false;
	for (const b of blocks) {
		if (b.t === 'title') {
			out.push(`<section class="title-page"><div class="arch"></div>${o.subtitle ? `<p class="series">${esc(o.subtitle)}</p>` : ''}<h1 class="book-title">${esc(b.title)}</h1>${b.author ? `<p class="book-author">${esc(b.author)}</p>` : ''}</section>`);
			afterHeading = true;
		} else if (b.t === 'part') {
			out.push(`<h1 class="part">${esc(b.text)}</h1>`);
			afterHeading = true;
		} else if (b.t === 'chapter') {
			if (!b.text) out.push('<hr class="chapter-break" />');
			else {
				// "Chapter One: Arrival" → a kicker and a title (and an ornament, if the style has them).
				const m = /^(Chapter [^:]+)(?::\s*(.+))?$/.exec(b.text);
				const kick = m ? m[1]! : '';
				const title = m ? (m[2] ?? '') : b.text;
				out.push(`<h2 class="chapter">${kick ? `<span class="kicker">${esc(kick)}</span>` : ''}${title ? `<span class="ctitle">${esc(title)}</span>` : ''}<span class="orn" aria-hidden="true">◆</span></h2>`);
				opening = true;
			}
			afterHeading = true;
		} else if (b.t === 'scene' || b.t === 'h') {
			out.push(`<h3 class="scene">${esc(b.text)}</h3>`);
			afterHeading = true;
		} else if (b.t === 'sep') {
			out.push(`<p class="scene-break">${o.separator ? esc(o.separator) : '&#160;'}</p>`);
			afterHeading = true;
		} else if (b.t === 'quote') out.push(`<blockquote><p>${htmlRuns(b.runs)}</p></blockquote>`);
		else if (b.t === 'matter') {
			if (b.kind === 'dedication') out.push(`<section class="dedication"><p>${esc(b.text)}</p></section>`);
			else if (b.kind === 'epigraph') out.push(`<section class="epigraph"><p>${esc(b.text)}</p>${b.by ? `<p class="by">— ${esc(b.by)}</p>` : ''}</section>`);
			else out.push(`<h2 class="chapter">${esc(MATTER_TITLE[b.kind]!)}</h2>${b.text.split(/\n\s*\n/).map((x, i) => `<p${i === 0 ? ' class="first"' : ''}>${esc(x.trim())}</p>`).join('')}`);
			afterHeading = true;
		} else {
			out.push(`<p${afterHeading ? ` class="first${opening ? ' opening' : ''}"` : ''}>${htmlRuns(b.runs)}</p>`);
			afterHeading = false;
			opening = false;
		}
	}
	return out.join('\n');
}

export const BOOK_CSS = `
body { font-family: Georgia, 'Times New Roman', serif; line-height: 1.6; margin: 0 auto; max-width: 36em; padding: 2em 1.5em; color: #111; background: #fff; }
.title-page { text-align: center; margin: 30vh 0 0; page-break-after: always; break-after: page; }
.book-title { font-size: 2.2em; font-weight: normal; margin: 0 0 0.5em; }
.book-author { font-size: 1.2em; font-style: italic; }
h1.part { text-align: center; font-weight: normal; font-size: 1.8em; margin: 30vh 0 0; page-break-before: always; break-before: page; page-break-after: always; break-after: page; }
h2.chapter { text-align: center; font-weight: normal; font-size: 1.4em; margin: 3em 0 2em; page-break-before: always; break-before: page; }
hr.chapter-break { border: none; page-break-before: always; break-before: page; margin: 2em 0; }
h3.scene { font-size: 1.05em; font-style: italic; font-weight: normal; margin: 2em 0 1em; }
p { margin: 0; text-indent: 1.5em; text-align: justify; hyphens: auto; }
p.first { text-indent: 0; }
p.scene-break { text-align: center; text-indent: 0; margin: 1.2em 0; }
blockquote { margin: 1em 2em; font-style: italic; }
blockquote p { text-indent: 0; }
.dedication, .epigraph { text-align: center; margin: 25vh 0 0; page-break-after: always; break-after: page; font-style: italic; }
.dedication p, .epigraph p { text-indent: 0; text-align: center; }
.epigraph .by { font-style: normal; margin-top: 0.6em; }
@page { margin: 2.5cm 2.2cm; }
@media print { body { max-width: none; padding: 0; } }
`;

export function toHtml(blocks: Block[], o: CompileOptions): string {
	return `<!DOCTYPE html>
<html lang="${esc(o.language || 'en')}">
<head>
<meta charset="utf-8" />
<title>${esc(o.title || 'Manuscript')}</title>
<style>${bookCss(cleanStyle(o.style), o.fontCss ?? '')}</style>
</head>
<body>
<div class="book">
${htmlBody(blocks, o)}
</div>
</body>
</html>
`;
}

// ── Word (.docx) ────────────────────────────────────────────────────────────

// eslint-disable-next-line no-control-regex -- XML (Word, EPUB) forbids these characters, so they are removed
const xesc = (s: string) => esc(s).replace(/'/g, '&apos;').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');

function wRuns(runs: Run[]): string {
	return runs.map((r) => `<w:r>${r.b || r.i ? `<w:rPr>${r.b ? '<w:b/>' : ''}${r.i ? '<w:i/>' : ''}</w:rPr>` : ''}<w:t xml:space="preserve">${xesc(r.text)}</w:t></w:r>`).join('');
}

const wPara = (style: string, inner: string) => `<w:p><w:pPr><w:pStyle w:val="${style}"/></w:pPr>${inner}</w:p>`;

/** A Word document: title page, Heading 1–3 for parts, chapters and scenes, indented body text. */
export async function toDocx(blocks: Block[], o: CompileOptions, now = Date.now()): Promise<Uint8Array> {
	const st = cleanStyle(o.style);
	const hex = (c: string) => c.replace('#', '').toUpperCase();
	const body: string[] = [];
	let afterHeading = true;
	for (const b of blocks) {
		if (b.t === 'title') {
			if (o.subtitle) body.push(wPara('TitleKicker', wRuns([{ text: o.subtitle }])));
			body.push(wPara('Title', wRuns([{ text: b.title }])));
			if (b.author) body.push(wPara('Subtitle', wRuns([{ text: b.author }])));
			afterHeading = true;
		} else if (b.t === 'part') {
			body.push(wPara('Heading1', wRuns([{ text: b.text }])));
			afterHeading = true;
		} else if (b.t === 'chapter') {
			// "Chapter One: Arrival" → a kicker (with the page break) and the title (0.28.2).
			const m = /^(Chapter [^:]+)(?::\s*(.+))?$/.exec(b.text);
			if (m) {
				body.push(wPara('ChapterKicker', wRuns([{ text: m[1]! }])));
				if (m[2]) body.push(wPara('Heading2', wRuns([{ text: m[2] }])));
			} else body.push(wPara('Heading2Break', wRuns([{ text: b.text }])));
			if (st.ornaments) body.push(wPara('Ornament', wRuns([{ text: '◆' }])));
			afterHeading = true;
		} else if (b.t === 'scene' || b.t === 'h') {
			body.push(wPara('Heading3', wRuns([{ text: b.text }])));
			afterHeading = true;
		} else if (b.t === 'sep') {
			body.push(wPara('SceneBreak', o.separator ? wRuns([{ text: o.separator }]) : ''));
			afterHeading = true;
		} else if (b.t === 'quote') body.push(wPara('Quote', wRuns(b.runs)));
		else if (b.t === 'matter') {
			if (b.kind === 'dedication' || b.kind === 'epigraph') {
				body.push(wPara('Matter', wRuns([{ text: b.text, i: true }])));
				if (b.by) body.push(wPara('MatterBy', wRuns([{ text: `— ${b.by}` }])));
			} else {
				body.push(wPara('Heading2Break', wRuns([{ text: MATTER_TITLE[b.kind]! }])));
				b.text.split(/\n\s*\n/).forEach((x, i) => body.push(wPara(i === 0 ? 'FirstParagraph' : 'BodyText', wRuns([{ text: x.trim() }]))));
			}
			afterHeading = true;
		} else {
			body.push(wPara(afterHeading ? 'FirstParagraph' : 'BodyText', wRuns(b.runs)));
			afterHeading = false;
		}
	}
	const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
	const page = PAGE_SIZES[st.page];
	const mar = Math.round(MARGIN_CM[st.margins] * 567);
	const side = Math.round(mar * 0.9);
	const paperIsWhite = /^#?f{6}$/i.test(st.paper);
	const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document ${W}>${paperIsWhite ? '' : `<w:background w:color="${hex(st.paper)}"/>`}<w:body>${body.join('')}<w:sectPr><w:pgSz w:w="${page.w}" w:h="${page.h}"/><w:pgMar w:top="${mar}" w:right="${side}" w:bottom="${mar}" w:left="${side}" w:header="709" w:footer="709" w:gutter="0"/></w:sectPr></w:body></w:document>`;
	const bodyFont = BODY_FONTS[st.body].word;
	const headFont = st.headings === 'studio' ? STUDIO_HEADING_WORD : bodyFont;
	const font = (f: string) => `<w:rFonts w:ascii="${xesc(f)}" w:hAnsi="${xesc(f)}" w:cs="${xesc(f)}"/>`;
	const ink = `<w:color w:val="${hex(st.ink)}"/>`;
	const accent = `<w:color w:val="${hex(st.accent)}"/>`;
	const pt = (n: number) => Math.round(n * 2);
	const style = (id: string, name: string, ppr: string, rpr: string, based = 'Normal') => `<w:style w:type="paragraph" w:styleId="${id}"><w:name w:val="${name}"/><w:basedOn w:val="${based}"/><w:qFormat/><w:pPr>${ppr}</w:pPr><w:rPr>${rpr}</w:rPr></w:style>`;
	const indent = st.indent ? '<w:ind w:firstLine="425"/>' : '<w:spacing w:after="160"/>';
	const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles ${W}><w:docDefaults><w:rPrDefault><w:rPr>${font(bodyFont)}${ink}<w:sz w:val="${pt(st.size)}"/><w:szCs w:val="${pt(st.size)}"/><w:lang w:val="${xesc(o.language || 'en')}"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="0" w:line="${Math.round(240 * st.leading)}" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>
${style('BodyText', 'Body Text', `${indent}<w:jc w:val="both"/>`, '')}
${style('FirstParagraph', 'First Paragraph', '<w:ind w:firstLine="0"/><w:jc w:val="both"/>', '', 'BodyText')}
${style('TitleKicker', 'Title Kicker', '<w:pageBreakBefore w:val="0"/><w:spacing w:before="3600" w:after="200"/><w:jc w:val="center"/>', `${accent}<w:caps/><w:spacing w:val="40"/><w:sz w:val="${pt(st.size * 0.75)}"/>`)}
${style('Title', 'Title', `<w:spacing w:before="${o.subtitle ? 0 : 4000}" w:after="400"/><w:jc w:val="center"/>`, `${font(headFont)}<w:sz w:val="${pt(st.size * 2.6)}"/>`)}
${style('Subtitle', 'Subtitle', '<w:jc w:val="center"/><w:spacing w:after="400"/>', `<w:caps/><w:spacing w:val="60"/><w:sz w:val="${pt(st.size * 0.95)}"/>`)}
${style('Heading1', 'heading 1', '<w:keepNext/><w:pageBreakBefore/><w:spacing w:before="3000" w:after="600"/><w:jc w:val="center"/><w:outlineLvl w:val="0"/>', `${font(headFont)}<w:sz w:val="${pt(st.size * 1.9)}"/>`)}
${style('ChapterKicker', 'Chapter Number', '<w:keepNext/><w:pageBreakBefore/><w:spacing w:before="1200" w:after="120"/><w:jc w:val="center"/>', `${accent}<w:b/><w:caps/><w:spacing w:val="40"/><w:sz w:val="${pt(st.size * 0.7)}"/>`)}
${style('Heading2', 'heading 2', '<w:keepNext/><w:spacing w:before="0" w:after="240"/><w:jc w:val="center"/><w:outlineLvl w:val="1"/>', `${font(headFont)}<w:sz w:val="${pt(st.size * 1.9)}"/>`)}
${style('Heading2Break', 'Chapter Heading', '<w:keepNext/><w:pageBreakBefore/><w:spacing w:before="1200" w:after="480"/><w:jc w:val="center"/><w:outlineLvl w:val="1"/>', `${font(headFont)}<w:sz w:val="${pt(st.size * 1.9)}"/>`)}
${style('Ornament', 'Ornament', '<w:keepNext/><w:spacing w:before="0" w:after="480"/><w:jc w:val="center"/>', `${accent}<w:sz w:val="${pt(st.size * 0.7)}"/>`)}
${style('Heading3', 'heading 3', '<w:keepNext/><w:spacing w:before="360" w:after="200"/><w:outlineLvl w:val="2"/>', `${font(headFont)}<w:i/><w:sz w:val="${pt(st.size * 1.15)}"/>`)}
${style('SceneBreak', 'Scene Break', '<w:spacing w:before="240" w:after="240"/><w:jc w:val="center"/>', accent)}
${style('Matter', 'Front Matter', '<w:pageBreakBefore/><w:spacing w:before="3600" w:after="200"/><w:jc w:val="center"/>', '')}
${style('MatterBy', 'Front Matter Attribution', '<w:jc w:val="center"/>', '')}
${style('Quote', 'Quote', '<w:ind w:left="720" w:right="720"/><w:spacing w:before="120" w:after="120"/>', '<w:i/>')}
</w:styles>`;
	const iso = new Date(now).toISOString().replace(/\.\d{3}Z$/, 'Z');
	const enc = new TextEncoder();
	return zip(
		[
			{ path: '[Content_Types].xml', data: enc.encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`) },
			{ path: '_rels/.rels', data: enc.encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`) },
			{ path: 'word/_rels/document.xml.rels', data: enc.encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/></Relationships>`) },
			{ path: 'word/document.xml', data: enc.encode(document) },
			{ path: 'word/styles.xml', data: enc.encode(styles) },
			// Shows the page colour in Word (Word prints it when "Print background colors" is on).
			{ path: 'word/settings.xml', data: enc.encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:settings ${W}>${paperIsWhite ? '' : '<w:displayBackgroundShape/>'}</w:settings>`) },
			{ path: 'docProps/core.xml', data: enc.encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${xesc(o.title)}</dc:title><dc:creator>${xesc(o.author)}</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${iso}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${iso}</dcterms:modified></cp:coreProperties>`) },
		],
		{ mtime: now },
	);
}

// ── EPUB ────────────────────────────────────────────────────────────────────

/** Split the book where chapters and parts start (each becomes an EPUB file). */
function chaptersOf(blocks: Block[]): Array<{ title: string; blocks: Block[] }> {
	const out: Array<{ title: string; blocks: Block[] }> = [];
	let cur: { title: string; blocks: Block[] } | null = null;
	for (const b of blocks) {
		const matterPage = b.t === 'matter';
		if (b.t === 'title' || b.t === 'part' || b.t === 'chapter' || matterPage || !cur) {
			cur = { title: b.t === 'title' ? b.title : b.t === 'part' || b.t === 'chapter' ? b.text || `Chapter ${out.length + 1}` : b.t === 'matter' ? (MATTER_TITLE[b.kind] ?? (b.kind === 'dedication' ? 'Dedication' : 'Epigraph')) : 'Start', blocks: [] };
			out.push(cur);
		}
		cur.blocks.push(b);
	}
	return out.filter((c) => c.blocks.length);
}

/** An EPUB 3 book (with an EPUB 2 table of contents too): one XHTML file per chapter. */
export async function toEpub(blocks: Block[], o: CompileOptions, id: string, now = Date.now()): Promise<Uint8Array> {
	const enc = new TextEncoder();
	const lang = xesc(o.language || 'en');
	const chapters = chaptersOf(blocks);
	const modified = new Date(now).toISOString().replace(/\.\d{3}Z$/, 'Z');
	const xhtml = (title: string, body: string) => `<?xml version="1.0" encoding="utf-8"?>\n<!DOCTYPE html>\n<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="${lang}" lang="${lang}"><head><meta charset="utf-8"/><title>${xesc(title)}</title><link rel="stylesheet" type="text/css" href="style.css"/></head><body>${body}</body></html>`;
	const files = chapters.map((c, i) => ({ name: `chap-${String(i + 1).padStart(3, '0')}.xhtml`, title: c.title, html: xhtml(c.title, `<div class="book">${htmlBody(c.blocks, o).replace(/<br>/g, '<br/>')}</div>`) }));
	const nav = xhtml('Contents', `<nav epub:type="toc" id="toc"><h1>Contents</h1><ol>${files.map((f) => `<li><a href="${f.name}">${xesc(f.title)}</a></li>`).join('')}</ol></nav>`);
	const opf = `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid" xml:lang="${lang}">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="bookid">urn:uuid:${xesc(id)}</dc:identifier><dc:title>${xesc(o.title || 'Manuscript')}</dc:title>${o.author ? `<dc:creator>${xesc(o.author)}</dc:creator>` : ''}<dc:language>${lang}</dc:language><meta property="dcterms:modified">${modified}</meta></metadata>
<manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>${o.fontWoff2 ? '<item id="font" href="fonts/title.woff2" media-type="font/woff2"/>' : ''}<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/><item id="css" href="style.css" media-type="text/css"/>${files.map((f, i) => `<item id="c${i + 1}" href="${f.name}" media-type="application/xhtml+xml"/>`).join('')}</manifest>
<spine toc="ncx">${files.map((_f, i) => `<itemref idref="c${i + 1}"/>`).join('')}</spine>
</package>`;
	const ncx = `<?xml version="1.0" encoding="utf-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1"><head><meta name="dtb:uid" content="urn:uuid:${xesc(id)}"/><meta name="dtb:depth" content="1"/><meta name="dtb:totalPageCount" content="0"/><meta name="dtb:maxPageNumber" content="0"/></head><docTitle><text>${xesc(o.title || 'Manuscript')}</text></docTitle><navMap>${files.map((f, i) => `<navPoint id="n${i + 1}" playOrder="${i + 1}"><navLabel><text>${xesc(f.title)}</text></navLabel><content src="${f.name}"/></navPoint>`).join('')}</navMap></ncx>`;
	return zip(
		[
			// The EPUB rule: "mimetype" first, stored, no extra fields (the writer stores files this small).
			{ path: 'mimetype', data: enc.encode('application/epub+zip') },
			{ path: 'META-INF/container.xml', data: enc.encode(`<?xml version="1.0" encoding="UTF-8"?>\n<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`) },
			{ path: 'OEBPS/content.opf', data: enc.encode(opf) },
			{ path: 'OEBPS/nav.xhtml', data: enc.encode(nav) },
			{ path: 'OEBPS/toc.ncx', data: enc.encode(ncx) },
			{ path: 'OEBPS/style.css', data: enc.encode(bookCss(cleanStyle(o.style), o.fontWoff2 ? "@font-face { font-family: 'Worldsmith Codex'; src: url(fonts/title.woff2) format('woff2'); font-weight: 300 700; }" : '').replace(/(\d+)vh/g, '$1%')) },
			...(o.fontWoff2 ? [{ path: 'OEBPS/fonts/title.woff2', data: b64bytes(o.fontWoff2) }] : []),
			...files.map((f) => ({ path: `OEBPS/${f.name}`, data: enc.encode(f.html) })),
		],
		{ mtime: now },
	);
}

function b64bytes(b64: string): Uint8Array {
	const bin = atob(b64);
	const out = new Uint8Array(bin.length);
	for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
	return out;
}
