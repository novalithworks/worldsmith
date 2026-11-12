import type { EntityRecord, ManuscriptItem } from '../../core/types';

/**
 * WS5 (0.22): scenes and the world. A scene stores only entry ids (point of view, cast,
 * location), so names, pictures and notes always come from the entry itself. Pure: no
 * Obsidian, no DOM.
 */

export type SceneRole = 'pov' | 'cast' | 'location';

export const ROLE_WORDS: Record<SceneRole, string> = { pov: 'Point of view', cast: 'In the scene', location: 'Where' };

/** Every entry id a scene points at, with its roles. */
export function sceneLinks(it: Pick<ManuscriptItem, 'pov' | 'cast' | 'location'>): Map<string, SceneRole[]> {
	const out = new Map<string, SceneRole[]>();
	const add = (id: string | null | undefined, r: SceneRole) => {
		if (!id) return;
		const cur = out.get(id) ?? [];
		if (!cur.includes(r)) cur.push(r);
		out.set(id, cur);
	};
	add(it.pov, 'pov');
	for (const id of it.cast ?? []) add(id, 'cast');
	add(it.location, 'location');
	return out;
}

/** Does a scene involve this entry (in any role)? */
export function sceneHas(it: Pick<ManuscriptItem, 'pov' | 'cast' | 'location'>, entityId: string): boolean {
	return it.pov === entityId || it.location === entityId || (it.cast ?? []).includes(entityId);
}

export interface Appearance {
	scene: ManuscriptItem;
	roles: SceneRole[];
}

/** Scenes (not trashed) an entry is in, in the order given (book order). */
export function appearancesOf(scenes: ManuscriptItem[], entityId: string): Appearance[] {
	const out: Appearance[] = [];
	for (const s of scenes) {
		if (s.kind !== 'scene' || s.trashedAt) continue;
		const roles = sceneLinks(s).get(entityId);
		if (roles) out.push({ scene: s, roles });
	}
	return out;
}

/** Add an entry to a cast (no duplicates, order kept). */
export function withCast(cast: string[], id: string): string[] {
	return cast.includes(id) ? cast : [...cast, id];
}

/** Remove an entry from a cast. */
export function withoutCast(cast: string[], id: string): string[] {
	return cast.filter((x) => x !== id);
}

function escapeRe(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Entries whose name or an alias appears in a text as a whole word (case-insensitive; letters
 * of any script count as word characters). Names shorter than 3 letters are ignored, so "Al"
 * or "Io" don't match everywhere. Trashed entries are skipped. Ordered by first appearance.
 */
export function findMentions(text: string, entities: Iterable<Pick<EntityRecord, 'id' | 'name' | 'aliases' | 'trashedAt'>>, o: { exclude?: Set<string>; limit?: number } = {}): string[] {
	if (!text) return [];
	const found: Array<{ id: string; at: number }> = [];
	const hay = text.normalize('NFC');
	for (const e of entities) {
		if (e.trashedAt || o.exclude?.has(e.id)) continue;
		let best = -1;
		for (const n of [e.name, ...(e.aliases ?? [])]) {
			const name = (n ?? '').trim().normalize('NFC');
			if ([...name].length < 3) continue;
			// A whole word: the character before is matched (not looked behind, for older iPhones).
			const re = new RegExp(`(^|[^\\p{L}\\p{N}_])${escapeRe(name)}(?![\\p{L}\\p{N}_])`, 'iu');
			const m = re.exec(hay);
			const at = m ? m.index + m[1]!.length : -1;
			if (m && (best < 0 || at < best)) best = at;
		}
		if (best >= 0) found.push({ id: e.id, at: best });
	}
	found.sort((a, b) => a.at - b.at);
	return found.slice(0, o.limit ?? 12).map((f) => f.id);
}

/** A scene with an in-story date, for the world timeline (WS5). */
export interface DatedScene {
	scene: ManuscriptItem;
	projectId: string;
	projectName: string;
	pos: number;
}

/**
 * Live scenes that have an in-story date, in story order: by date (position in the calendar),
 * then time of day, then reading order. `positionOf` turns a date into its calendar position.
 */
export function datedScenes(projects: Array<{ id: string; name: string; scenes: ManuscriptItem[] }>, positionOf: (d: NonNullable<ManuscriptItem['date']>) => number): DatedScene[] {
	const out: Array<DatedScene & { order: number; min: number }> = [];
	for (const p of projects) {
		p.scenes.forEach((s, i) => {
			if (s.kind !== 'scene' || s.trashedAt || !s.date) return;
			const m = /^(\d{1,2}):(\d{2})$/.exec(s.time ?? '');
			out.push({ scene: s, projectId: p.id, projectName: p.name, pos: positionOf(s.date), order: i, min: m ? Number(m[1]) * 60 + Number(m[2]) : -1 });
		});
	}
	out.sort((a, b) => a.pos - b.pos || a.min - b.min || a.projectName.localeCompare(b.projectName) || a.order - b.order);
	return out.map(({ scene, projectId, projectName, pos }) => ({ scene, projectId, projectName, pos }));
}

/** Who has an arc to follow in a project: entries that are a scene's point of view or in its cast. */
export interface ArcPerson {
	id: string;
	scenes: number;
	pov: number;
}

/** People of a project's scenes, most present first (then by point-of-view scenes). Places don't count. */
export function arcPeople(scenes: ManuscriptItem[]): ArcPerson[] {
	const by = new Map<string, ArcPerson>();
	for (const s of scenes) {
		if (s.kind !== 'scene' || s.trashedAt) continue;
		const ids = new Set([...(s.cast ?? []), ...(s.pov ? [s.pov] : [])]);
		for (const id of ids) {
			const p = by.get(id) ?? { id, scenes: 0, pov: 0 };
			p.scenes++;
			if (s.pov === id) p.pov++;
			by.set(id, p);
		}
	}
	return [...by.values()].sort((a, b) => b.scenes - a.scenes || b.pov - a.pov);
}
