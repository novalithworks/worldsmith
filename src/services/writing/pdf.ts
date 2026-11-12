import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage } from 'pdf-lib';
import { cleanStyle, MARGIN_CM, PAGE_SIZES, type Block, type CompileOptions, type Run } from './compile';

/**
 * A book as a PDF file (0.29.3), written here (pdf-lib, MIT): the style's paper, ink and accent
 * colours, size, line spacing, margins and page size; title page, front matter, part and chapter
 * pages; chapter openings with a kicker, title, ornament and a decorative first letter; justified
 * paragraphs; scene breaks; page numbers. The PDF format's own fonts are used (Times, or
 * Helvetica for a sans style), so it works everywhere without a font file. (On the desktop,
 * Obsidian's own renderer is tried first, for the studio's fonts; see pdfRender.ts.)
 */

type RGB = ReturnType<typeof rgb>;
const hex = (h: string): RGB => {
	const n = parseInt(h.replace('#', ''), 16);
	return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
};
const mix = (a: string, b: string, t: number): RGB => {
	const p = (h: string) => parseInt(h.replace('#', ''), 16);
	const x = p(a);
	const y = p(b);
	const c = (s: number) => (((x >> s) & 255) * (1 - t) + ((y >> s) & 255) * t) / 255;
	return rgb(c(16), c(8), c(0));
};

interface Fonts {
	r: PDFFont;
	i: PDFFont;
	b: PDFFont;
	bi: PDFFont;
}

interface Word {
	text: string;
	font: PDFFont;
	w: number;
	/** A space follows it (before the next word). */
	space: boolean;
}

