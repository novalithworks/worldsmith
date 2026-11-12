import { endMarker, fenceCloses, fenceOpen, hashText, normalizeText, parseNote, startMarker, type Fence } from './format';

/**
 * Turning existing entries into native notes (0.17), pure planning.
 *
 * Nothing here touches the vault. The service gathers the facts (which notes exist, which
 * entry a note says it belongs to) and this decides, per entry, what a migration would do:
 * create a note, link a note that is already the entry's, or skip, and why. The dry run
 * shows exactly this plan; the run follows it.
 */

export type MigrationAction = 'create' | 'link' | 'skip';

export interface MigrationFacts {
	id: string;
	name: string;
	typeId: string;
	typeName: string;
	archived: boolean;
	trashed: boolean;
	hasNative: boolean;
	/** The entry's linked note (the pre-0.17 kind), when it has one. */
	linked: { path: string; exists: boolean; claimedBy: string | null; nativeOf: string | null; otherWorld?: boolean } | null;
	/** Notes elsewhere in the vault whose `worldsmith-id` / `worldsmith` key names this entry and that no entry uses as its native note. */
	claimedNotes: string[];
	/** Folder for a new note, and its file name without `.md`. */
	folder: string;
	baseName: string;
	/** Long-text fields with text: they will be written into the note's sections. */
	longFilled: string[];
	/** For a note that will be linked: its `## Label` sections that become the field's section. */
	adopt?: string[];
}

export interface MigrationRow {
	id: string;
	name: string;
	typeId: string;
	typeName: string;
	action: MigrationAction;
	path?: string;
	/** Plain-language reason (skips and clashes). */
	reason?: string;
	/** A note with the usual name already exists and isn't this entry's: a numbered name is used. */
	clash?: boolean;
	longFilled: string[];
	adopt: string[];
}

export interface MigrationPlan {
	rows: MigrationRow[];
	counts: { create: number; link: number; skip: number; clash: number; adopt: number; long: number };
}

/**
 * Decide per entry. `taken(path)` says whether a vault file exists at a path. Paths are never
 * shared: two entries never get the same new note, and no note is linked twice.
 */
export function planMigration(facts: MigrationFacts[], taken: (path: string) => boolean): MigrationPlan {
	const used = new Set<string>();
	const linking = new Set<string>();
	const rows: MigrationRow[] = [];
	const freePath = (folder: string, base: string): { path: string; clash: false | 'note' | 'entry' } => {
		const at = (n: number) => `${folder ? `${folder}/` : ''}${base}${n > 1 ? ` ${n}` : ''}.md`;
		let n = 1;
		while (taken(at(n)) || used.has(at(n).toLowerCase())) n++;
		return { path: at(n), clash: n === 1 ? false : taken(at(1)) ? 'note' : 'entry' };
	};
	for (const f of facts) {
		const row: MigrationRow = { id: f.id, name: f.name, typeId: f.typeId, typeName: f.typeName, action: 'skip', longFilled: f.longFilled, adopt: [] };
		rows.push(row);
		if (f.hasNative) {
			row.reason = 'Already has a native note';
			continue;
		}
		if (f.trashed) {
			row.reason = 'In the trash';
			continue;
		}
		if (f.archived) {
			row.reason = 'Archived';
			continue;
		}
		const l = f.linked;
		const linkable = (path: string) => !linking.has(path.toLowerCase());
		if (l?.exists && !l.nativeOf && !l.otherWorld && (!l.claimedBy || l.claimedBy === f.id) && linkable(l.path)) {
			row.action = 'link';
			row.path = l.path;
			row.adopt = f.adopt ?? [];
			linking.add(l.path.toLowerCase());
			continue;
		}
		const claims = f.claimedNotes.filter(linkable);
		if (!l?.exists && claims.length > 1) {
			row.reason = `${claims.length} notes say they belong to this entry; link the right one yourself`;
			continue;
		}
		if (!l?.exists && claims.length === 1) {
			row.action = 'link';
			row.path = claims[0]!;
			row.adopt = f.adopt ?? [];
			linking.add(claims[0]!.toLowerCase());
			continue;
		}
		const p = freePath(f.folder, f.baseName);
		row.action = 'create';
		row.path = p.path;
		used.add(p.path.toLowerCase());
		const shown = p.path.split('/').pop()!.replace(/\.md$/, '');
		if (p.clash === 'note') {
			row.clash = true;
			row.reason = `A note called “${f.baseName}” already exists; it is left alone and the new note is “${shown}”`;
		} else if (p.clash === 'entry') {
			row.reason = `Another entry is also called “${f.baseName}”; this one’s note is “${shown}”`;
		}
		if (l?.exists) {
			// Its linked note is someone else's native note (or says it belongs to another entry).
			row.clash = true;
			row.reason = [row.reason, `Its linked note “${l.path.split('/').pop()!.replace(/\.md$/, '')}” belongs to ${l.otherWorld ? 'another world' : 'another entry'}, so a new note is made`].filter(Boolean).join('. ');
		}
	}
	const counts = { create: 0, link: 0, skip: 0, clash: 0, adopt: 0, long: 0 };
	for (const r of rows) {
		counts[r.action]++;
		if (r.clash) counts.clash++;
		counts.adopt += r.adopt.length;
		if (r.action !== 'skip') counts.long += r.longFilled.length;
	}
	return { rows, counts };
}

