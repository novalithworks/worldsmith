import type { EntityRecord, MapDoc, MapItemKind, MapLayer, MapPath, MapPin, MapRegion } from '../core/types';
import type { WorldSession } from './WorldSession';

/**
 * Maps (0.11): the arithmetic behind pins, areas and routes. Positions are 0–1 across the
 * map on each axis; distances are measured in "map widths" and turned into the world's
 * own units with the map's scale. Pure, so the page, widgets and tests share it.
 */

export type MapItem = MapPin | MapRegion | MapPath;
export interface MapItemRef {
	kind: MapItemKind;
	id: string;
}

export const ITEM_NOUN: Record<MapItemKind, string> = { pin: 'Pin', region: 'Area', path: 'Route' };

export function itemsOf(doc: MapDoc, kind: MapItemKind): MapItem[] {
	return kind === 'pin' ? doc.pins : kind === 'region' ? doc.regions : doc.paths;
}

export function findItem(doc: MapDoc, ref: MapItemRef | null | undefined): MapItem | undefined {
	if (!ref) return undefined;
	return (itemsOf(doc, ref.kind)).find((i) => i.id === ref.id);
}

/** A patch that replaces one item (by id) in its list. */
export function patchItem(doc: MapDoc, ref: MapItemRef, patch: Partial<MapPin & MapRegion & MapPath>): Partial<MapDoc> {
	const key = ref.kind === 'pin' ? 'pins' : ref.kind === 'region' ? 'regions' : 'paths';
	return { [key]: (doc[key] as MapItem[]).map((i) => (i.id === ref.id ? { ...i, ...patch } : i)) };
}

export function removeItem(doc: MapDoc, ref: MapItemRef): Partial<MapDoc> {
	const key = ref.kind === 'pin' ? 'pins' : ref.kind === 'region' ? 'regions' : 'paths';
	return { [key]: (doc[key] as MapItem[]).filter((i) => i.id !== ref.id) };
}

/** The name shown for an item: its own label, else its entry's name, else "Pin". */
export function itemLabel(s: WorldSession, item: MapItem, kind: MapItemKind): string {
	if (item.label.trim()) return item.label.trim();
	const e = item.entityId ? s.entities.get(item.entityId) : undefined;
	if (e && !e.trashedAt) return e.name;
	return ITEM_NOUN[kind];
}

export function layerOf(doc: MapDoc, item: MapItem): MapLayer | undefined {
	return item.layerId ? doc.layers.find((l) => l.id === item.layerId) : undefined;
}

/** Hidden when its layer is switched off. Items on a layer that no longer exists show. */
export function itemVisible(doc: MapDoc, item: MapItem): boolean {
	const l = layerOf(doc, item);
	return !l || l.visible;
}

/** Points in "map width" units (y is stretched by the map's shape). */
const toUnits = (p: [number, number], aspect: number): [number, number] => [p[0], p[1] / aspect];

/** Length of a line through the points, in map widths. */
export function polylineLength(points: Array<[number, number]>, aspect: number): number {
	let d = 0;
	for (let i = 1; i < points.length; i++) {
		const a = toUnits(points[i - 1]!, aspect);
		const b = toUnits(points[i]!, aspect);
		d += Math.hypot(b[0] - a[0], b[1] - a[1]);
	}
	return d;
}

/** Area of a polygon, in square map widths. */
export function polygonArea(points: Array<[number, number]>, aspect: number): number {
	let a = 0;
	for (let i = 0; i < points.length; i++) {
		const p = toUnits(points[i]!, aspect);
		const q = toUnits(points[(i + 1) % points.length]!, aspect);
		a += p[0] * q[1] - q[0] * p[1];
	}
	return Math.abs(a) / 2;
}

/** Where to put an area's name: its centre of mass (or the middle of its corners). */
export function centroid(points: Array<[number, number]>): [number, number] {
	if (!points.length) return [0.5, 0.5];
	let a = 0;
	let cx = 0;
	let cy = 0;
	for (let i = 0; i < points.length; i++) {
		const [x0, y0] = points[i]!;
		const [x1, y1] = points[(i + 1) % points.length]!;
		const f = x0 * y1 - x1 * y0;
		a += f;
		cx += (x0 + x1) * f;
		cy += (y0 + y1) * f;
	}
	if (Math.abs(a) < 1e-9) {
		const n = points.length;
		return [points.reduce((t, p) => t + p[0], 0) / n, points.reduce((t, p) => t + p[1], 0) / n];
	}
	return [cx / (3 * a), cy / (3 * a)];
}

/** The point halfway along a line (for a route's name). */
export function midpoint(points: Array<[number, number]>): [number, number] {
	if (points.length < 2) return points[0] ?? [0.5, 0.5];
	const total = polylineLength(points, 1);
	let walked = 0;
	for (let i = 1; i < points.length; i++) {
		const a = points[i - 1]!;
		const b = points[i]!;
		const d = Math.hypot(b[0] - a[0], b[1] - a[1]);
		if (walked + d >= total / 2) {
			const t = d ? (total / 2 - walked) / d : 0;
			return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
		}
		walked += d;
	}
	return points[points.length - 1]!;
}

