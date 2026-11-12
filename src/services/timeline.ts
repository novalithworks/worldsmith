import { chronoPosition, eraOf, mainCalendar } from '../core/calendar/engine';
import type { EntityRecord, EntitySchema, FieldDefinition, SemanticColor, TimelineConfig } from '../core/types';
import { isChronoDate, type ChronoDate } from '../core/types/chrono';
import type { WorldSession } from './WorldSession';

/**
 * The timeline's data (0.10): every entry with a date, placed on the world's line of
 * years. Each type contributes a start date and, when it has one, an end date; those
 * fields are guessed from their names (Start/End, Birth/Death, Founded/Dissolved…) unless
 * the world chose them in `world.timeline.spans`.
 */

export interface TimelineItem {
	entity: EntityRecord;
	schema: EntitySchema;
	start: number;
	end: number | null;
	startDate: ChronoDate;
	endDate: ChronoDate | null;
	/** The field the start came from (or the end, for entries with only an end). */
	field: FieldDefinition;
}

export interface TimelineBand {
	id: string;
	name: string;
	start: number;
	end: number;
	color: SemanticColor | null;
	/** An era entry (opens it) or one of the main calendar's eras. */
	entityId: string | null;
	/** The era entry's description, for hover cards (empty for calendar eras). */
	description?: string;
}

export interface TimelineData {
	items: TimelineItem[];
	bands: TimelineBand[];
	/** Entries of the shown types that have no date yet. */
	undated: number;
	min: number;
	max: number;
}

const START_WORDS = 'start|starts|started|begin|begins|began|birth|born|founded|foundation|created|creation|from|since|established|opened|crowned|date';
const END_WORDS = 'end|ends|ended|death|died|dissolved|destroyed|fell|fall|until|closed|abolished|disbanded';
/** A word in the label, or the first or last word of a camelCase id ("reignEnd"). */
const matcher = (words: string) => {
	const label = new RegExp(`\\b(${words})\\b`, 'i');
	const id = new RegExp(`^(${words})(?![a-z])|(${words.split('|').map((w) => w[0]!.toUpperCase() + w.slice(1)).join('|')})$`);
	return (f: FieldDefinition) => label.test(f.label) || id.test(f.id);
};
const START = matcher(START_WORDS);
const END = matcher(END_WORDS);

const chronoFields = (s: EntitySchema) => s.fields.filter((f) => f.type === 'chrono');

/** Which fields give a type's start and end on the timeline. */
export function spanFields(schema: EntitySchema, config?: TimelineConfig): { start: FieldDefinition | null; end: FieldDefinition | null } {
	const fields = chronoFields(schema);
	const chosen = config?.spans[schema.id];
	if (chosen) {
		const start = fields.find((f) => f.id === chosen.start) ?? null;
		const end = chosen.end ? (fields.find((f) => f.id === chosen.end && f.id !== start?.id) ?? null) : null;
		if (start) return { start, end };
	}
	const named = (test: (f: FieldDefinition) => boolean, except?: FieldDefinition | null) => fields.find((f) => f !== except && test(f));
	const end = named(END) ?? null;
	const start = named(START, end) ?? fields.find((f) => f !== end) ?? null;
	return start ? { start, end: end && end !== start ? end : null } : { start: end, end: null };
}

/** Types with at least one date field. */
export function datedTypes(s: WorldSession): EntitySchema[] {
	return s.schemas.list().filter((t) => !t.archived && chronoFields(t).length > 0);
}

