/**
 * Real-world calendar dates as "YYYY-MM-DD" strings in local time. Strings sort and
 * compare correctly, survive JSON and sync, and never shift with time zones.
 */
export type ISODate = string;

const RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isISODate(v: unknown): v is ISODate {
	if (typeof v !== 'string') return false;
	const m = RE.exec(v);
	if (!m) return false;
	const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
	return d.getFullYear() === Number(m[1]) && d.getMonth() === Number(m[2]) - 1 && d.getDate() === Number(m[3]);
}

export function toISO(d: Date): ISODate {
	const p = (n: number) => String(n).padStart(2, '0');
	return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function fromISO(s: ISODate): Date {
	const m = RE.exec(s);
	if (!m) return new Date(NaN);
	return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

export function today(now: Date = new Date()): ISODate {
	return toISO(now);
}

export function addDays(s: ISODate, n: number): ISODate {
	const d = fromISO(s);
	d.setDate(d.getDate() + n);
	return toISO(d);
}

/** Add months, clamping the day (Jan 31 + 1 month → Feb 28/29). */
export function addMonths(s: ISODate, n: number): ISODate {
	const d = fromISO(s);
	const day = d.getDate();
	d.setDate(1);
	d.setMonth(d.getMonth() + n);
	const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
	d.setDate(Math.min(day, last));
	return toISO(d);
}

/** Whole days from a to b (b − a). */
export function daysBetween(a: ISODate, b: ISODate): number {
	return Math.round((fromISO(b).getTime() - fromISO(a).getTime()) / 86_400_000);
}

/** First day of the week containing `s`. weekStart: 0 = Sunday, 1 = Monday. */
export function startOfWeek(s: ISODate, weekStart = 1): ISODate {
	const d = fromISO(s);
	const diff = (d.getDay() - weekStart + 7) % 7;
	return addDays(s, -diff);
}

export function startOfMonth(s: ISODate): ISODate {
	return `${s.slice(0, 7)}-01`;
}

export function endOfMonth(s: ISODate): ISODate {
	return addDays(addMonths(startOfMonth(s), 1), -1);
}

/**
 * The days a month grid shows: whole weeks from the week the month starts in to the week
 * it ends in (four to six rows of seven), so every row is full and the lines meet.
 */
export function monthGridDays(s: ISODate, weekStart = 1): ISODate[] {
	const first = startOfWeek(startOfMonth(s), weekStart);
	const last = endOfMonth(s);
	const out: ISODate[] = [];
	for (let d = first; out.length % 7 !== 0 || d <= last; d = addDays(d, 1)) out.push(d);
	return out;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const MONTHS_SHORT = MONTHS.map((m) => m.slice(0, 3));
const DAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function monthLabel(s: ISODate): string {
	const d = fromISO(s);
	return `${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

export function weekdayShort(i: number): string {
	return DAYS_SHORT[((i % 7) + 7) % 7] as string;
}

/** "Tue, Oct 6, 2026" */
export function longDate(s: ISODate): string {
	const d = fromISO(s);
	return `${DAYS_SHORT[d.getDay()]}, ${MONTHS_SHORT[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

/** Friendly due label relative to today: Today, Tomorrow, Yesterday, Thu, Oct 13, 4 days ago… */
export function dueLabel(s: ISODate, now: ISODate = today()): string {
	const n = daysBetween(now, s);
	if (n === 0) return 'Today';
	if (n === 1) return 'Tomorrow';
	if (n === -1) return 'Yesterday';
	if (n < 0 && n > -14) return `${-n} days ago`;
	if (n > 1 && n < 7) return DAYS_SHORT[fromISO(s).getDay()] as string;
	const d = fromISO(s);
	const sameYear = s.slice(0, 4) === now.slice(0, 4);
	return `${MONTHS_SHORT[d.getMonth()]} ${d.getDate()}${sameYear ? '' : `, ${d.getFullYear()}`}`;
}
