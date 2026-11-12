import type { Calendar, CalendarEra, CalendarFestival } from '../types/calendar';
import type { ChronoDate } from '../types/chrono';
import { fillPattern, literalWords, ordinal, ordinalWords, patternsOf, replaceOrdinalWords, tokensIn, toRoman, fromRoman, type DateToken } from './pattern';

/**
 * Fictional calendars (Milestone 10): pure date arithmetic and formatting.
 *
 * Every date sits on a line of *absolute years* (a calendar's own count, negative before
 * its year 0). Eras only name stretches of that line: an era counting up calls its `start`
 * year `firstYear` (0 or 1); one counting down (like BC) calls `start` its `firstYear` and
 * counts up into the past. Other calendars are placed on the main calendar's line by
 * `offset`.
 *
 * Dates written before calendars existed have no `calendar`: their year is what was typed,
 * so when their era text names an era the year counts within that era. Dates written by the
 * calendar editor carry `calendar` and store the absolute year.
 */

export const DEFAULT_CALENDAR_ID = 'default';

/** The calendar a world has before anyone sets one up: plain numbered years. */
export function defaultCalendar(): Calendar {
	return {
		v: 1,
		id: DEFAULT_CALENDAR_ID,
		name: 'Years',
		description: '',
		months: [],
		weekdays: [],
		weekdayOffset: 0,
		festivals: [],
		eras: [],
		style: 'day-month-year',
		pattern: null,
		showWeekday: false,
		offset: 0,
		createdAt: 0,
		updatedAt: 0,
		rev: 0,
	};
}

// ── the calendars in use ────────────────────────────────────────────────────

let active: Calendar[] = [defaultCalendar()];
let mainId: string = DEFAULT_CALENDAR_ID;
let version = 0;

/**
 * Field kinds format and sort dates without access to the world, so the open world's
 * calendars are published here (by CalendarService) whenever they load or change.
 */
export function setActiveCalendars(list: Calendar[], main: string | null): void {
	active = list.length ? list : [defaultCalendar()];
	mainId = main && active.some((c) => c.id === main) ? main : (active[0] as Calendar).id;
	version++;
}

/** Changes whenever the calendars do (for caches). */
export function calendarsVersion(): number {
	return version;
}

export function activeCalendars(): Calendar[] {
	return active;
}

export function mainCalendar(): Calendar {
	return active.find((c) => c.id === mainId) ?? (active[0] as Calendar);
}

/** The calendar a date uses: its own, else the main one. */
export function calendarFor(id?: string | null): Calendar {
	return (id && active.find((c) => c.id === id)) || mainCalendar();
}

/** A calendar with no months and no eras formats dates exactly as before calendars. */
export function isPlain(cal: Calendar): boolean {
	return !cal.months.length && !cal.eras.length;
}

// ── years and eras ──────────────────────────────────────────────────────────

const fdiv = (a: number, b: number) => Math.floor(a / b);
const norm = (s: string) => s.trim().toLowerCase();
/** What era ids look like (8 hex characters), as opposed to era text typed by hand. */
const ERA_ID = /^[0-9a-f]{8}$/;

/** The era a date's era text or id names, if the calendar has it. */
export function matchEra(cal: Calendar, era: string | null | undefined): CalendarEra | undefined {
	if (!era) return undefined;
	const byId = cal.eras.find((e) => e.id === era);
	if (byId) return byId;
	const t = norm(era);
	return cal.eras.find((e) => (e.abbr && norm(e.abbr) === t) || norm(e.name) === t);
}

export function eraYear(era: CalendarEra, abs: number): number {
	return era.direction === 'up' ? abs - era.start + era.firstYear : era.start - abs + era.firstYear;
}

export function eraYearToAbs(era: CalendarEra, n: number): number {
	return era.direction === 'up' ? era.start + n - era.firstYear : era.start - (n - era.firstYear);
}

/** Which era an absolute year falls in (null when the calendar has none that covers it). */
export function eraOf(cal: Calendar, abs: number): CalendarEra | null {
	const ups = cal.eras.filter((e) => e.direction === 'up').sort((a, b) => a.start - b.start);
	let found: CalendarEra | null = null;
	for (const e of ups) if (e.start <= abs) found = e;
	if (found) return found;
	const downs = cal.eras.filter((e) => e.direction === 'down' && e.start >= abs).sort((a, b) => a.start - b.start);
	return downs[0] ?? null;
}

