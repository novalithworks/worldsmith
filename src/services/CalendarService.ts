import { RECORD_VERSIONS } from '../app/constants';
import { absoluteYear, matchEra, setActiveCalendars } from '../core/calendar/engine';
import type { Disposable } from '../core/util/disposable';
import type { EventBus } from '../core/events/EventBus';
import type { WorldsmithEvents } from '../core/events/events';
import type { Calendar, CalendarEra, CalendarFestival, CalendarMonth, World } from '../core/types';
import { isChronoDate, type ChronoDate } from '../core/types/chrono';
import { uuid } from '../core/util/ids';
import { hydrateCalendar } from '../data/migrations/records';
import type { BucketStore } from '../data/storage/BucketStore';
import type { EntityRepository } from '../data/repositories/EntityRepository';
import type { RelationService } from './RelationService';

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const sid = () => uuid().slice(0, 8);

export type CalendarTemplateId = 'fantasy' | 'earthlike' | 'lunar' | 'years';

export interface CalendarTemplate {
	id: CalendarTemplateId;
	name: string;
	icon: string;
	blurb: string;
	build(): Pick<Calendar, 'months' | 'weekdays' | 'festivals' | 'eras' | 'style' | 'showWeekday'>;
}

const months = (list: Array<[string, number]>): CalendarMonth[] => list.map(([name, days]) => ({ id: sid(), name, days }));

/** Starting points for a new calendar; everything can be changed afterwards. */
export const CALENDAR_TEMPLATES: CalendarTemplate[] = [
	{
		id: 'fantasy',
		name: 'Twelve moons',
		icon: 'moon-star',
		blurb: 'Twelve months of 30 days, five festival days at midwinter, a week of seven.',
		build: () => ({
			months: months([
				['Deepwinter', 30], ['Thawmoon', 30], ['Seedfall', 30], ['Blossom', 30], ['Greening', 30], ['Highsun', 30],
				['Goldmoon', 30], ['Harvest', 30], ['Leaffall', 30], ['Mistmoon', 30], ['Frostmoon', 30], ['Longnight', 30],
			]),
			weekdays: ['Sunday', 'Moonday', 'Tideday', 'Windday', 'Thunderday', 'Fireday', 'Starday'],
			festivals: [{ id: sid(), name: 'Midwinter', after: 12, days: 5, every: 1 }],
			eras: [
				{ id: sid(), name: 'Before the Crowning', abbr: 'BC', start: -1, direction: 'down', firstYear: 1, color: 'orange' },
				{ id: sid(), name: 'After the Crowning', abbr: 'AC', start: 0, direction: 'up', firstYear: 0, color: 'blue' },
			],
			style: 'day-month-year',
			showWeekday: false,
		}),
	},
	{
		id: 'earthlike',
		name: 'Earth-like',
		icon: 'sun',
		blurb: 'Twelve familiar months, a leap day every fourth year, a seven-day week.',
		build: () => ({
			months: months([
				['January', 31], ['February', 28], ['March', 31], ['April', 30], ['May', 31], ['June', 30],
				['July', 31], ['August', 31], ['September', 30], ['October', 31], ['November', 30], ['December', 31],
			]),
			weekdays: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'],
			festivals: [{ id: sid(), name: 'Leap day', after: 2, days: 1, every: 4, from: 0 }],
			eras: [],
			style: 'month-day-year',
			showWeekday: false,
		}),
	},
	{
		id: 'lunar',
		name: 'Thirteen moons',
		icon: 'moon',
		blurb: 'Thirteen months of 28 days, one year-end day, a week of seven.',
		build: () => ({
			months: months(['Wolf', 'Snow', 'Worm', 'Pink', 'Flower', 'Strawberry', 'Buck', 'Sturgeon', 'Corn', 'Hunter', 'Beaver', 'Cold', 'Blue'].map((n) => [`${n} Moon`, 28] as [string, number])),
			weekdays: ['First', 'Second', 'Third', 'Fourth', 'Fifth', 'Sixth', 'Seventh'],
			festivals: [{ id: sid(), name: 'Year Day', after: 13, days: 1, every: 1 }],
			eras: [],
			style: 'day-month-year',
			showWeekday: false,
		}),
	},
	{
		id: 'years',
		name: 'Just years and eras',
		icon: 'hourglass',
		blurb: 'No months — numbered years, with eras you can name.',
		build: () => ({
			months: [],
			weekdays: [],
			festivals: [],
			eras: [{ id: sid(), name: 'First Age', abbr: 'FA', start: 0, direction: 'up', firstYear: 0, color: 'cyan' }],
			style: 'day-month-year',
			showWeekday: false,
		}),
	},
];

export type CalendarPatch = Partial<Pick<Calendar, 'name' | 'description' | 'months' | 'weekdays' | 'weekdayOffset' | 'festivals' | 'eras' | 'style' | 'pattern' | 'showWeekday' | 'offset'>>;

