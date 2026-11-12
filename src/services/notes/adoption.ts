import type { EntityRecord } from '../../core/types';

/**
 * Adopting existing notes (0.18): a note the person already has becomes an entry's main
 * note exactly as it is. Worldsmith links it by path and never writes into it. Pure: no
 * Obsidian, no DOM. The planner decides; `applyAdoption` creates the entries.
 */

/** A note offered for adoption, as read from the vault (front matter keys only for identity). */
export interface AdoptCandidate {
	path: string;
	/** File name without `.md`. */
	basename: string;
	extension: string;
	/** `worldsmith-id` (native notes) or `worldsmith` (older linked notes), when the note has one. */
	wsId?: string | null;
	/** `worldsmith-world`, when the note has one. */
	wsWorld?: string | null;
}

/** An entry that already holds a note. */
export interface NoteClaim {
	entityId: string;
	name: string;
	how: 'main' | 'extra' | 'native';
	trashed: boolean;
}

export type SkipReason = 'linked' | 'duplicate' | 'not-note' | 'data-folder' | 'other-world';

export interface AdoptRow {
	path: string;
	/** The entry's name (the file name, tidied). */
	name: string;
	action: 'create' | 'skip';
	reason?: SkipReason;
	/** For `linked`: the entry that already has this note. */
	claim?: NoteClaim;
}

/** The entry name a note gives: its file name, with spaces tidied. */
export function nameFromFile(basename: string): string {
	return basename.replace(/\s+/g, ' ').trim() || 'Untitled';
}

/** Every note path an entry already holds, and by which entry. */
export function noteClaims(entities: Iterable<EntityRecord>): { byPath: Map<string, NoteClaim>; byId: Map<string, NoteClaim> } {
	const byPath = new Map<string, NoteClaim>();
	const byId = new Map<string, NoteClaim>();
	for (const e of entities) {
		const base = { entityId: e.id, name: e.name, trashed: !!e.trashedAt };
		const add = (path: string | undefined | null, how: NoteClaim['how']) => {
			if (path && !byPath.has(path)) byPath.set(path, { ...base, how });
		};
		add(e.nativeNote?.path, 'native');
		add(e.linkedNote?.path, 'main');
		for (const n of e.moreNotes ?? []) add(n.path, 'extra');
		byId.set(e.id, { ...base, how: e.nativeNote ? 'native' : 'main' });
	}
	return { byPath, byId };
}

/**
 * What adopting these notes would do. A note becomes a new entry unless it isn't a
 * Markdown note, sits in Worldsmith's data folder, is listed twice, already belongs to an
 * entry (by path, or by a Worldsmith id naming an entry of this world), or is a note of
 * another Worldsmith world.
 */
export function planAdoption(
	candidates: AdoptCandidate[],
	claims: { byPath: Map<string, NoteClaim>; byId: Map<string, NoteClaim> },
	o: { worldId: string; dataFolder: string },
): AdoptRow[] {
	const seen = new Set<string>();
	const root = o.dataFolder.replace(/\/+$/, '');
	return candidates.map((c): AdoptRow => {
		const row = { path: c.path, name: nameFromFile(c.basename) };
		if (c.extension.toLowerCase() !== 'md') return { ...row, action: 'skip', reason: 'not-note' };
		if (root && (c.path === root || c.path.startsWith(`${root}/`))) return { ...row, action: 'skip', reason: 'data-folder' };
		if (seen.has(c.path)) return { ...row, action: 'skip', reason: 'duplicate' };
		seen.add(c.path);
		const byPath = claims.byPath.get(c.path);
		if (byPath) return { ...row, action: 'skip', reason: 'linked', claim: byPath };
		const world = typeof c.wsWorld === 'string' ? c.wsWorld.trim() : '';
		if (world && world !== o.worldId) return { ...row, action: 'skip', reason: 'other-world' };
		const id = typeof c.wsId === 'string' ? c.wsId.trim() : '';
		const byId = id ? claims.byId.get(id) : undefined;
		if (byId) return { ...row, action: 'skip', reason: 'linked', claim: byId };
		return { ...row, action: 'create' };
	});
}

/** Plain words for a skipped note. */
export function skipText(row: AdoptRow): string {
	switch (row.reason) {
		case 'linked':
			return row.claim ? `Already the note of “${row.claim.name}”${row.claim.trashed ? ' (in the trash)' : ''}` : 'Already linked to an entry';
		case 'duplicate':
			return 'Listed twice';
		case 'not-note':
			return 'Not a Markdown note';
		case 'data-folder':
			return 'Inside Worldsmith’s data folder';
		case 'other-world':
			return 'A note of another Worldsmith world';
		default:
			return '';
	}
}

/** The bit of a session `applyAdoption` needs. */
export interface AdoptionHost {
	create(typeId: string, init: { name: string }): EntityRecord;
	linkMain(entityId: string, path: string): void;
	trash(entityId: string): void;
}

/**
 * Create one entry per `create` row, each with its note as the main note. Never touches a
 * note. Returns the new entries and an undo that moves them to the trash.
 */
export function applyAdoption(host: AdoptionHost, typeId: string, rows: AdoptRow[]): { created: EntityRecord[]; undo: () => void } {
	const created: EntityRecord[] = [];
	for (const r of rows) {
		if (r.action !== 'create') continue;
		const e = host.create(typeId, { name: r.name });
		host.linkMain(e.id, r.path);
		created.push(e);
	}
	return { created, undo: () => created.forEach((e) => host.trash(e.id)) };
}