/** The absolute year of a date in its own calendar. */
export function absoluteYear(d: ChronoDate, cal: Calendar = calendarFor(d.calendar)): number {
	if (d.calendar) return d.year;
	const era = matchEra(cal, d.era);
	return era && d.year >= 0 ? eraYearToAbs(era, d.year) : d.year;
}

/** Era and year-within-era for display. */
export function yearParts(d: ChronoDate, cal: Calendar = calendarFor(d.calendar)): { era: CalendarEra | null; year: number; extraEra: string | null } {
	const abs = absoluteYear(d, cal);
	const named = matchEra(cal, d.era);
	// Era text that isn't one of the calendar's eras is a label of its own ("Third Age"):
	// the year is shown as it was typed, next to it.
	// (On a date written in a calendar, an unknown era id is one that was deleted: it isn't
	// shown, and the era the year falls in is used instead.)
	const extraEra = !named && d.era && !(d.calendar && ERA_ID.test(d.era)) ? d.era : null;
	if (extraEra) return { era: null, year: abs, extraEra };
	const era = named ?? eraOf(cal, abs);
	return { era, year: era ? eraYear(era, abs) : abs, extraEra: null };
}

// ── days ────────────────────────────────────────────────────────────────────

const mod = (a: number, b: number) => ((a % b) + b) % b;

export function festivalOccurs(f: CalendarFestival, year: number): boolean {
	return f.every <= 1 || mod(year - (f.from ?? 0), f.every) === 0;
}

/** How many times a festival happens in years [0, y) (negative for y < 0). */
function occurrencesBefore(f: CalendarFestival, y: number): number {
	if (f.every <= 1) return y;
	const o = f.from ?? 0;
	return fdiv(y - 1 - o, f.every) - fdiv(-1 - o, f.every);
}

export function monthDays(cal: Calendar): number {
	return cal.months.reduce((n, m) => n + m.days, 0);
}

export function yearLength(cal: Calendar, year: number): number {
	return monthDays(cal) + cal.festivals.reduce((n, f) => n + (festivalOccurs(f, year) ? f.days : 0), 0);
}

/** Days from the first day of year 0 to the first day of `year`. */
export function daysBeforeYear(cal: Calendar, year: number): number {
	return monthDays(cal) * year + cal.festivals.reduce((n, f) => n + f.days * occurrencesBefore(f, year), 0);
}

export type YearSegment = { kind: 'month'; index: number; name: string; days: number } | { kind: 'festival'; id: string; name: string; days: number };

/** The months and festival days of one year, in order. */
export function yearSegments(cal: Calendar, year: number): YearSegment[] {
	const out: YearSegment[] = [];
	const fests = (after: number) => {
		for (const f of cal.festivals) if (f.after === after && festivalOccurs(f, year)) out.push({ kind: 'festival', id: f.id, name: f.name, days: f.days });
	};
	cal.months.forEach((m, i) => {
		fests(i);
		out.push({ kind: 'month', index: i + 1, name: m.name, days: m.days });
	});
	fests(cal.months.length);
	return out;
}

/** 0-based day of the year a date falls on (the first day of its month for month precision). */
export function dayOfYear(d: ChronoDate, cal: Calendar = calendarFor(d.calendar)): number {
	if (!cal.months.length || d.precision === 'year' || d.precision === 'era') return 0;
	const year = absoluteYear(d, cal);
	let n = 0;
	for (const seg of yearSegments(cal, year)) {
		const here = seg.kind === 'festival' ? !!d.festival && seg.id === d.festival : !d.festival && seg.index === d.month;
		if (here) {
			const day = d.precision === 'day' && d.day ? Math.min(Math.max(1, d.day), seg.days) : 1;
			return n + day - 1;
		}
		n += seg.days;
	}
	// A festival in a year it doesn't happen (a leap day in another year): just after the
	// month it follows.
	const f = d.festival ? cal.festivals.find((x) => x.id === d.festival) : undefined;
	if (f) return cal.months.slice(0, f.after).reduce((m, x) => m + x.days, 0) + cal.festivals.filter((x) => x.after < f.after && festivalOccurs(x, year)).reduce((m, x) => m + x.days, 0);
	return 0;
}

/** Days since the first day of year 0 (for weekdays). */
export function dayNumber(d: ChronoDate, cal: Calendar = calendarFor(d.calendar)): number {
	return daysBeforeYear(cal, absoluteYear(d, cal)) + dayOfYear(d, cal);
}

