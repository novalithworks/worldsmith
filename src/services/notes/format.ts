import { hash32 } from '../../core/util/ids';

/**
 * Native note format (0.17), pure: no Obsidian, no DOM.
 *
 * Worldsmith owns two things in a note and nothing else:
 *  - a handful of front-matter keys (its identity keys and one property per short field),
 *    edited line by line so every other line of the front matter stays byte-for-byte;
 *  - the regions between its markers, one marker per line:
 *        %% ws-start view:<id> %%   …generated…   %% ws-end <id> %%
 *        %% ws-start field:<id> %%  ## Label / the field's text  %% ws-end <id> %%
 * Markers inside code fences are ignored. A region with a missing, nested or duplicate
 * marker is "broken": it is reported and never written.
 */

export type RegionKind = 'view' | 'field';

export interface Region {
	kind: RegionKind;
	id: string;
	/** Offset of the start marker line. */
	outerStart: number;
	/** Offset just past the end marker line (before its line break). */
	outerEnd: number;
	/** Offset of the first content line (after the start marker's line break). */
	innerStart: number;
	/** Offset of the end marker line. */
	innerEnd: number;
	/** Text between the markers, without the final line break. */
	content: string;
}

export interface ParsedNote {
	eol: string;
	/** Front matter block (`---` … `---`), or null. */
	frontMatter: { start: number; end: number; yamlStart: number; yamlEnd: number; yaml: string } | null;
	regions: Region[];
	/** Ids of broken regions. */
	broken: string[];
}