const trim = (n: number): string => {
	const r = n >= 100 ? Math.round(n) : n >= 10 ? Math.round(n * 10) / 10 : Math.round(n * 100) / 100;
	return r.toLocaleString('en', { maximumFractionDigits: 2 });
};

/** "42 miles" from a length in map widths, or "12% of the map" without a scale. */
/**
 * The map's scale from two points a known distance apart (the Set scale tool, 0.12):
 * how far it is across the whole map, in the same unit. Null when the points coincide.
 */
export function scaleFromPoints(a: [number, number], b: [number, number], aspect: number, distance: number, unit: string): { width: number; unit: string } | null {
	const len = polylineLength([a, b], aspect);
	if (!(len > 1e-6) || !(distance > 0) || !Number.isFinite(distance)) return null;
	const width = distance / len;
	// Keep it readable: four significant figures is plenty for a hand-picked scale.
	return { width: Number(width.toPrecision(4)), unit: unit.trim() || 'miles' };
}

export function formatDistance(widths: number, scale: MapDoc['scale']): string {
	if (!scale) return `${trim(widths * 100)}% of the map’s width`;
	return `${trim(widths * scale.width)} ${scale.unit}`;
}

export function formatArea(sqWidths: number, scale: MapDoc['scale']): string | null {
	if (!scale) return null;
	return `${trim(sqWidths * scale.width * scale.width)} sq ${scale.unit}`;
}

/** A round number for the scale bar: 1, 2, 5, 10, 20, 50… */
export function niceStep(target: number): number {
	if (!(target > 0) || !Number.isFinite(target)) return 1;
	const p = Math.pow(10, Math.floor(Math.log10(target)));
	const f = target / p;
	return (f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10) * p;
}

/** Ray casting: is the point inside the polygon? */
export function pointInPolygon(p: [number, number], poly: Array<[number, number]>): boolean {
	let inside = false;
	for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
		const [xi, yi] = poly[i]!;
		const [xj, yj] = poly[j]!;
		if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi || 1e-12) + xi) inside = !inside;
	}
	return inside;
}

export interface MapMention {
	map: MapDoc;
	/** Pins, areas and routes linked to the entry. */
	items: Array<{ kind: MapItemKind; item: MapItem }>;
	/** The map is of this entry (its "This map shows"). */
	isOf: boolean;
}

/**
 * Every map an entry appears on, best first: maps of the entry itself, then maps where
 * it has a pin, an area or a route.
 */
export function mapsOf(s: WorldSession, entityId: string): MapMention[] {
	const out: MapMention[] = [];
	for (const map of s.maps.list()) {
		const items: MapMention['items'] = [];
		for (const kind of ['pin', 'region', 'path'] as const) for (const item of itemsOf(map, kind)) if (item.entityId === entityId) items.push({ kind, item });
		const isOf = map.entityId === entityId;
		if (items.length || isOf) out.push({ map, items, isOf });
	}
	return out.sort((a, b) => Number(b.isOf) - Number(a.isOf) || b.items.length - a.items.length);
}

/** Maps that open from a pin on this map, and the maps whose pins open this one. */
export function parentMaps(s: WorldSession, mapId: string): Array<{ map: MapDoc; pin: MapPin }> {
	const out: Array<{ map: MapDoc; pin: MapPin }> = [];
	for (const map of s.maps.list()) for (const pin of map.pins) if (pin.mapId === mapId && map.id !== mapId) out.push({ map, pin });
	return out;
}

/** Problems worth a look: links to entries in the trash or gone, pins opening a missing map. */
export function mapProblems(s: WorldSession, doc: MapDoc): Array<{ kind: MapItemKind; item: MapItem; problem: 'trashed' | 'missing' | 'no-map'; entity?: EntityRecord }> {
	const out: ReturnType<typeof mapProblems> = [];
	for (const kind of ['pin', 'region', 'path'] as const) {
		for (const item of itemsOf(doc, kind)) {
			if (item.entityId) {
				const e = s.entities.get(item.entityId);
				if (!e) out.push({ kind, item, problem: 'missing' });
				else if (e.trashedAt) out.push({ kind, item, problem: 'trashed', entity: e });
			}
			if (kind === 'pin' && (item as MapPin).mapId && !s.maps.has((item as MapPin).mapId!)) out.push({ kind, item, problem: 'no-map' });
		}
	}
	return out;
}

/** The pin (or area, or route) that best stands for an entry on a map. */
export function itemFor(doc: MapDoc, entityId: string): MapItemRef | null {
	for (const kind of ['pin', 'region', 'path'] as const) {
		const it = (itemsOf(doc, kind)).find((i) => i.entityId === entityId);
		if (it) return { kind, id: it.id };
	}
	return null;
}

/** Bounding box of an item, 0–1. */
export function itemBox(item: MapItem, kind: MapItemKind): [number, number, number, number] {
	if (kind === 'pin') {
		const p = item as MapPin;
		return [p.x, p.y, p.x, p.y];
	}
	const pts = (item as MapRegion | MapPath).points;
	if (!pts.length) return [0.5, 0.5, 0.5, 0.5];
	return [Math.min(...pts.map((p) => p[0])), Math.min(...pts.map((p) => p[1])), Math.max(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[1]))];
}
