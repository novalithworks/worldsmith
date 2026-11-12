/**
 * WS6 (0.24): writing progress. Words written per day (net: deleting counts down), streaks,
 * daily goals and deadlines. Pure: dates come in as local day keys ("2026-10-18"), so tests
 * don't depend on the clock or time zone.
 */

export type DayKey = string;

/** The local calendar day of a moment, as "YYYY-MM-DD". */
export function dayKey(t: number | Date = Date.now()): DayKey {
	const d = typeof t === 'number' ? new Date(t) : t;
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** A day key moved by n days (n may be negative). */
export function addDays(key: DayKey, n: number): DayKey {
	const [y, m, d] = key.split('-').map(Number) as [number, number, number];
	return dayKey(new Date(y, m - 1, d + n, 12));
}

/** Whole days from a to b (b later = positive). */
export function daysBetween(a: DayKey, b: DayKey): number {
	const t = (k: DayKey) => {
		const [y, m, d] = k.split('-').map(Number) as [number, number, number];
		return Date.UTC(y, m - 1, d);
	};
	return Math.round((t(b) - t(a)) / 86_400_000);
}

export const isDayKey = (s: unknown): s is DayKey => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);

/** Add words to a day (a copy; a day that comes back to zero is removed). */
export function addWords(days: Record<DayKey, number>, key: DayKey, n: number): Record<DayKey, number> {
	const out = { ...days };
	const v = (out[key] ?? 0) + n;
	if (v === 0) delete out[key];
	else out[key] = v;
	return out;
}

/** Did a day count toward a streak? With a daily goal: met it. Without: wrote anything (net > 0). */
export function dayCounts(words: number | undefined, goal: number | null | undefined): boolean {
	const w = words ?? 0;
	return goal && goal > 0 ? w >= goal : w > 0;
}

/**
 * The streak now: consecutive counting days ending today, or ending yesterday while today
 * hasn't counted yet (so a streak isn't "broken" in the morning). And the best ever.
 */
export function streaks(days: Record<DayKey, number>, goal: number | null | undefined, today: DayKey): { current: number; best: number; todayCounts: boolean } {
	const todayCounts = dayCounts(days[today], goal);
	let current = 0;
	for (let k = todayCounts ? today : addDays(today, -1); dayCounts(days[k], goal); k = addDays(k, -1)) current++;
	let best = 0;
	let run = 0;
	let prev: DayKey | null = null;
	for (const k of Object.keys(days).filter(isDayKey).sort()) {
		if (!dayCounts(days[k], goal)) {
			run = 0;
			prev = k;
			continue;
		}
		run = prev && daysBetween(prev, k) === 1 && dayCounts(days[prev], goal) ? run + 1 : 1;
		best = Math.max(best, run);
		prev = k;
	}
	return { current, best: Math.max(best, current), todayCounts };
}

/** The last n days, oldest first, with their words (0 for none). */
export function lastDays(days: Record<DayKey, number>, today: DayKey, n = 30): Array<{ day: DayKey; words: number }> {
	const out: Array<{ day: DayKey; words: number }> = [];
	for (let i = n - 1; i >= 0; i--) {
		const day = addDays(today, -i);
		out.push({ day, words: days[day] ?? 0 });
	}
	return out;
}

/** Words a day still needed to reach the target by the deadline (counting today), or null. */
export function neededPerDay(words: number, target: number | null | undefined, deadline: DayKey | null | undefined, today: DayKey): number | null {
	if (!target || !deadline || !isDayKey(deadline)) return null;
	const left = target - words;
	if (left <= 0) return 0;
	const daysLeft = daysBetween(today, deadline) + 1;
	if (daysLeft <= 0) return null;
	return Math.ceil(left / daysLeft);
}

/**
 * When the target would be reached at the recent pace (average of the last 14 days, counting
 * days without writing), or null when there's no target or no recent writing.
 */
export function projectedFinish(words: number, target: number | null | undefined, days: Record<DayKey, number>, today: DayKey): DayKey | null {
	if (!target) return null;
	if (words >= target) return today;
	const recent = lastDays(days, today, 14).reduce((n, d) => n + d.words, 0) / 14;
	if (recent <= 0) return null;
	const need = Math.ceil((target - words) / recent);
	return need > 3650 ? null : addDays(today, need);
}

/** One writing sprint, kept in the project's log. */
export interface SprintRecord {
	start: number;
	minutes: number;
	words: number;
}