/**
 * Fictional calendars (0.10), one file each in `calendars/<id>.json`. One is the world's
 * main calendar (`world.mainCalendar`); dates in another are placed on the main one by its
 * offset. Field kinds read the calendars through the engine's active registry, which this
 * service keeps current. Removing a calendar never touches dates: they fall back to the
 * main calendar, and Undo brings the calendar back.
 */
export class CalendarService {
	private readonly subs: Disposable[] = [];

	constructor(
		private readonly store: BucketStore<Calendar>,
		private readonly events: EventBus<WorldsmithEvents>,
		private readonly world: () => World,
		private readonly updateWorld: (patch: Partial<World>) => void,
		private readonly entities: EntityRepository,
		private readonly relations: () => RelationService,
	) {
		this.publish();
		this.subs.push(this.events.on('world:updated', ({ keys }) => keys.includes('mainCalendar') && this.publish()));
	}

	/** Main calendar first, then the rest in the order they were made. */
	list(): Calendar[] {
		const main = this.mainId();
		return this.store
			.all()
			.sort((a, b) => Number(b.id === main) - Number(a.id === main) || a.createdAt - b.createdAt || a.name.localeCompare(b.name))
			.map(clone);
	}

	get(id: string | null | undefined): Calendar | undefined {
		const c = id ? this.store.get(id) : undefined;
		return c ? clone(c) : undefined;
	}

	/** The main calendar's id, or null while the world uses plain years. */
	mainId(): string | null {
		const want = this.world().mainCalendar;
		if (want && this.store.has(want)) return want;
		const first = this.store.all().sort((a, b) => a.createdAt - b.createdAt)[0];
		return first?.id ?? null;
	}

	main(): Calendar | undefined {
		return this.get(this.mainId());
	}

	uniqueName(name: string, except?: string): string {
		const base = name.trim() || 'Calendar';
		const taken = new Set(this.store.all().filter((c) => c.id !== except).map((c) => c.name.toLowerCase()));
		if (!taken.has(base.toLowerCase())) return base;
		let n = 2;
		while (taken.has(`${base} ${n}`.toLowerCase())) n++;
		return `${base} ${n}`;
	}

	create(input: { name: string; template?: CalendarTemplateId; description?: string; from?: Calendar }): Calendar {
		const now = Date.now();
		const tpl = CALENDAR_TEMPLATES.find((t) => t.id === (input.template ?? 'fantasy')) ?? CALENDAR_TEMPLATES[0]!;
		const parts = input.from
			? (({ months, weekdays, festivals, eras, style, pattern, showWeekday }) => clone({ months, weekdays, festivals, eras, style, pattern, showWeekday }))(input.from)
			: tpl.build();
		const draft: Calendar = {
			pattern: null,
			v: RECORD_VERSIONS.calendar,
			id: uuid(),
			name: this.uniqueName(input.name),
			description: input.description?.trim() ?? input.from?.description ?? '',
			...parts,
			weekdayOffset: input.from?.weekdayOffset ?? 0,
			offset: input.from?.offset ?? 0,
			createdAt: now,
			updatedAt: now,
			rev: 0,
		};
		const doc = hydrateCalendar(draft)!.record;
		const firstOne = !this.store.all().length;
		this.store.put(doc);
		if (firstOne) this.updateWorld({ mainCalendar: doc.id });
		this.publish();
		this.events.emit('calendar:saved', { calendar: clone(doc) });
		return clone(doc);
	}

	duplicate(id: string): Calendar | null {
		const c = this.store.get(id);
		if (!c) return null;
		return this.create({ name: `${c.name} copy`, from: c });
	}

	/** Change a calendar. Returns the version before, for Undo. */
	update(id: string, patch: CalendarPatch): { before: Calendar; after: Calendar } | null {
		const prev = this.store.get(id);
		if (!prev) return null;
		const merged: Calendar = { ...clone(prev), ...clone(patch), updatedAt: Date.now(), rev: prev.rev + 1 };
		if (patch.name !== undefined) merged.name = this.uniqueName(patch.name, id);
		const next = hydrateCalendar(merged)!.record;
		const gone = prev.months.filter((m) => !next.months.some((x) => x.id === m.id));
		for (const m of gone) {
			const n = this.monthUsage(id, prev.months.indexOf(m) + 1);
			if (n) throw new Error(`“${m.name}” is used by ${n === 1 ? 'a date' : `${n} dates`}, so it can’t be removed. Change those dates first.`);
		}
		this.store.put(next);
		this.remapMonths(prev, next);
		this.publish();
		this.events.emit('calendar:saved', { calendar: clone(next) });
		return { before: clone(prev), after: clone(next) };
	}

	setMain(id: string): void {
		if (!this.store.has(id) || this.mainId() === id) return;
		this.updateWorld({ mainCalendar: id });
	}

	/** Remove a calendar (dates that use it are kept and shown in the main calendar). */
	remove(id: string): { calendar: Calendar; wasMain: boolean } | null {
		const c = this.store.get(id);
		if (!c) return null;
		const wasMain = this.mainId() === id;
		this.store.delete(id);
		if (wasMain) this.updateWorld({ mainCalendar: this.mainId() });
		this.publish();
		this.events.emit('calendar:deleted', { calendar: clone(c) });
		return { calendar: clone(c), wasMain };
	}