export function weekdayOf(d: ChronoDate, cal: Calendar = calendarFor(d.calendar)): string | null {
	if (!cal.weekdays.length || d.precision !== 'day' || !cal.months.length) return null;
	return cal.weekdays[mod(dayNumber(d, cal) + cal.weekdayOffset, cal.weekdays.length)] ?? null;
}

/**
 * Where a date sits on the world's line, in years (fractions within the year), for sorting
 * and timelines. Dates in other calendars are moved by that calendar's offset.
 */
export function chronoPosition(d: ChronoDate): number {
	const cal = calendarFor(d.calendar);
	const abs = absoluteYear(d, cal);
	let frac = 0;
	if (cal.months.length) {
		const len = yearLength(cal, abs) || 1;
		frac = dayOfYear(d, cal) / len;
	} else if (d.precision === 'month' || d.precision === 'day') {
		// Plain years: month and day as typed (legacy "12 M3").
		frac = (((d.month ?? 1) - 1) * 32 + ((d.day ?? 1) - 1)) / 420;
	}
	const offset = cal.id === mainCalendar().id ? 0 : cal.offset;
	return abs + offset + Math.min(0.999999, Math.max(0, frac));
}

// ── text ────────────────────────────────────────────────────────────────────

/** How dates looked before calendars (kept for plain calendars, so nothing changes). */
export function legacyFormat(d: ChronoDate): string {
	if (d.label) return d.label;
	const parts: string[] = [];
	if (d.precision === 'day' && d.day != null) parts.push(String(d.day));
	if ((d.precision === 'day' || d.precision === 'month') && d.month != null) parts.push(`M${d.month}`);
	parts.push(d.year < 0 ? `${Math.abs(d.year)} BE` : `Year ${d.year}`);
	if (d.era) parts.push(d.era);
	return (d.approx ? 'c. ' : '') + parts.join(' ');
}

export function eraLabel(era: CalendarEra): string {
	return era.abbr || era.name;
}

export function monthShort(cal: Calendar, index: number): string {
	const m = cal.months[index - 1];
	if (!m) return `M${index}`;
	return m.short || m.name.slice(0, 3);
}

/** A date in its calendar's words: "Moonday, 12 Frostmoon 312 AE". */
export function formatChrono(d: ChronoDate, o: { short?: boolean; tagCalendar?: boolean } = {}): string {
	return formatChronoIn(calendarFor(d.calendar), d, o);
}

/** The same, in a given calendar (previews of changes that aren't saved yet). */
export function formatChronoIn(cal: Calendar, d: ChronoDate, o: { short?: boolean; tagCalendar?: boolean } = {}): string {
	if (d.label) return d.label;
	// Dates in another calendar than the main one say which (so a spreadsheet reads back).
	if (o.tagCalendar && cal.id !== mainCalendar().id) return `${formatChrono(d, { short: o.short })} (${cal.name})`;
	if (isPlain(cal) && !d.calendar) return legacyFormat(d);
	const { era, year, extraEra } = yearParts(d, cal);
	let yearText = era ? `${year} ${eraLabel(era)}` : year < 0 && !cal.eras.length ? `${Math.abs(year)} BE` : cal.months.length ? String(year) : `Year ${year}`;
	if (extraEra) yearText += ` ${extraEra}`;
	if (d.precision === 'era') return (d.approx ? 'c. ' : '') + (era?.name ?? yearText);
	const own = customPatterns(cal);
	if (own) return (d.approx ? 'c. ' : '') + formatCustom(d, cal, own, era, year, extraEra, !!o.short);
	let text = yearText;
	const showMonth = (d.precision === 'month' || d.precision === 'day') && cal.months.length;
	if (showMonth) {
		const fest = d.festival ? cal.festivals.find((f) => f.id === d.festival) : undefined;
		const dayPart = d.precision === 'day' && d.day != null ? d.day : null;
		if (fest) {
			const name = fest.days > 1 && dayPart ? `${fest.name}, day ${dayPart}` : fest.name;
			text = cal.style === 'year-month-day' ? `${yearText}, ${name}` : `${name}, ${yearText}`;
		} else if (d.month != null) {
			const mName = o.short ? monthShort(cal, d.month) : (cal.months[d.month - 1]?.name ?? `M${d.month}`);
			switch (cal.style) {
				case 'month-day-year':
					text = dayPart != null ? `${mName} ${dayPart}, ${yearText}` : `${mName} ${yearText}`;
					break;
				case 'year-month-day':
					text = dayPart != null ? `${yearText}, ${mName} ${dayPart}` : `${yearText}, ${mName}`;
					break;
				case 'numeric':
					text = dayPart != null ? `${dayPart}/${d.month}/${yearText}` : `${d.month}/${yearText}`;
					break;
				default:
					text = dayPart != null ? `${dayPart} ${mName} ${yearText}` : `${mName} ${yearText}`;
			}
		}
		const wd = cal.showWeekday ? weekdayOf(d, cal) : null;
		if (wd && !o.short) text = `${wd}, ${text}`;
	} else if ((d.precision === 'month' || d.precision === 'day') && !cal.months.length) {
		// Plain years with a month typed in an older version.
		const parts: string[] = [];
		if (d.precision === 'day' && d.day != null) parts.push(String(d.day));
		if (d.month != null) parts.push(`M${d.month}`);
		text = `${parts.join(' ')} ${yearText}`;
	}
	return (d.approx ? 'c. ' : '') + text;
}

