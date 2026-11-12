import type { CalendarPattern } from '../types/calendar';

/**
 * Dates written your own way (0.11.1): a pattern of words and {tokens}, like
 * "{weekday}, the {day-th} of {month}, {year} {era}". One pattern for full dates; the
 * month-only and year-only versions are worked out from it unless written by hand.
 */

export type DateToken = 'weekday' | 'day' | 'day-th' | 'day-words' | 'month' | 'month-short' | 'month-number' | 'year' | 'year-roman' | 'era' | 'era-name';

export const DATE_TOKENS: Array<{ id: DateToken; label: string; hint: string }> = [
	{ id: 'weekday', label: 'Weekday', hint: 'The day of the week' },
	{ id: 'day', label: 'Day', hint: 'The day as a number' },
	{ id: 'day-th', label: 'Day (14th)', hint: 'The day with st, nd, rd or th' },
	{ id: 'day-words', label: 'Day in words', hint: 'Fourteenth, twenty-first…' },
	{ id: 'month', label: 'Month', hint: 'The month’s name (or the festival’s)' },
	{ id: 'month-short', label: 'Short month', hint: 'The month’s short name' },
	{ id: 'month-number', label: 'Month number', hint: 'The month as a number' },
	{ id: 'year', label: 'Year', hint: 'The year within its era' },
	{ id: 'year-roman', label: 'Year (CCCXII)', hint: 'The year in Roman numerals' },
	{ id: 'era', label: 'Era', hint: 'The era’s short form' },
	{ id: 'era-name', label: 'Era name', hint: 'The era’s full name' },
];

const TOKEN_IDS = new Set<string>(DATE_TOKENS.map((t) => t.id));
const DAY_TOKENS = new Set<string>(['weekday', 'day', 'day-th', 'day-words']);
const MONTH_TOKENS = new Set<string>(['month', 'month-short', 'month-number']);

type Piece = { lit: string } | { tok: DateToken };

export function tokenize(pattern: string): Piece[] {
	const out: Piece[] = [];
	const re = /\{([a-z-]+)\}/g;
	let at = 0;
	for (let m = re.exec(pattern); m; m = re.exec(pattern)) {
		if (!TOKEN_IDS.has(m[1]!)) continue;
		if (m.index > at) out.push({ lit: pattern.slice(at, m.index) });
		out.push({ tok: m[1] as DateToken });
		at = m.index + m[0].length;
	}
	if (at < pattern.length) out.push({ lit: pattern.slice(at) });
	return out;
}

const join = (ps: Piece[]) => ps.map((p) => ('tok' in p ? `{${p.tok}}` : p.lit)).join('');
const hasLetters = (s: string) => /\p{L}/u.test(s);

/**
 * The pattern without some tokens, taking their words along: "the {day-th} of {month}" →
 * "{month}"; "{year}.{month-number}.{day}" → "{year}.{month-number}".
 */
function without(pattern: string, drop: Set<string>): string {
	const ps = tokenize(pattern);
	for (let i = 0; i < ps.length; i++) {
		const p = ps[i]!;
		if (!('tok' in p) || !drop.has(p.tok)) continue;
		const prev = ps[i - 1];
		const next = ps[i + 1];
		const prevLit = prev && 'lit' in prev ? prev : null;
		const nextLit = next && 'lit' in next ? next : null;
		const kill = new Set<number>([i]);
		if (prevLit && nextLit) {
			if (!hasLetters(prevLit.lit)) kill.add(i - 1);
			else {
				kill.add(i + 1);
				// Words that lead into it ("the 14th of…") go too when it opens the pattern.
				if (hasLetters(prevLit.lit) && i - 1 === 0) kill.add(i - 1);
			}
		} else if (nextLit) kill.add(i + 1);
		else if (prevLit) kill.add(i - 1);
		const kept = ps.filter((_, j) => !kill.has(j));
		return without(join(kept), drop);
	}
	return join(ps);
}

/** The three patterns in use: what was written, or worked out from the full-date one. */
export function patternsOf(p: CalendarPattern): { day: string; month: string; year: string } {
	const day = p.day.trim();
	const month = p.month.trim() || tidy(without(day, DAY_TOKENS));
	const year = p.year.trim() || tidy(without(month, new Set([...DAY_TOKENS, ...MONTH_TOKENS])));
	return { day, month, year };
}

const tidy = (s: string) => s.replace(/\s+/g, ' ').trim();