export function collectTimeline(s: WorldSession, o: { types?: string[]; tags?: string[]; entityIds?: Set<string> } = {}): TimelineData {
	const config = s.world.timeline;
	const types = datedTypes(s).filter((t) => !o.types?.length || o.types.includes(t.id));
	const tags = (o.tags ?? []).map((t) => t.toLowerCase());
	const items: TimelineItem[] = [];
	const bands: TimelineBand[] = [];
	let undated = 0;
	const bandTypes = new Set(config.bands);
	for (const schema of types) {
		const { start: sf, end: ef } = spanFields(schema, config);
		if (!sf) continue;
		for (const e of s.entities.values()) {
			if (e.typeId !== schema.id || e.trashedAt) continue;
			if (o.entityIds && !o.entityIds.has(e.id)) continue;
			if (tags.length && !e.tags.some((t) => tags.includes(t.toLowerCase()))) continue;
			const a = e.values[sf.id];
			const b = ef ? e.values[ef.id] : undefined;
			const sd = isChronoDate(a) ? a : isChronoDate(b) ? b : null;
			if (!sd) {
				undated++;
				continue;
			}
			const ed = isChronoDate(a) && isChronoDate(b) ? b : null;
			let start = chronoPosition(sd);
			let end = ed ? chronoPosition(ed) : null;
			if (end != null && end < start) [start, end] = [end, start];
			if (bandTypes.has(schema.id)) {
				bands.push({ id: e.id, name: e.name, start, end: end ?? start, color: schema.color ?? null, entityId: e.id, description: e.description });
				// On the full timeline eras are the bands; in an entry's widget they're rows.
				if (!o.entityIds) continue;
			}
			items.push({ entity: e, schema, start, end, startDate: sd, endDate: ed, field: isChronoDate(a) ? sf : ef! });
		}
	}
	items.sort((x, y) => x.start - y.start || (x.end ?? x.start) - (y.end ?? y.start) || x.entity.name.localeCompare(y.entity.name));
	let min = Infinity;
	let max = -Infinity;
	for (const it of items) {
		min = Math.min(min, it.start);
		max = Math.max(max, it.end ?? it.start);
	}
	for (const b of bands) {
		min = Math.min(min, b.start);
		max = Math.max(max, b.end);
	}
	if (!Number.isFinite(min)) {
		min = 0;
		max = 100;
	}
	// Eras of the main calendar, clipped to what's shown.
	const cal = mainCalendar();
	const ups = cal.eras.filter((e) => e.direction === 'up').sort((a, b) => a.start - b.start);
	for (const era of cal.eras) {
		let from: number;
		let to: number;
		if (era.direction === 'up') {
			const next = ups.find((x) => x.start > era.start);
			from = era.start;
			to = next ? next.start : Math.max(max, era.start) + 1;
		} else {
			const prev = cal.eras.filter((x) => x.direction === 'down' && x.start < era.start).sort((a, b) => b.start - a.start)[0];
			from = prev ? prev.start + 1 : Math.min(min, era.start) - 1;
			to = era.start + 1;
		}
		if (to <= min - 1 || from >= max + 1) continue;
		bands.push({ id: `era:${era.id}`, name: era.name, start: Math.max(from, min - 1), end: Math.min(to, max + 1), color: era.color ?? null, entityId: null });
	}
	return { items, bands, undated, min, max };
}

/** The era (main calendar) a year falls in, for list headings. */
export function eraHeading(pos: number): string | null {
	const cal = mainCalendar();
	return eraOf(cal, Math.floor(pos))?.name ?? null;
}

/** Tick spacing in years for a given pixels-per-year, so labels stay ~90px apart. */
export function tickStep(pxPerYear: number): number {
	const target = 90 / Math.max(pxPerYear, 1e-9);
	const pow = 10 ** Math.floor(Math.log10(Math.max(target, 1e-9)));
	for (const m of [1, 2, 5, 10]) if (pow * m >= target) return Math.max(1, pow * m);
	return Math.max(1, pow * 10);
}

/** Greedy row packing: the first row whose last item ends before this one starts. */
export function packRows<T>(list: T[], left: (x: T) => number, right: (x: T) => number, gap = 8): Array<{ item: T; row: number }> {
	const ends: number[] = [];
	return list.map((item) => {
		const l = left(item);
		let row = ends.findIndex((e) => e + gap <= l);
		if (row === -1) {
			row = ends.length;
			ends.push(0);
		}
		ends[row] = right(item);
		return { item, row };
	});
}
