/*
 * The writing toolbar's formatting, done through Obsidian's Editor API (so it goes through
 * the editor's own undo history and is saved by Obsidian like typing). Pure functions over
 * the few editor methods they need, so they are tested without Obsidian.
 */

export interface Pos {
	line: number;
	ch: number;
}

/** The part of Obsidian's `Editor` the toolbar uses. */
export interface TextEditor {
	getCursor(which?: 'from' | 'to' | 'head' | 'anchor'): Pos;
	getLine(line: number): string;
	lineCount(): number;
	getSelection(): string;
	somethingSelected(): boolean;
	getRange(from: Pos, to: Pos): string;
	replaceRange(text: string, from: Pos, to?: Pos): void;
	replaceSelection(text: string): void;
	setSelection(anchor: Pos, head?: Pos): void;
	setCursor(pos: Pos): void;
}

export type InlineMark = '**' | '*';

/** Does `text` carry `mark` at both ends (and only that mark, for italics)? */
export function hasMark(text: string, mark: InlineMark): boolean {
	if (text.length < mark.length * 2) return false;
	if (!text.startsWith(mark) || !text.endsWith(mark)) return false;
	if (mark === '*') {
		// "**bold**" is not italic; "***both***" is.
		const bold = text.startsWith('**') && text.endsWith('**');
		const both = text.startsWith('***') && text.endsWith('***');
		return !bold || both;
	}
	return true;
}

/** Bold or italic on and off: the selection, or a pair of marks at the cursor to type between. */
export function toggleMark(ed: TextEditor, mark: InlineMark): void {
	const from = ed.getCursor('from');
	const to = ed.getCursor('to');
	const n = mark.length;
	if (!ed.somethingSelected()) {
		const line = ed.getLine(from.line);
		// Between an empty pair ("**|**"): take it away again.
		if (line.slice(from.ch - n, from.ch) === mark && line.slice(from.ch, from.ch + n) === mark && (mark === '**' || (line[from.ch - n - 1] !== '*' && line[from.ch + n] !== '*'))) {
			ed.replaceRange('', { line: from.line, ch: from.ch - n }, { line: from.line, ch: from.ch + n });
			ed.setCursor({ line: from.line, ch: from.ch - n });
			return;
		}
		ed.replaceRange(mark + mark, from);
		ed.setCursor({ line: from.line, ch: from.ch + n });
		return;
	}
	const text = ed.getSelection();
	// The selection includes the marks: take them off.
	if (hasMark(text, mark)) {
		ed.replaceSelection(text.slice(n, text.length - n));
		const end = shift(from, text.slice(n, text.length - n));
		ed.setSelection(from, end);
		return;
	}
	// The marks sit just outside the selection: take them off.
	if (from.ch >= n && from.line === to.line) {
		const line = ed.getLine(from.line);
		const before = line.slice(from.ch - n, from.ch);
		const after = line.slice(to.ch, to.ch + n);
		const outer = line.slice(from.ch - n, to.ch + n);
		if (before === mark && after === mark && hasMark(outer, mark)) {
			ed.replaceRange(text, { line: from.line, ch: from.ch - n }, { line: to.line, ch: to.ch + n });
			ed.setSelection({ line: from.line, ch: from.ch - n }, { line: to.line, ch: to.ch - n });
			return;
		}
	}
	// Marks go inside any spaces at the ends ("** word**" is not bold in Markdown).
	const lead = /^\s*/.exec(text)?.[0] ?? '';
	const trail = /\s*$/.exec(text.slice(lead.length))?.[0] ?? '';
	const core = text.slice(lead.length, text.length - trail.length);
	if (!core) return;
	ed.replaceSelection(`${lead}${mark}${core}${mark}${trail}`);
	const start = shift(from, lead + mark);
	ed.setSelection(start, shift(start, core));
}

/** The position after `text` is inserted at `at`. */
export function shift(at: Pos, text: string): Pos {
	const lines = text.split('\n');
	if (lines.length === 1) return { line: at.line, ch: at.ch + text.length };
	return { line: at.line + lines.length - 1, ch: lines[lines.length - 1]!.length };
}