/** Fill a pattern; missing values vanish with the commas and spaces around them. */
export function fillPattern(pattern: string, values: Partial<Record<DateToken, string>>): string {
	const GAP = '\u0000';
	let s = tokenize(pattern)
		.map((p) => ('tok' in p ? values[p.tok] || GAP : p.lit))
		.join('');
	if (!s.includes(GAP)) return tidy(s);
	s = s
		// eslint-disable-next-line no-control-regex -- \u0000 is the placeholder this formatter inserts itself
		.replace(/[ \t]*\u0000[ \t]*/g, ' ')
		.replace(/\s+([,;:])/g, '$1')
		.replace(/([,;:·/–—-])(\s*[,;:·/–—-])+/g, '$1')
		.replace(/\(\s*\)/g, '');
	return tidy(s).replace(/^[\s,;:·/–—-]+|[\s,;:·/–—-]+$/g, '');
}

/** Tokens in a pattern, in order. */
export function tokensIn(pattern: string): DateToken[] {
	return tokenize(pattern).flatMap((p) => ('tok' in p ? [p.tok] : []));
}

/** The plain words a pattern adds ("the", "of", "year"), for reading dates back. */
export function literalWords(pattern: string): string[] {
	return tokenize(pattern).flatMap((p) => ('lit' in p ? (p.lit.match(/\p{L}+/gu) ?? []) : []));
}

// ── numbers in words ───────────────────────────────────────────────────────────

const ONES = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
const ORD: Record<string, string> = { one: 'first', two: 'second', three: 'third', five: 'fifth', eight: 'eighth', nine: 'ninth', twelve: 'twelfth' };

function cardinal(n: number): string {
	if (n < 20) return ONES[n]!;
	if (n < 100) return TENS[Math.floor(n / 10)]! + (n % 10 ? `-${ONES[n % 10]}` : '');
	return `${ONES[Math.floor(n / 100)]} hundred${n % 100 ? ` ${cardinal(n % 100)}` : ''}`;
}

/** 14 → "fourteenth", 21 → "twenty-first" (1–999; other numbers stay digits). */
export function ordinalWords(n: number): string {
	if (!Number.isInteger(n) || n < 1 || n > 999) return String(n);
	const c = cardinal(n);
	const m = /([a-z]+)$/.exec(c)!;
	const last = m[1]!;
	const ord = ORD[last] ?? (last.endsWith('y') ? `${last.slice(0, -1)}ieth` : `${last}th`);
	return c.slice(0, m.index) + ord;
}

/** 14 → "14th". */
export function ordinal(n: number): string {
	const t = Math.abs(n) % 100;
	const suf = t >= 11 && t <= 13 ? 'th' : (['th', 'st', 'nd', 'rd'][Math.abs(n) % 10] ?? 'th');
	return `${n}${suf}`;
}

let ordinalTable: Array<[string, number]> | null = null;
/** Day words back to numbers, longest first so "twenty-first" wins over "first". */
export function replaceOrdinalWords(text: string): string {
	ordinalTable ??= Array.from({ length: 400 }, (_, i) => [ordinalWords(i + 1), i + 1] as [string, number]).sort((a, b) => b[0].length - a[0].length);
	let t = text;
	const lower = () => t.toLowerCase();
	for (const [w, n] of ordinalTable) {
		const at = lower().indexOf(w);
		if (at < 0) continue;
		const before = t[at - 1];
		const after = t[at + w.length];
		if ((before && /\p{L}/u.test(before)) || (after && /[\p{L}-]/u.test(after))) continue;
		t = `${t.slice(0, at)}${n}${t.slice(at + w.length)}`;
	}
	return t;
}

// ── Roman numerals ─────────────────────────────────────────────────────────────

const ROMAN: Array<[number, string]> = [
	[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I'],
];

/** 312 → "CCCXII" (1–3999; other numbers stay digits). */
export function toRoman(n: number): string {
	if (!Number.isInteger(n) || n < 1 || n > 3999) return String(n);
	let out = '';
	let left = n;
	for (const [v, s] of ROMAN)
		while (left >= v) {
			out += s;
			left -= v;
		}
	return out;
}

export function fromRoman(s: string): number | null {
	const t = s.toUpperCase();
	if (!/^[MDCLXVI]+$/.test(t)) return null;
	let n = 0;
	let i = 0;
	for (const [v, sym] of ROMAN)
		while (t.startsWith(sym, i)) {
			n += v;
			i += sym.length;
		}
	return i === t.length && toRoman(n) === t ? n : null;
}