/** The calendar's own patterns, when it writes dates its own way. */
export function customPatterns(cal: Calendar): { day: string; month: string; year: string } | null {
	if (cal.style !== 'custom' || !cal.pattern?.day.trim()) return null;
	const key = `${cal.pattern.day}\u0001${cal.pattern.month}\u0001${cal.pattern.year}`;
	let hit = patternCache.get(key);
	if (!hit) {
		hit = patternsOf(cal.pattern);
		if (patternCache.size > 50) patternCache.clear();
		patternCache.set(key, hit);
	}
	return hit;
}
const patternCache = new Map<string, { day: string; month: string; year: string }>();

function formatCustom(d: ChronoDate, cal: Calendar, p: { day: string; month: string; year: string }, era: CalendarEra | null, year: number, extraEra: string | null, short: boolean): string {
	const fest = d.festival ? cal.festivals.find((f) => f.id === d.festival) : undefined;
	const hasMonth = (d.precision === 'month' || d.precision === 'day') && cal.months.length > 0 && (!!fest || d.month != null);
	const dayN = hasMonth && d.precision === 'day' && d.day != null && (!fest || fest.days > 1) ? d.day : null;
	// Plain years before 0 with no eras read "40 BE", as they always have.
	const be = !era && year < 0 && !cal.eras.length;
	const yearN = be ? Math.abs(year) : year;
	const v: Partial<Record<DateToken, string>> = {
		year: String(yearN),
		'year-roman': toRoman(yearN),
		era: [era ? eraLabel(era) : be ? 'BE' : '', extraEra ?? ''].filter(Boolean).join(' '),
		'era-name': [era?.name ?? (be ? 'BE' : ''), extraEra ?? ''].filter(Boolean).join(' '),
	};
	const pattern = dayN != null ? p.day : hasMonth ? p.month : p.year;
	// No era in the format: years before 0 still say so.
	if (be && !/\{era(-name)?\}/.test(pattern)) {
		v.year += ' BE';
		v['year-roman'] += ' BE';
	}
	if (fest && !/\{month(-short)?\}/.test(pattern)) {
		// A format of numbers has no place for a festival's name: write it out.
		const yearText = fillPattern(p.year, v);
		return dayN != null ? `${fest.name}, day ${dayN}, ${yearText}` : `${fest.name}, ${yearText}`;
	}
	if (hasMonth) {
		const m = d.month != null ? cal.months[d.month - 1] : undefined;
		v.month = fest ? fest.name : short ? monthShort(cal, d.month!) : (m?.name ?? `M${d.month}`);
		v['month-short'] = fest ? fest.name : monthShort(cal, d.month!);
		v['month-number'] = fest ? '' : String(d.month);
	}
	if (dayN != null) {
		v.day = String(dayN);
		v['day-th'] = ordinal(dayN);
		v['day-words'] = ordinalWords(dayN);
		v.weekday = short ? '' : (weekdayOf(d, cal) ?? '');
	}
	return fillPattern(pattern, v);
}

/**
 * Read a date back from text in a calendar's words (what `formatChrono` writes, and close
 * variations): "12 Frostmoon 312 AE", "Frostmoon 312", "312 AE", "c. Midwinter, 40".
 */