// ── adopting a note's own sections ──────────────────────────────────────────────

export interface AdoptField {
	id: string;
	label: string;
	/** The heading line Worldsmith writes for this field (e.g. `## Biography`). */
	heading: string;
	/** The field's text in Worldsmith ('' when empty). */
	ws: string;
}

export interface Adoption {
	id: string;
	label: string;
	/** Offsets of the section: from its heading line to the end of its last non-blank line. */
	start: number;
	end: number;
}

const HEADING_LINE = /^(#{1,6})[ \t]+(.*?)[ \t#]*$/;
const MARKER_LINE = /^%%\s*ws-(start|end)\b/;

/**
 * A linked note's own sections that already are a field's section: a heading exactly like
 * the one Worldsmith would write, outside code and outside Worldsmith's parts, whose text is
 * what the field holds (or the field is empty). Those get Worldsmith's markers around them,
 * so the text stays exactly where it is and becomes the field's. Anything else is left as
 * the person's own text.
 */
export function findAdoptions(text: string, fields: AdoptField[]): Adoption[] {
	const p = parseNote(text);
	const inRegion = (at: number) => p.regions.some((r) => at >= r.outerStart && at <= r.outerEnd);
	const have = new Set([...p.regions.map((r) => r.id), ...p.broken]);
	const ls: Array<{ start: number; end: number; text: string }> = [];
	for (let i = 0, start = 0; i <= text.length; i++) {
		if (i === text.length || text[i] === '\n') {
			const raw = text.slice(start, i);
			ls.push({ start, end: start + raw.replace(/\r$/, '').length, text: raw.replace(/\r$/, '') });
			start = i + 1;
		}
	}
	let first = 0;
	if (p.frontMatter) first = ls.findIndex((l) => l.start >= p.frontMatter!.end);
	if (first < 0) return [];
	const out: Adoption[] = [];
	const done = new Set<string>();
	let fence: Fence | null = null;
	for (let k = first; k < ls.length; k++) {
		const ln = ls[k]!;
		if (fence) {
			if (fenceCloses(fence, ln.text)) fence = null;
			continue;
		}
		const f = fenceOpen(ln.text);
		if (f) {
			fence = f;
			continue;
		}
		if (inRegion(ln.start)) continue;
		const h = HEADING_LINE.exec(ln.text);
		if (!h) continue;
		const field = fields.find((x) => !done.has(x.id) && !have.has(x.id) && x.heading.trim() === ln.text.trim());
		if (!field) continue;
		const level = h[1]!.length;
		// The section runs to the next heading of the same or a higher level, a marker, a fence, or the end.
		let last = k;
		let inner: Fence | null = null;
		for (let j = k + 1; j < ls.length; j++) {
			const t = ls[j]!.text;
			if (inner) {
				if (fenceCloses(inner, t)) inner = null;
				last = j;
				continue;
			}
			const ff = fenceOpen(t);
			if (ff) {
				inner = ff;
				last = j;
				continue;
			}
			if (!inner) {
				const hh = HEADING_LINE.exec(t);
				if ((hh && hh[1]!.length <= level) || MARKER_LINE.test(t) || inRegion(ls[j]!.start)) break;
			}
			if (t.trim()) last = j;
		}
		if (inner) continue; // an unclosed code block: leave it alone
		const end = ls[last]!.end;
		const body = normalizeText(text.slice(ls[k]!.end, end));
		if (field.ws && normalizeText(field.ws) !== body) continue;
		out.push({ id: field.id, label: field.label, start: ln.start, end });
		done.add(field.id);
		k = last;
	}
	return out;
}

/** Put Worldsmith's markers around adopted sections. Only marker lines are added. */
export function wrapAdoptions(text: string, adoptions: Adoption[]): string {
	const eol = text.includes('\r\n') ? '\r\n' : '\n';
	let out = text;
	for (const a of [...adoptions].sort((x, y) => y.start - x.start)) {
		out = out.slice(0, a.start) + startMarker('field', a.id) + eol + out.slice(a.start, a.end) + eol + endMarker(a.id) + out.slice(a.end);
	}
	return out;
}

// ── the record kept until Confirm ───────────────────────────────────────────────

export const MIGRATION_FORMAT = 'worldsmith/note-migration';
/** Safety copies are kept this long unless confirmed or undone first. */
export const MIGRATION_KEEP_MS = 30 * 24 * 60 * 60 * 1000;

export interface EntrySnapshot {
	values: Record<string, unknown>;
	description: string;
	aliases: string[];
	tags: string[];
	status: string | null;
	linkedNote: { path: string } | null;
	moreNotes: Array<{ path: string; label?: string }>;
}

export interface MigrationRecordEntry {
	id: string;
	name: string;
	action: 'create' | 'link';
	path: string;
	/** The note's text before (links only): put back exactly on Undo. */
	noteBefore: string | null;
	/** Hash of the note right after the migration: Undo only touches a note still like that. */
	noteAfterHash: string | null;
	before: EntrySnapshot;
	after: EntrySnapshot;
}

export interface MigrationRecord {
	format: typeof MIGRATION_FORMAT;
	v: 1;
	id: string;
	createdAt: number;
	scope: { kind: 'entry' | 'type' | 'world'; id?: string; label: string };
	backupPath: string | null;
	entries: MigrationRecordEntry[];
}

/** Values Undo may put back: only those that still are what the migration left. */
export function undoPatch(cur: EntrySnapshot, entry: Pick<MigrationRecordEntry, 'before' | 'after'>): { patch: Partial<EntrySnapshot>; kept: string[] } {
	const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
	const patch: Partial<EntrySnapshot> = {};
	const kept: string[] = [];
	const values: Record<string, unknown> = { ...cur.values };
	let valuesChanged = false;
	for (const k of new Set([...Object.keys(entry.before.values), ...Object.keys(entry.after.values)])) {
		if (same(entry.before.values[k], entry.after.values[k])) continue;
		if (!same(cur.values[k], entry.after.values[k])) {
			kept.push(k);
			continue;
		}
		values[k] = entry.before.values[k];
		valuesChanged = true;
	}
	if (valuesChanged) patch.values = values;
	for (const k of ['description', 'aliases', 'tags', 'status'] as const) {
		if (same(entry.before[k], entry.after[k])) continue;
		if (!same(cur[k], entry.after[k])) {
			kept.push(k);
			continue;
		}
		(patch as Record<string, unknown>)[k] = entry.before[k];
	}
	return { patch, kept };
}

/** Whether Undo may put a note back: it must still be exactly what the migration wrote. */
export function noteUnchanged(current: string | null, entry: Pick<MigrationRecordEntry, 'noteAfterHash'>): boolean {
	return current !== null && entry.noteAfterHash !== null && hashText(current) === entry.noteAfterHash;
}

export function isExpired(rec: Pick<MigrationRecord, 'createdAt'>, now: number): boolean {
	return now - rec.createdAt >= MIGRATION_KEEP_MS;
}
