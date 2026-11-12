import { activeCalendars, chronoPosition, formatChrono, isPlain, mainCalendar, parseChrono } from '../calendar/engine';

/**
 * Fictional-first date model. Works without any calendar definition ("numeric years"),
 * and can be interpreted by a Calendar (Milestone 10) for month names, eras and ordering.
 */
export interface ChronoDate {
	calendar?: string;
	era?: string | null;
	year: number;
	/** 1-based month of the calendar; null on a festival day. */
	month?: number | null;
	day?: number | null;
	/** A day outside the months (calendar festival id); `day` counts within it. */
	festival?: string | null;
	precision: 'era' | 'year' | 'month' | 'day';
	approx?: boolean;
	/** Free-form label shown instead of the computed format, e.g. "Late Third Age". */
	label?: string | null;
}

export function isChronoDate(value: unknown): value is ChronoDate {
	return (
		typeof value === 'object' &&
		value !== null &&
		typeof (value as ChronoDate).year === 'number' &&
		typeof (value as ChronoDate).precision === 'string'
	);
}

/** A date in its calendar's words (plain worlds keep the pre-calendar look: "c. 12 M3 Year 40"). */
export function formatChronoDate(d: ChronoDate, o: { short?: boolean; tagCalendar?: boolean } = {}): string {
	return formatChrono(d, o);
}

/** The format dates had before calendars; still read back from older spreadsheets. */
function parseLegacy(text: string): ChronoDate | null {
	const m = /^\s*(c\.\s*)?(?:(\d{1,2})\s+)?(?:M(\d{1,2})\s+)?(?:(\d+)\s+BE|Year\s+(-?\d+))(?:\s+(.+?))?\s*$/.exec(text);
	if (!m) return null;
	const [, approx, day, month, be, year, era] = m;
	if (day && !month) return null;
	const d: ChronoDate = { year: be !== undefined ? -Number(be) : Number(year), precision: day ? 'day' : month ? 'month' : 'year' };
	if (month) d.month = Number(month);
	if (day) d.day = Number(day);
	if (era) d.era = era;
	if (approx) d.approx = true;
	return d;
}

/**
 * Read back what `formatChronoDate` writes, so a date survives a trip through a
 * spreadsheet: the main calendar's words first, then the pre-calendar format. Null for
 * anything else.
 */
export function parseChronoText(text: string): ChronoDate | null {
	const cal = mainCalendar();
	// "12 Leafmonth 200 (Old Reckoning)": a date in another calendar, named.
	const tagged = /^(.*\S)\s*\(([^()]+)\)\s*$/.exec(text);
	if (tagged) {
		const other = activeCalendars().find((c) => c.name.trim().toLowerCase() === tagged[2]!.trim().toLowerCase());
		if (other) return parseChrono(tagged[1]!, other);
	}
	if (isPlain(cal)) return parseLegacy(text);
	return parseChrono(text, cal) ?? parseLegacy(text);
}

/** Sort key: where the date sits on the world's line of years. */
export function chronoOrdinal(d: ChronoDate): number {
	return chronoPosition(d);
}