export function parseChrono(text: string, cal: Calendar = mainCalendar()): ChronoDate | null {
	let t = text.trim();
	if (!t) return null;
	let approx = false;
	const ca = /^(c\.|ca\.|circa|about|~)\s*/i.exec(t);
	if (ca) {
		approx = true;
		t = t.slice(ca[0].length);
	}
	const own = customPatterns(cal);
	const ownTokens = own ? new Set([...tokensIn(own.day), ...tokensIn(own.month), ...tokensIn(own.year)]) : null;
	if (own && ownTokens) {
		// Your own way of writing: weekdays can be anywhere.
		for (const w of cal.weekdays) if (w) t = t.replace(new RegExp(`(^|[^\\p{L}])${esc(w)}(?=$|[^\\p{L}])`, 'iu'), '$1 ');
	}
	// Names sit between spaces and commas; your own format may also use dots, dashes, brackets.
	const before = own ? '[\\s,/.\\-–·()]' : '[\\s,/]';
	const after = own ? '[\\s,/.\\-–·()]' : '[\\s,/.]';
	// Weekday prefix.
	for (const w of cal.weekdays) {
		if (w && norm(t).startsWith(`${norm(w)},`)) {
			t = t.slice(w.length + 1).trim();
			break;
		}
	}
	// Era: the longest name or abbreviation found as a whole word.
	let era: CalendarEra | undefined;
	let eraAt = -1;
	let eraLen = 0;
	for (const e of cal.eras) {
		for (const label of [e.name, e.abbr]) {
			if (!label) continue;
			const re = new RegExp(`(^|${before})${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=$|${after})`, 'i');
			const m = re.exec(t);
			if (m && label.length > eraLen) {
				era = e;
				eraAt = m.index + m[1]!.length;
				eraLen = label.length;
			}
		}
	}
	let rest = t;
	if (era) rest = `${t.slice(0, eraAt)} ${t.slice(eraAt + eraLen)}`;
	// Festival or month, by name (longest first) or short name.
	let month: number | null = null;
	let festival: string | null = null;
	const names: Array<{ label: string; month?: number; festival?: string }> = [];
	cal.months.forEach((m, i) => {
		names.push({ label: m.name, month: i + 1 });
		names.push({ label: m.short || m.name.slice(0, 3), month: i + 1 });
	});
	for (const f of cal.festivals) names.push({ label: f.name, festival: f.id });
	names.sort((a, b) => b.label.length - a.label.length);
	for (const n of names) {
		if (!n.label) continue;
		const re = new RegExp(`(^|${before})${n.label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=$|${after})`, 'i');
		const m = re.exec(rest);
		if (m) {
			month = n.month ?? null;
			festival = n.festival ?? null;
			rest = `${rest.slice(0, m.index + m[1]!.length)} ${rest.slice(m.index + m[1]!.length + n.label.length)}`;
			break;
		}
	}
	rest = rest.replace(/\bday\b/i, ' ');
	if (own && ownTokens) {
		// With the names gone: "14th", "fourteenth", and dashes that only separate.
		rest = rest.replace(/(\d+)(st|nd|rd|th)\b/gi, '$1');
		if (ownTokens.has('day-words')) rest = replaceOrdinalWords(rest);
		const lits = [own.day, own.month, own.year].join(' ').replace(/\{[a-z-]+\}/g, ' ');
		rest = /[-–]/.test(lits) ? rest.replace(/[-–]/g, ' ') : rest.replace(/(\d)\s*[-–]\s*(?=\d)/g, '$1 ');
		// The pattern's own words ("the", "of", "in the year"), then Roman years.
		const words = new Set([...literalWords(own.day), ...literalWords(own.month), ...literalWords(own.year)].map((w) => w.toLowerCase()));
		for (const w of words) rest = rest.replace(new RegExp(`(^|[^\\p{L}])${esc(w)}(?=$|[^\\p{L}])`, 'giu'), '$1 ');
		if (ownTokens.has('year-roman'))
			rest = rest.replace(/(^|[^\p{L}])([MDCLXVI]+)(?=$|[^\p{L}])/giu, (all, pre: string, r: string) => {
				const n = fromRoman(r);
				return n == null ? all : `${pre}${n}`;
			});
	}
	if (/[A-Za-z]/.test(rest.replace(/\bBE\b|\bYear\b/g, ''))) return null;
	const legacyBE = /\bBE\b/.test(rest) && !era;
	const nums = (rest.match(/-?\d+/g) ?? []).map(Number);
	let day: number | null = null;
	let year: number;
	// Your own pattern says which number is which: "{year}.{month-number}.{day}".
	const order = (want: string): Array<'d' | 'm' | 'y'> | null => {
		if (!own) return null;
		// Festivals in an all-numbers format are written "Midwinter, day 2, 312".
		if (festival && want === 'dy' && !/\{month(-short)?\}/.test(own.day)) return ['d', 'y'];
		const seq = tokensIn(nums.length === 3 ? own.day : month != null || festival ? own.day : own.month).map((tk) => (tk === 'day' || tk === 'day-th' || tk === 'day-words' ? 'd' : tk === 'month-number' ? 'm' : tk === 'year' || tk === 'year-roman' ? 'y' : null));
		const got = seq.filter((x): x is 'd' | 'm' | 'y' => !!x && want.includes(x));
		return got.length === want.length ? got : null;
	};
	const assign = (o: Array<'d' | 'm' | 'y'>) => {
		const r: Record<string, number> = {};
		o.forEach((k, i) => (r[k] = nums[i]!));
		return r;
	};
	const dy = nums.length === 2 && (month != null || festival) ? order('dy') : null;
	const dmy = nums.length === 3 ? order('dmy') : null;
	const my = nums.length === 2 && month == null && !festival ? order('my') : null;
	if (dy) {
		const r = assign(dy);
		day = r.d!;
		year = r.y!;
	} else if (dmy && cal.months.length) {
		const r = assign(dmy);
		[day, month, year] = [r.d!, r.m!, r.y!];
		if (month < 1 || month > cal.months.length) return null;
	} else if (my && cal.months.length) {
		const r = assign(my);
		[month, year] = [r.m!, r.y!];
		if (month < 1 || month > cal.months.length) return null;
	} else if (festival) {
		if (nums.length === 2) [day, year] = cal.style === 'year-month-day' ? [nums[1]!, nums[0]!] : [nums[0]!, nums[1]!];
		else if (nums.length === 1) year = nums[0]!;
		else return null;
	} else if (month != null) {
		if (nums.length === 2) [day, year] = cal.style === 'year-month-day' ? [nums[1]!, nums[0]!] : [nums[0]!, nums[1]!];
		else if (nums.length === 1) year = nums[0]!;
		else return null;
	} else if (nums.length === 3 && cal.months.length) {
		[day, month, year] = [nums[0]!, nums[1]!, nums[2]!];
		if (month < 1 || month > cal.months.length) return null;
	} else if (nums.length === 2 && cal.months.length && cal.style === 'numeric') {
		[month, year] = [nums[0]!, nums[1]!];
		if (month < 1 || month > cal.months.length) return null;
	} else if (nums.length === 1) year = nums[0]!;
	else if (!nums.length && era && month == null && !festival) {
		// An era on its own ("After the Crowning").
		const d: ChronoDate = { calendar: cal.id, era: era.id, year: era.start, precision: 'era' };
		if (approx) d.approx = true;
		return d;
	} else return null;
	if (legacyBE) year = -Math.abs(year);
	const abs = era ? eraYearToAbs(era, year) : year;
	const d: ChronoDate = { calendar: cal.id, year: abs, precision: day != null ? 'day' : month != null || festival ? 'month' : 'year' };
	if (era) d.era = era.id;
	if (month != null) d.month = month;
	if (festival) d.festival = festival;
	if (day != null && !(festival && cal.festivals.find((f) => f.id === festival)?.days === 1)) d.day = day;
	else if (day != null) d.precision = 'month';
	if (approx) d.approx = true;
	return d;
}

/** A fresh date in a calendar from what someone typed: era-year → absolute. */
export function makeDate(cal: Calendar, input: { year: number; era?: CalendarEra | null; month?: number | null; festival?: string | null; day?: number | null; approx?: boolean }): ChronoDate {
	const abs = input.era ? eraYearToAbs(input.era, input.year) : input.year;
	const d: ChronoDate = { calendar: cal.id, year: abs, precision: input.day != null ? 'day' : input.month != null || input.festival ? 'month' : 'year' };
	if (input.era) d.era = input.era.id;
	if (input.festival) d.festival = input.festival;
	else if (input.month != null) d.month = input.month;
	if (input.day != null) d.day = input.day;
	if (input.approx) d.approx = true;
	return d;
}

function esc(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