/** The lines the selection touches (a selection ending at the start of a line leaves that line out). */
function lineSpan(ed: TextEditor): [number, number] {
	const from = ed.getCursor('from');
	const to = ed.getCursor('to');
	const last = to.line > from.line && to.ch === 0 ? to.line - 1 : to.line;
	return [from.line, last];
}

/** Replace whole lines at once (one change, one undo step) and select them. */
function rewriteLines(ed: TextEditor, first: number, last: number, map: (line: string) => string): void {
	const old: string[] = [];
	for (let i = first; i <= last; i++) old.push(ed.getLine(i));
	const next = old.map(map);
	const end = { line: last, ch: old[old.length - 1]!.length };
	ed.replaceRange(next.join('\n'), { line: first, ch: 0 }, end);
	if (first === last) {
		// Keep the cursor at the end of the line it was on.
		ed.setCursor({ line: first, ch: next[0]!.length });
	} else ed.setSelection({ line: first, ch: 0 }, { line: last, ch: next[next.length - 1]!.length });
}

const HEADING = /^(#{1,6})\s+/;

/** The heading level of a line (0 = not a heading). */
export function headingOf(line: string): number {
	return HEADING.exec(line)?.[1]?.length ?? 0;
}

/** Make the selected lines headings of `level` (0 = normal text). */
export function setHeading(ed: TextEditor, level: number): void {
	const [first, last] = lineSpan(ed);
	const n = Math.max(0, Math.min(6, Math.round(level)));
	rewriteLines(ed, first, last, (l) => {
		const body = l.replace(HEADING, '');
		if (!n) return body;
		return body.trim() || first === last ? `${'#'.repeat(n)} ${body}` : body;
	});
}

export type LineKind = 'bullet' | 'quote';
const PREFIX: Record<LineKind, RegExp> = { bullet: /^(\s*)[-*+]\s+/, quote: /^>\s?/ };
const ADD: Record<LineKind, string> = { bullet: '- ', quote: '> ' };

/** A bulleted list or a quote on and off for the selected lines. */
export function toggleLines(ed: TextEditor, kind: LineKind): void {
	const [first, last] = lineSpan(ed);
	const lines: string[] = [];
	for (let i = first; i <= last; i++) lines.push(ed.getLine(i));
	const filled = lines.filter((l) => l.trim());
	const on = filled.length > 0 && filled.every((l) => PREFIX[kind].test(l));
	rewriteLines(ed, first, last, (l) => {
		if (on) return l.replace(PREFIX[kind], kind === 'bullet' ? '$1' : '');
		if (!l.trim() && first !== last) return l;
		return PREFIX[kind].test(l) ? l : ADD[kind] + l;
	});
}

/** A scene break: "* * *" as its own paragraph, with the cursor on a new line after it. */
export const SCENE_BREAK = '* * *';

export function insertSceneBreak(ed: TextEditor): void {
	const at = ed.getCursor('to');
	const text = ed.getLine(at.line);
	const lastLine = ed.lineCount() - 1;
	if (!text.trim()) {
		const prevBlank = at.line === 0 || !ed.getLine(at.line - 1).trim();
		const nextExists = at.line < lastLine;
		const nextBlank = nextExists && !ed.getLine(at.line + 1).trim();
		const ins = `${prevBlank ? '' : '\n'}${SCENE_BREAK}\n\n${nextExists && !nextBlank ? '\n' : ''}`;
		ed.replaceRange(ins, { line: at.line, ch: 0 }, { line: at.line, ch: text.length });
		ed.setCursor({ line: at.line + (prevBlank ? 2 : 3), ch: 0 });
		return;
	}
	// At the end of a paragraph (or in the middle of one: it is split there).
	const head = text.slice(0, at.ch).replace(/\s+$/, '');
	const tail = text.slice(at.ch).replace(/^\s+/, '');
	if (!head) {
		ed.replaceRange(`${SCENE_BREAK}\n\n`, { line: at.line, ch: 0 }, { line: at.line, ch: at.ch });
		ed.setCursor({ line: at.line + 2, ch: 0 });
		return;
	}
	ed.replaceRange(`${head}\n\n${SCENE_BREAK}\n\n${tail}`, { line: at.line, ch: 0 }, { line: at.line, ch: text.length });
	ed.setCursor({ line: at.line + 4, ch: 0 });
}