export async function toPdf(blocks: Block[], opts: CompileOptions): Promise<Uint8Array> {
	const st = cleanStyle(opts.style);
	const doc = await PDFDocument.create();
	doc.setTitle(opts.title || 'Manuscript');
	if (opts.author) doc.setAuthor(opts.author);
	doc.setCreator('Worldsmith');
	const sans = st.body === 'sans';
	const F: Fonts = sans
		? { r: await doc.embedFont(StandardFonts.Helvetica), i: await doc.embedFont(StandardFonts.HelveticaOblique), b: await doc.embedFont(StandardFonts.HelveticaBold), bi: await doc.embedFont(StandardFonts.HelveticaBoldOblique) }
		: { r: await doc.embedFont(StandardFonts.TimesRoman), i: await doc.embedFont(StandardFonts.TimesRomanItalic), b: await doc.embedFont(StandardFonts.TimesRomanBold), bi: await doc.embedFont(StandardFonts.TimesRomanBoldItalic) };
	const charset = new Set(F.r.getCharacterSet());
	/** Text the font can write (others become their nearest plain form, or are left out). */
	const safe = (s: string): string =>
		[...s.normalize('NFC')]
			.map((ch) => {
				if (charset.has(ch.codePointAt(0)!)) return ch;
				const plain = ch.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
				if (plain && [...plain].every((c) => charset.has(c.codePointAt(0)!))) return plain;
				if (ch === '\u2009' || ch === '\u202f' || ch === '\u00a0') return ' ';
				return '';
			})
			.join('');

	const page0 = PAGE_SIZES[st.page];
	const W = page0.w / 20;
	const H = page0.h / 20;
	const m = MARGIN_CM[st.margins] * 28.346;
	const side = m * 0.9;
	const size = st.size;
	const lead = size * st.leading;
	const ink = hex(st.ink);
	const accent = hex(st.accent);
	const muted = mix(st.ink, st.paper, 0.45);
	const textW = W - side * 2;

	let page!: PDFPage;
	let y = 0;
	let pageNo = 0;
	let numbered = false;
	const newPage = (withNumber: boolean) => {
		page = doc.addPage([W, H]);
		page.drawRectangle({ x: 0, y: 0, width: W, height: H, color: hex(st.paper) });
		pageNo++;
		numbered = withNumber;
		if (withNumber) {
			const t = String(pageNo);
			page.drawText(t, { x: (W - F.r.widthOfTextAtSize(t, size * 0.75)) / 2, y: m * 0.45, size: size * 0.75, font: F.r, color: muted });
		}
		y = H - m;
	};
	const ensure = (h: number) => {
		if (y - h < m) newPage(true);
	};
	const centered = (text: string, font: PDFFont, sz: number, color: RGB, atY: number) => {
		const t = safe(text);
		page.drawText(t, { x: (W - font.widthOfTextAtSize(t, sz)) / 2, y: atY, size: sz, font, color });
	};
	/** Wrap a plain string to lines of at most `w` points. */
	const wrapPlain = (text: string, font: PDFFont, sz: number, w: number): string[] => {
		const out: string[] = [];
		let line = '';
		for (const word of safe(text).split(/\s+/).filter(Boolean)) {
			const next = line ? `${line} ${word}` : word;
			if (font.widthOfTextAtSize(next, sz) <= w || !line) line = next;
			else {
				out.push(line);
				line = word;
			}
		}
		if (line) out.push(line);
		return out;
	};
	const diamond = (cx: number, cy: number, r: number) => {
		page.drawSvgPath(`M 0 ${-r} L ${r} 0 L 0 ${r} L ${-r} 0 Z`, { x: cx, y: cy, color: accent, borderWidth: 0 });
	};
	const fontOf = (r: Run, base: 'r' | 'i' = 'r'): PDFFont => (r.b && (r.i || base === 'i') ? F.bi : r.b ? F.b : r.i || base === 'i' ? F.i : F.r);
	const words = (runs: Run[], base: 'r' | 'i' = 'r'): Word[] => {
		const out: Word[] = [];
		for (const r of runs) {
			const font = fontOf(r, base);
			const parts = safe(r.text).split(/(\s+)/);
			for (const part of parts) {
				if (!part) continue;
				if (/^\s+$/.test(part)) {
					if (out.length) out[out.length - 1]!.space = true;
					continue;
				}
				// A word longer than the line is split where it must be.
				let rest = part;
				while (font.widthOfTextAtSize(rest, size) > textW && rest.length > 1) {
					let n = rest.length - 1;
					while (n > 1 && font.widthOfTextAtSize(rest.slice(0, n), size) > textW) n--;
					out.push({ text: rest.slice(0, n), font, w: font.widthOfTextAtSize(rest.slice(0, n), size), space: false });
					rest = rest.slice(n);
				}
				out.push({ text: rest, font, w: font.widthOfTextAtSize(rest, size), space: false });
			}
		}
		return out;
	};
	const spaceW = F.r.widthOfTextAtSize(' ', size);

	/** A paragraph: justified lines; an indent, or a decorative first letter on a chapter's opening. */
	const paragraph = (runs: Run[], o: { first: boolean; opening: boolean; italic?: boolean; inset?: number }) => {
		const inset = o.inset ?? 0;
		let ws = words(runs, o.italic ? 'i' : 'r');
		if (!ws.length) return;
		let dropLines = 0;
		let dropW = 0;
		if (o.opening && st.dropCap && ws[0]) {
			// The first letter, large and in the accent colour, beside the first lines.
			const first = ws[0];
			const letter = first.text[0]!;
			const dsz = size * 3.1;
			const df = F.r;
			dropW = df.widthOfTextAtSize(letter, dsz) + size * 0.25;
			dropLines = 3;
			ensure(lead * dropLines);
			page.drawText(letter, { x: side + inset, y: y - dsz * 0.72, size: dsz, font: df, color: accent });
			const restText = first.text.slice(1);
			ws = restText ? [{ ...first, text: restText, w: first.font.widthOfTextAtSize(restText, size) }, ...ws.slice(1)] : ws.slice(1);
		}
		const indent = st.indent && !o.first ? size * 1.5 : 0;
		let lineNo = 0;
		let i = 0;
		while (i < ws.length) {
			const left = side + inset + (lineNo < dropLines ? dropW : 0) + (lineNo === 0 ? indent : 0);
			const avail = textW - inset * 2 - (left - side - inset);
			const line: Word[] = [];
			let used = 0;
			while (i < ws.length) {
				const wd = ws[i]!;
				const add = (line.length ? spaceW : 0) + wd.w;
				if (line.length && used + add > avail) break;
				line.push(wd);
				used += add;
				i++;
			}
			ensure(lead);
			const last = i >= ws.length;
			const gaps = line.length - 1;
			// Justified, unless that would open wide gaps (then the line is left as it is).
			const stretch = !last && gaps > 0 ? (avail - used) / gaps : 0;
			const extra = stretch > spaceW * 2.5 ? 0 : stretch;
			let x = left;
			for (const wd of line) {
				page.drawText(wd.text, { x, y: y - size, size, font: wd.font, color: ink });
				x += wd.w + spaceW + extra;
			}
			y -= lead;
			lineNo++;
		}
		if (dropLines && lineNo < dropLines) y -= lead * (dropLines - lineNo);
		if (!st.indent) y -= size * 0.6;
	};

	let afterHeading = true;
	let opening = false;
	let started = false;
	for (const b of blocks) {
		if (b.t === 'title') {
			newPage(false);
			let cy = H * 0.62;
			if (st.ornaments) {
				const aw = size * 1.6;
				const ah = size * 2;
				page.drawSvgPath(`M 0 0 L 0 ${-ah + aw / 2} A ${aw / 2} ${aw / 2} 0 0 1 ${aw} ${-ah + aw / 2} L ${aw} 0 Z`, { x: (W - aw) / 2, y: cy + ah + size * 1.2, borderColor: accent, borderWidth: 0.8 });
			}
			if (opts.subtitle) {
				centered(opts.subtitle.toUpperCase(), F.r, size * 0.7, accent, cy);
				cy -= size * 2;
			}
			const tsz = size * 2.6;
			for (const l of wrapPlain(b.title, F.r, tsz, textW)) {
				centered(l, F.r, tsz, ink, cy - tsz * 0.8);
				cy -= tsz * 1.15;
			}
			if (b.author) centered(b.author.toUpperCase(), F.r, size * 0.95, ink, cy - size * 1.6);
			started = false;
			afterHeading = true;
		} else if (b.t === 'matter') {
			if (b.kind === 'dedication' || b.kind === 'epigraph') {
				newPage(false);
				let cy = H * 0.65;
				for (const l of wrapPlain(b.text, F.i, size, textW * 0.8)) {
					centered(l, F.i, size, ink, cy);
					cy -= lead;
				}
				if (b.by) centered(`— ${b.by}`, F.r, size, muted, cy - size * 0.4);
				started = false;
			} else {
				newPage(true);
				y -= size * 4;
				centered(b.kind === 'acknowledgements' ? 'Acknowledgements' : 'About the author', F.r, size * 1.9, ink, y - size * 1.9);
				y -= size * 4.5;
				for (const [k, para] of b.text.split(/\n\s*\n/).entries()) paragraph([{ text: para.trim() }], { first: k === 0, opening: false });
				started = true;
			}
			afterHeading = true;
		} else if (b.t === 'part') {
			newPage(false);
			let cy = H * 0.58;
			for (const l of wrapPlain(b.text, F.r, size * 1.9, textW)) {
				centered(l, F.r, size * 1.9, ink, cy);
				cy -= size * 2.3;
			}
			started = false;
			afterHeading = true;
		} else if (b.t === 'chapter') {
			newPage(true);
			y -= size * 3;
			const mm = /^(Chapter [^:]+)(?::\s*(.+))?$/.exec(b.text);
			if (mm) {
				centered(mm[1]!.toUpperCase(), F.b, size * 0.7, accent, y - size * 0.7);
				y -= size * 1.6;
			}
			const title = mm ? (mm[2] ?? '') : b.text;
			for (const l of wrapPlain(title, F.r, size * 1.9, textW)) {
				centered(l, F.r, size * 1.9, ink, y - size * 1.9);
				y -= size * 2.3;
			}
			if (st.ornaments) {
				diamond(W / 2, y - size * 0.7, size * 0.28);
				y -= size * 1.6;
			}
			y -= size * 1.6;
			started = true;
			afterHeading = true;
			opening = true;
		} else if (b.t === 'scene' || b.t === 'h') {
			if (!started) {
				newPage(true);
				started = true;
			}
			ensure(lead * 3);
			y -= size * 0.8;
			for (const l of wrapPlain(b.text, F.i, size * 1.15, textW)) {
				page.drawText(l, { x: side, y: y - size * 1.15, size: size * 1.15, font: F.i, color: ink });
				y -= size * 1.15 * 1.4;
			}
			y -= size * 0.4;
			afterHeading = true;
		} else if (b.t === 'sep') {
			if (!started) {
				newPage(true);
				started = true;
			}
			ensure(lead * 2);
			y -= size * 0.6;
			const t = opts.separator === '⁂' ? '* * *' : opts.separator;
			if (t) centered(t, F.r, size, accent, y - size);
			y -= lead + size * 0.6;
			afterHeading = true;
		} else if (b.t === 'quote') {
			if (!started) {
				newPage(true);
				started = true;
			}
			y -= size * 0.4;
			paragraph(b.runs, { first: true, opening: false, italic: true, inset: size * 2 });
			y -= size * 0.4;
		} else if (b.t === 'p') {
			if (!started) {
				newPage(true);
				started = true;
			}
			paragraph(b.runs, { first: afterHeading, opening });
			afterHeading = false;
			opening = false;
		}
	}
	if (!pageNo) newPage(false);
	void numbered;
	return doc.save();
}