const START = /^%%\s*ws-start\s+(view|field):([A-Za-z0-9_.-]+)(?:\s[^\n]*?)?\s*%%\s*$/;
const END = /^%%\s*ws-end\s+([A-Za-z0-9_.-]+)\s*%%\s*$/;
const FENCE = /^ {0,3}(`{3,}|~{3,})(.*)$/;

/** An open code fence: its character and length (CommonMark). */
export interface Fence {
	ch: string;
	len: number;
}

/** The fence a line opens, or null. A backtick fence's info string can't hold a backtick. */
export function fenceOpen(line: string): Fence | null {
	const m = FENCE.exec(line);
	if (!m) return null;
	const ch = m[1]![0]!;
	if (ch === '`' && m[2]!.includes('`')) return null;
	return { ch, len: m[1]!.length };
}

/** Whether a line closes an open fence: the same character, at least as long, nothing after. */
export function fenceCloses(open: Fence, line: string): boolean {
	const m = FENCE.exec(line);
	return !!m && m[1]![0] === open.ch && m[1]!.length >= open.len && !m[2]!.trim();
}

/** Stable short hash of a text, ignoring line-break style and blank lines around it. */
export function hashText(text: string): string {
	return hash32(normalizeText(text)).toString(36);
}

/**
 * Hash of a generated section that ignores where its links point: when a note is renamed
 * or moved, Obsidian updates links everywhere, which isn't an edit by the person.
 */
export function hashView(text: string): string {
	// Wikilinks count as one token: Obsidian rewrites their targets (and, after a quick
	// rename back and forth, their text) when notes move. Embeds stay as they are.
	const t = text.replace(/(!?)\[\[([^\]|]*?)(?:\\?\|([^\]]*))?\]\]/g, (m: string, bang: string) => (bang ? m : '[[]]'));
	return hashText(t);
}

/**
 * Line breaks as `\n`, whitespace-only lines emptied, blank lines around the text dropped.
 * Trailing spaces on a line with text are kept: two of them are a Markdown line break.
 */
export function normalizeText(text: string): string {
	return text.replace(/\r\n?/g, '\n').replace(/^[ \t]+$/gm, '').replace(/^\n+|\n+$/g, '');
}

interface Line {
	start: number;
	/** End offset excluding the line break. */
	end: number;
	text: string;
}

function lines(text: string): Line[] {
	const out: Line[] = [];
	let i = 0;
	while (i <= text.length) {
		let j = text.indexOf('\n', i);
		if (j === -1) j = text.length;
		const end = j > i && text[j - 1] === '\r' ? j - 1 : j;
		out.push({ start: i, end, text: text.slice(i, end) });
		if (j === text.length) break;
		i = j + 1;
	}
	return out;
}

export function detectEol(text: string): string {
	return text.includes('\r\n') ? '\r\n' : '\n';
}

export function parseNote(text: string): ParsedNote {
	const eol = detectEol(text);
	const ls = lines(text);
	let first = 0;
	let frontMatter: ParsedNote['frontMatter'] = null;
	const l0 = ls[0]?.text.replace(/^\uFEFF/, '');
	if (l0 !== undefined && /^---\s*$/.test(l0)) {
		for (let k = 1; k < ls.length; k++) {
			if (/^(---|\.\.\.)\s*$/.test(ls[k]!.text)) {
				const yamlStart = ls[1]!.start;
				const yamlEnd = k > 1 ? ls[k]!.start : yamlStart;
				frontMatter = { start: ls[0]!.start, end: ls[k]!.end, yamlStart, yamlEnd, yaml: text.slice(yamlStart, yamlEnd) };
				first = k + 1;
				break;
			}
		}
	}
	const regions: Region[] = [];
	const broken = new Set<string>();
	const seen = new Set<string>();
	let open: { kind: RegionKind; id: string; line: Line } | null = null;
	let fence: Fence | null = null;
	/** The open fence started inside the open region: that region's own end marker still ends it. */
	let fenceInRegion = false;
	for (let k = first; k < ls.length; k++) {
		const ln = ls[k]!;
		if (fence) {
			if (fenceCloses(fence, ln.text)) {
				fence = null;
				continue;
			}
			const e = fenceInRegion && open ? END.exec(ln.text) : null;
			if (!e || e[1] !== open!.id) continue;
			fence = null;
		} else {
			const f = fenceOpen(ln.text);
			if (f) {
				fence = f;
				fenceInRegion = !!open;
				continue;
			}
		}
		const s = START.exec(ln.text);
		if (s) {
			if (open) broken.add(open.id);
			open = { kind: s[1] as RegionKind, id: s[2]!, line: ln };
			continue;
		}
		const e = END.exec(ln.text);
		if (e) {
			const id = e[1]!;
			if (!open || open.id !== id) {
				broken.add(id);
				if (open) broken.add(open.id);
				open = null;
				continue;
			}
			const innerStart = Math.min(text.length, open.line.end + (text[open.line.end] === '\r' ? 2 : 1));
			const innerEnd = ln.start;
			let content = innerEnd > innerStart ? text.slice(innerStart, innerEnd) : '';
			content = content.replace(/\r?\n$/, '');
			if (seen.has(id)) broken.add(id);
			seen.add(id);
			regions.push({ kind: open.kind, id, outerStart: open.line.start, outerEnd: ln.end, innerStart, innerEnd: Math.max(innerStart, innerEnd), content });
			open = null;
		}
	}
	if (open) broken.add(open.id);
	return { eol, frontMatter, regions: regions.filter((r) => !broken.has(r.id)), broken: [...broken] };
}

export function startMarker(kind: RegionKind, id: string, note = ''): string {
	return `%% ws-start ${kind}:${id}${note ? ' ' + note : ''} %%`;
}

export function endMarker(id: string): string {
	return `%% ws-end ${id} %%`;
}

/** A whole region: markers and content. */
export function regionBlock(kind: RegionKind, id: string, content: string, eol = '\n', note = ''): string {
	const body = toEol(content, eol);
	return [startMarker(kind, id, note), ...(body ? [body] : []), endMarker(id)].join(eol);
}

function toEol(text: string, eol: string): string {
	return text.replace(/\r\n?/g, '\n').replace(/\n/g, eol);
}

/** Replace the inside of one region; the markers and everything else stay as they are. */
export function replaceRegionContent(text: string, region: Region, content: string): string {
	const eol = detectEol(text);
	const body = toEol(content, eol);
	return text.slice(0, region.innerStart) + (body ? body + eol : '') + text.slice(region.innerEnd);
}

/** Insert a region after another one, before one, after the front matter, or at the end. */
export function insertRegion(text: string, block: string, where: { after: Region } | { before: Region } | 'top' | 'end'): string {
	const eol = detectEol(text);
	const b = toEol(block, eol);
	if (where === 'end') {
		const trimmed = text.replace(/(\r?\n)*$/, '');
		return (trimmed ? trimmed + eol + eol : '') + b + eol;
	}
	if (where === 'top') {
		const fm = parseNote(text).frontMatter;
		const at = fm ? fm.end : 0;
		const head = text.slice(0, at);
		let rest = text.slice(at);
		if (fm) rest = rest.replace(/^\r?\n/, '');
		const sep = rest.replace(/^(\r?\n)+/, '') ? eol + eol : eol;
		return (fm ? head + eol + eol : '') + b + sep + rest.replace(/^(\r?\n)+/, '');
	}
	if ('after' in where) return text.slice(0, where.after.outerEnd) + eol + eol + b + text.slice(where.after.outerEnd);
	return text.slice(0, where.before.outerStart) + b + eol + eol + text.slice(where.before.outerStart);
}

/** Remove a whole region and the blank line after it. */
export function removeRegion(text: string, region: Region): string {
	let end = region.outerEnd;
	const m = /^(\r?\n){1,2}/.exec(text.slice(end));
	if (m) end += m[0].length;
	return text.slice(0, region.outerStart) + text.slice(end);
}

// ── field sections ─────────────────────────────────────────────────────────────

const MARKERISH = /^(\\*)(%%\s*ws-(?:start|end)\b)/;

/**
 * A field's text as it is written inside its section: a code block left open is closed (so
 * it can't swallow the rest of the note), and a line that looks like a Worldsmith marker
 * gets a backslash in front (taken off again when read back).
 */
export function safeFieldBody(text: string): string {
	const ls = normalizeText(text).split('\n');
	let fence: Fence | null = null;
	const out = ls.map((l) => {
		if (fence) {
			if (fenceCloses(fence, l)) fence = null;
			// Inside a code block too: the region's own end marker would end it there.
			else return l.replace(MARKERISH, '\\$1$2');
			return l;
		}
		const f = fenceOpen(l);
		if (f) {
			fence = f;
			return l;
		}
		return l.replace(MARKERISH, '\\$1$2');
	});
	if (fence) out.push((fence as Fence).ch.repeat((fence as Fence).len));
	return out.join('\n');
}

function unescapeMarkers(text: string): string {
	return text.replace(/^\\(\\*%%\s*ws-(?:start|end)\b)/gm, '$1');
}

/** A field section: its managed heading line, then the field's text. */
export function fieldContent(label: string, text: string, level = 2): string {
	const head = label ? `${'#'.repeat(level)} ${label}` : '';
	const body = normalizeText(text) ? safeFieldBody(text) : '';
	return [head, body].filter(Boolean).join('\n\n');
}

/**
 * The field's text inside a field section. Only the managed heading is dropped: a first line
 * at the managed level whose text is the field's label (or the label last written there).
 * Any other first heading is the person's own text and is kept.
 */
export function fieldText(content: string, managed?: { level: number; labels: string[] }): string {
	const c = content.replace(/\r\n?/g, '\n').replace(/^(?:[ \t]*\n)+/, '');
	const m = /^(#{1,6})[ \t]+([^\n]*?)[ \t]*(?:\n|$)/.exec(c);
	const isManaged = !!m && (!managed || (m[1]!.length === managed.level && managed.labels.some((l) => l.trim() === m[2]!.replace(/[ \t]+#+$/, '').trim())));
	return normalizeText(unescapeMarkers(isManaged ? c.slice(m[0].length) : c));
}

/** The summary is a quote; one level of `> ` is taken off when read back. */
export function quoteContent(text: string): string {
	const t = normalizeText(text);
	return t ? t.split('\n').map((l) => (l.trim() ? `> ${l}` : '>')).join('\n') : '';
}

export function unquote(content: string): string {
	const t = normalizeText(content);
	const ls = t.split('\n');
	if (!ls.every((l) => !l.trim() || /^\s*>/.test(l))) return t;
	return normalizeText(ls.map((l) => l.replace(/^\s*> ?/, '')).join('\n'));
}

// ── front matter, line by line ─────────────────────────────────────────────────

const KEY_LINE = /^(?:"((?:[^"\\]|\\.)*)"|'((?:[^']|'')*)'|([^\s#'"-][^:]*?|-[^\s:][^:]*?))\s*:(?:\s|$)/;

/** Top-level keys of a YAML block and the lines each spans. */
export function frontMatterKeys(yaml: string): Array<{ key: string; start: number; end: number }> {
	const out: Array<{ key: string; start: number; end: number }> = [];
	const ls = lines(yaml);
	let cur: { key: string; start: number; end: number } | null = null;
	for (const ln of ls) {
		if (ln.start === yaml.length && ln.text === '') break;
		const top = ln.text && !/^[\s]/.test(ln.text) && !ln.text.startsWith('#') && !ln.text.startsWith('- ') && ln.text !== '-';
		const m = top ? KEY_LINE.exec(ln.text) : null;
		if (m) {
			if (cur) out.push(cur);
			const key = m[1] !== undefined ? m[1].replace(/\\(.)/g, '$1') : m[2] !== undefined ? m[2].replace(/''/g, "'") : m[3]!.trim();
			cur = { key, start: ln.start, end: lineEndWithBreak(yaml, ln) };
		} else if (cur && (ln.text === '' || /^\s/.test(ln.text) || ln.text.startsWith('- ') || ln.text === '-')) {
			cur.end = lineEndWithBreak(yaml, ln);
		} else if (cur) {
			out.push(cur);
			cur = null;
		}
	}
	if (cur) out.push(cur);
	// Blank lines after a key belong to the gap, not to the key.
	for (const k of out) {
		const block = yaml.slice(k.start, k.end);
		const trimmed = block.replace(/(\r?\n[ \t]*)+$/, '');
		const tail = /\r?\n$/.exec(block) ? (block.slice(trimmed.length).match(/^\r?\n/)?.[0] ?? '') : '';
		k.end = k.start + trimmed.length + tail.length;
	}
	return out;
}

function lineEndWithBreak(text: string, ln: Line): number {
	if (ln.end >= text.length) return ln.end;
	return text[ln.end] === '\r' ? ln.end + 2 : ln.end + 1;
}

const PLAIN_SAFE = /^[^\s\-?:,[\]{}#&*!|>'"%@`][^#]*$/;

/** A YAML scalar Obsidian reads back as the same value. */
export function yamlScalar(v: unknown, opts: { bareDate?: boolean } = {}): string {
	if (v === null || v === undefined) return '';
	if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '';
	if (typeof v === 'boolean') return v ? 'true' : 'false';
	const s = String(v);
	if (opts.bareDate && /^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
	const ambiguous = /^(true|false|yes|no|on|off|null|~|y|n)$/i.test(s) || /^[-+]?(\d[\d_]*(\.\d*)?|\.\d+)([eE][-+]?\d+)?$/.test(s) || /^0[xo]/i.test(s) || /^\d{4}-\d{2}-\d{2}/.test(s) || /:\s|\s#|:$/.test(s);
	if (!ambiguous && PLAIN_SAFE.test(s) && s === s.trim() && !s.includes('\n')) return s;
	return JSON.stringify(s);
}

function yamlKey(key: string): string {
	return /^[A-Za-z0-9_][A-Za-z0-9 _.\-/()’']*$/.test(key) && !/:\s|\s$/.test(key) && !/^(true|false|null|yes|no)$/i.test(key) ? key : JSON.stringify(key);
}

/** The lines for one key (no trailing line break). */
export function yamlEntry(key: string, value: unknown, eol = '\n', opts: { bareDate?: boolean } = {}): string {
	const k = yamlKey(key);
	if (Array.isArray(value)) {
		if (!value.length) return `${k}: []`;
		return [`${k}:`, ...value.map((x) => `  - ${yamlScalar(x, opts)}`)].join(eol);
	}
	const s = yamlScalar(value, opts);
	return s ? `${k}: ${s}` : `${k}:`;
}

/**
 * Set or remove top-level keys of a note's front matter. Lines of every other key, comments
 * and blank lines are kept exactly. A key set to `undefined` is removed. Creates the front
 * matter when the note has none.
 */
export function setFrontMatter(text: string, entries: Array<{ key: string; value: unknown; bareDate?: boolean }>): string {
	if (!entries.length) return text;
	const eol = detectEol(text);
	const p = parseNote(text);
	if (!p.frontMatter) {
		const add = entries.filter((e) => e.value !== undefined).map((e) => yamlEntry(e.key, e.value, eol, e));
		if (!add.length) return text;
		const bom = text.startsWith('\uFEFF') ? '\uFEFF' : '';
		return `${bom}---${eol}${add.join(eol)}${eol}---${eol}${text.slice(bom.length)}`;
	}
	let yaml = p.frontMatter.yaml;
	const appended: string[] = [];
	for (const e of entries) {
		const found = frontMatterKeys(yaml).find((k) => k.key === e.key);
		if (e.value === undefined) {
			if (found) yaml = yaml.slice(0, found.start) + yaml.slice(found.end);
			continue;
		}
		const line = yamlEntry(e.key, e.value, eol, e);
		if (found) {
			const old = yaml.slice(found.start, found.end);
			const br = /\r?\n$/.exec(old)?.[0] ?? '';
			yaml = yaml.slice(0, found.start) + line + br + yaml.slice(found.end);
		} else appended.push(line);
	}
	if (appended.length) {
		if (yaml && !/\n$/.test(yaml)) yaml += eol;
		yaml += appended.join(eol) + eol;
	}
	return text.slice(0, p.frontMatter.yamlStart) + yaml + text.slice(p.frontMatter.yamlEnd);
}

/**
 * Rename top-level front-matter keys. Only the key on its first line changes: the value, the
 * lines below it and every other key stay byte-for-byte. A key that isn't there is skipped.
 */
export function renameFrontMatterKeys(text: string, renames: Array<{ from: string; to: string }>): string {
	const p = parseNote(text);
	if (!p.frontMatter || !renames.length) return text;
	let yaml = p.frontMatter.yaml;
	// All at once, from the original positions (so two keys can swap names).
	const keys = frontMatterKeys(yaml);
	const edits: Array<{ at: number; len: number; to: string }> = [];
	for (const r of renames) {
		const found = keys.find((k) => k.key === r.from);
		if (!found) continue;
		const line = /^[^\r\n]*/.exec(yaml.slice(found.start))![0];
		const m = KEY_LINE.exec(line);
		if (!m) continue;
		edits.push({ at: found.start, len: m[0].replace(/\s*:\s?$/, '').length, to: yamlKey(r.to) });
	}
	for (const e of edits.sort((a, b) => b.at - a.at)) yaml = yaml.slice(0, e.at) + e.to + yaml.slice(e.at + e.len);
	return text.slice(0, p.frontMatter.yamlStart) + yaml + text.slice(p.frontMatter.yamlEnd);
}

/**
 * A small YAML reader for front matter (top-level keys, scalars, block and flow lists).
 * Obsidian's own parser is used in the app; this one serves tests and the harness.
 */
export function parseSimpleYaml(yaml: string): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	for (const k of frontMatterKeys(yaml)) {
		const block = yaml.slice(k.start, k.end).replace(/\r/g, '');
		const [first, ...rest] = block.split('\n');
		const m = KEY_LINE.exec(first!);
		const after = (m ? first!.slice(m[0].length) : first!.slice(first!.indexOf(':') + 1)).trim();
		const items = rest.map((l) => /^\s*-\s?(.*)$/.exec(l)?.[1]).filter((x): x is string => x !== undefined);
		if (!after && items.length) out[k.key] = items.map((x) => scalar(x.trim()));
		else if (after.startsWith('[') && after.endsWith(']')) {
			const inner = after.slice(1, -1).trim();
			out[k.key] = inner ? splitFlow(inner).map((x) => scalar(x.trim())) : [];
		} else out[k.key] = after ? scalar(after) : null;
	}
	return out;
}

function splitFlow(s: string): string[] {
	const out: string[] = [];
	let cur = '';
	let q: string | null = null;
	for (const ch of s) {
		if (q) {
			cur += ch;
			if (ch === q) q = null;
		} else if (ch === '"' || ch === "'") {
			q = ch;
			cur += ch;
		} else if (ch === ',') {
			out.push(cur);
			cur = '';
		} else cur += ch;
	}
	out.push(cur);
	return out;
}

function scalar(s: string): unknown {
	if (s.startsWith('"')) {
		try {
			return JSON.parse(s) as unknown;
		} catch {
			return s.slice(1, -1);
		}
	}
	if (s.startsWith("'")) return s.slice(1, -1).replace(/''/g, "'");
	const c = s.replace(/\s+#.*$/, '');
	if (/^(true|false)$/i.test(c)) return c.toLowerCase() === 'true';
	if (/^(null|~)$/i.test(c) || c === '') return null;
	if (/^[-+]?(\d+(\.\d*)?|\.\d+)([eE][-+]?\d+)?$/.test(c)) return Number(c);
	return c;
}