	/** Put a removed or changed calendar back exactly as it was (Undo). */
	restore(doc: Calendar, makeMain = false): void {
		const cur = this.store.get(doc.id);
		const next = { ...clone(doc), updatedAt: Date.now(), rev: Math.max(doc.rev, cur?.rev ?? 0) + 1 };
		this.store.put(next);
		if (cur) this.remapMonths(cur, next);
		if (makeMain) this.updateWorld({ mainCalendar: doc.id });
		this.publish();
		this.events.emit('calendar:saved', { calendar: clone(next) });
	}

	/** Is a date written in this calendar? (Dates without one are in the main calendar.) */
	private uses(id: string): (d: ChronoDate) => boolean {
		const main = this.mainId();
		return (d) => (d.calendar && this.store.has(d.calendar) ? d.calendar === id : id === main);
	}

	/** How many dates fall in a month (1-based) of this calendar. */
	monthUsage(id: string, month: number): number {
		const uses = this.uses(id);
		let n = 0;
		this.eachDate((d) => {
			if (uses(d) && !d.festival && d.month === month) n++;
			return d;
		});
		return n;
	}

	/**
	 * Dates store a month by its place in the year, so when months are moved or removed
	 * every date in this calendar follows its month (by id). Undo moves them back.
	 */
	private remapMonths(prev: Calendar, next: Calendar): void {
		const map = new Map<number, number>();
		prev.months.forEach((m, i) => {
			const j = next.months.findIndex((x) => x.id === m.id);
			if (j >= 0 && j !== i) map.set(i + 1, j + 1);
		});
		if (!map.size) return;
		// Only dates that name this calendar, or name none while it is the main one (dates of
		// a deleted calendar are left for when it comes back).
		const isMain = this.mainId() === prev.id;
		this.eachDate((d) => {
			if (d.festival || d.month == null || !map.has(d.month)) return d;
			if (d.calendar) return d.calendar === prev.id ? { ...d, month: map.get(d.month)! } : d;
			if (!isMain) return d;
			// A date without a calendar is tied to this one now, so switching the main
			// calendar before an Undo can't move it twice.
			const era = matchEra(prev, d.era);
			const out: ChronoDate = { ...d, calendar: prev.id, year: absoluteYear(d, prev), month: map.get(d.month)! };
			if (era) out.era = era.id;
			return out;
		}, true);
	}

	/** Visit every stored date (entry fields, connection dates); `write` saves changed ones. */
	private eachDate(fn: (d: ChronoDate) => ChronoDate, write = false): void {
		const walk = (v: unknown): unknown => (isChronoDate(v) ? fn(v) : Array.isArray(v) ? v.map(walk) : v);
		for (const e of [...this.entities.values()]) {
			const patch: Record<string, unknown> = {};
			for (const [k, v] of Object.entries(e.values)) {
				if (k === '_orphaned') continue;
				const w = walk(v);
				if (write && JSON.stringify(w) !== JSON.stringify(v)) patch[k] = w;
			}
			if (Object.keys(patch).length) this.entities.update(e.id, { values: patch });
		}
		for (const edge of this.relations().allEdges()) {
			const start = edge.start ? (walk(edge.start) as ChronoDate) : edge.start;
			const end = edge.end ? (walk(edge.end) as ChronoDate) : edge.end;
			if (write && (start !== edge.start || end !== edge.end)) this.relations().updateEdge(edge.id, { start, end });
		}
	}

	/** How many dates (entry fields and connection dates) are written in this calendar. */
	usage(id: string): number {
		const main = this.mainId();
		const uses = (d: ChronoDate) => (d.calendar ? d.calendar === id : id === main);
		let n = 0;
		const scan = (v: unknown) => {
			if (isChronoDate(v)) n += uses(v) ? 1 : 0;
			else if (Array.isArray(v)) v.forEach(scan);
		};
		for (const e of this.entities.values()) {
			if (e.trashedAt) continue;
			for (const v of Object.values(e.values)) scan(v);
		}
		for (const edge of this.relations().allEdges()) {
			scan(edge.start);
			scan(edge.end);
		}
		return n;
	}

	newMonth(name = 'New month', days = 30): CalendarMonth {
		return { id: sid(), name, days };
	}

	newFestival(after: number): CalendarFestival {
		return { id: sid(), name: 'Festival', after, days: 1, every: 1 };
	}

	newEra(start: number): CalendarEra {
		return { id: sid(), name: 'New era', abbr: '', start, direction: 'up', firstYear: 1, color: null };
	}

	/** Hand the open world's calendars to the date engine. */
	private publish(): void {
		setActiveCalendars(this.store.all(), this.mainId());
	}

	dispose(): void {
		for (const s of this.subs.splice(0)) s.dispose();
		setActiveCalendars([], null);
	}
}
