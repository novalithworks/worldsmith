import type { EntityRecord, EntitySchema, FieldDefinition } from '../../core/types';
import type { FieldTypeRegistry } from '../../fields/FieldTypeRegistry';
import type { WorldSession } from '../WorldSession';

/**
 * Markdown export (Milestone 9): each entry as a note — properties as YAML frontmatter
 * (readable by Obsidian's Properties and Dataview), the summary, then every section with its
 * long text, and links to other exported entries as [[wikilinks]]. Pure: it returns file
 * contents; the caller writes them (and never overwrites a note it didn't write itself, which
 * it can tell from the `worldsmith-id` property).
 */

export interface NotesExportOptions {
	/** Vault folder; each type gets a subfolder named after it. */
	folder: string;
	/** Linked entries (and statuses of links) as [[wikilinks]] to their exported notes. */
	wikilinks: boolean;
	/** Leave out fields that are empty. */
	skipEmpty: boolean;
}

export interface PlannedNote {
	entityId: string;
	path: string;
	content: string;
}

/** A file-name-safe version of a name (Obsidian forbids \ / : * ? " < > | # ^ [ ]). */
export function safeFileName(name: string): string {
	const base = name
		.replace(/[\\/:*?"<>|#^[\]]+/g, ' ')
		.replace(/\s+/g, ' ')
		.trim()
		.replace(/^\.+/, '');
	return (base || 'Untitled').slice(0, 120);
}

const yamlKey = (label: string) =>
	label
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-|-$/g, '') || 'field';

/** JSON is valid YAML, and quotes every string safely. */
const yaml = (v: unknown) => JSON.stringify(v);

const SHORT_KINDS = new Set(['text', 'number', 'percent', 'rating', 'progress', 'boolean', 'select', 'multiselect', 'list', 'tags', 'date', 'chrono', 'url', 'color', 'time', 'relation', 'parent', 'rollup', 'formula']);
const LONG_KINDS = new Set(['longtext', 'richtext']);

/** Paths for every entry, unique within their folder (a second “Kael” becomes “Kael (2)”). */
export function notePaths(s: WorldSession, entries: EntityRecord[], folder: string): Map<string, string> {
	const out = new Map<string, string>();
	const used = new Set<string>();
	const root = folder.replace(/^\/+|\/+$/g, '');
	for (const e of entries) {
		const schema = s.schemas.get(e.typeId);
		const dir = [root, safeFileName(schema?.plural ?? 'Entries')].filter(Boolean).join('/');
		const base = safeFileName(e.name);
		let path = `${dir}/${base}.md`;
		for (let n = 2; used.has(path.toLowerCase()); n++) path = `${dir}/${base} (${n}).md`;
		used.add(path.toLowerCase());
		out.set(e.id, path);
	}
	return out;
}

function linkTo(paths: Map<string, string>, id: string, name: string, wikilinks: boolean): string {
	const p = paths.get(id);
	if (!wikilinks || !p) return name;
	return `[[${p.replace(/\.md$/, '')}|${name}]]`;
}

export function buildNote(s: WorldSession, fieldTypes: FieldTypeRegistry, e: EntityRecord, schema: EntitySchema, paths: Map<string, string>, o: NotesExportOptions): string {
	const fm: string[] = ['---', `worldsmith-id: ${yaml(e.id)}`, `worldsmith-world: ${yaml(s.worldId)}`, `worldsmith-type: ${yaml(schema.singular)}`];
	const status = s.world.statuses.find((x) => x.id === e.status);
	if (status) fm.push(`status: ${yaml(status.label)}`);
	if (e.aliases.length) fm.push(`aliases: ${yaml(e.aliases)}`);
	if (e.tags.length) fm.push(`tags: ${yaml(e.tags.map((t) => t.replace(/\s+/g, '-')))}`);
	const parent = e.parentId ? s.entities.get(e.parentId) : undefined;
	if (parent) fm.push(`parent: ${yaml(linkTo(paths, parent.id, parent.name, o.wikilinks))}`);
	const usedKeys = new Set(['worldsmith-id', 'worldsmith-world', 'worldsmith-hash', 'worldsmith-type', 'status', 'aliases', 'tags', 'parent']);
	const body: string[] = [];

	const shortValue = (f: FieldDefinition): unknown => {
		if (f.type === 'relation') {
			const linked = s.relations.linked(e.id, f).filter((l) => !s.entities.get(l.id)?.trashedAt);
			return linked.map((l) => linkTo(paths, l.id, l.name, o.wikilinks));
		}
		const raw = s.values.get(e, f);
		const type = fieldTypes.for(f);
		if (type.isEmpty(raw)) return null;
		if (f.type === 'number' || f.type === 'percent' || f.type === 'rating' || f.type === 'progress') return typeof raw === 'number' ? raw : s.values.text(e, f);
		if (f.type === 'boolean') return raw === true;
		if (f.type === 'multiselect' || f.type === 'list' || f.type === 'tags') return s.values.text(e, f).split(', ').filter(Boolean);
		return s.values.text(e, f);
	};

	for (const f of schema.fields) {
		if (f.hidden || !SHORT_KINDS.has(f.type)) continue;
		const v = shortValue(f);
		const empty = v === null || v === '' || (Array.isArray(v) && !v.length);
		if (empty && o.skipEmpty) continue;
		let key = yamlKey(f.label);
		for (let n = 2; usedKeys.has(key); n++) key = `${yamlKey(f.label)}-${n}`;
		usedKeys.add(key);
		fm.push(`${key}: ${empty ? 'null' : yaml(v)}`);
	}
	fm.push('---', '');

	body.push(`# ${e.name}`, '');
	const portrait = e.media.portrait?.path;
	if (portrait) body.push(`![[${portrait}|240]]`, '');
	if (e.description.trim()) body.push(e.description.trim().split('\n').map((l) => `> ${l}`).join('\n'), '');
	for (const sec of schema.sections) {
		const longFields = sec.fieldIds.map((id) => schema.fields.find((f) => f.id === id)).filter((f): f is FieldDefinition => !!f && !f.hidden && LONG_KINDS.has(f.type));
		const parts: string[] = [];
		for (const f of longFields) {
			const v = s.values.get(e, f);
			const text = typeof v === 'string' ? v.trim() : '';
			if (!text) continue;
			parts.push(longFields.length > 1 || f.label !== sec.label ? `### ${f.label}\n\n${text}` : text);
		}
		if (parts.length) body.push(`## ${sec.label}`, '', parts.join('\n\n'), '');
	}
	const gallery = e.media.gallery.filter((g) => g.path);
	if (gallery.length) body.push('## Gallery', '', gallery.map((g) => `![[${g.path}|200]]${g.caption ? `\n*${g.caption}*` : ''}`).join('\n\n'), '');
	return stampNote(`${fm.join('\n')}${body.join('\n').trimEnd()}\n`);
}

/** FNV-1a, as 8 hex digits: enough to notice that a note was edited. */
function hash(text: string): string {
	let h = 0x811c9dc5;
	for (let i = 0; i < text.length; i++) {
		h ^= text.charCodeAt(i);
		h = Math.imul(h, 0x01000193);
	}
	return (h >>> 0).toString(16).padStart(8, '0');
}

const HASH_LINE = /^worldsmith-hash: .*\r?\n/m;
const normalize = (t: string) => t.replace(/\r\n/g, '\n').replace(/^\uFEFF/, '');

/** Add a `worldsmith-hash` of the note, right after its `worldsmith-id`. */
function stampNote(content: string): string {
	const h = hash(normalize(content));
	return content.replace(/^(worldsmith-id: .*\n)/m, `$1worldsmith-hash: "${h}"\n`);
}

/**
 * What a note in the vault is, as far as the export is concerned: one it wrote (which entry
 * and world), and whether it was edited since — an edited note is never written over.
 */
export function exportedNoteInfo(content: string): { id: string; world: string | null; edited: boolean } | null {
	const id = exportedIdOf(content);
	if (!id) return null;
	const fm = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n---/.exec(content)?.[1] ?? '';
	const world = /^worldsmith-world:\s*"?([^"\r\n]+?)"?\s*$/m.exec(fm)?.[1] ?? null;
	const stored = /^worldsmith-hash:\s*"?([0-9a-f]{8})"?\s*$/m.exec(fm)?.[1] ?? null;
	const edited = !stored || hash(normalize(content).replace(HASH_LINE, '')) !== stored;
	return { id, world, edited };
}

/** The entries an export of these types covers, in a stable order. */
export function noteEntries(s: WorldSession, typeIds: string[]): EntityRecord[] {
	return s.entities
		.all()
		.filter((e) => !e.trashedAt && typeIds.includes(e.typeId) && s.schemas.get(e.typeId))
		.sort((a, b) => a.typeId.localeCompare(b.typeId) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

export function planNotes(s: WorldSession, fieldTypes: FieldTypeRegistry, typeIds: string[], o: NotesExportOptions): PlannedNote[] {
	const entries = noteEntries(s, typeIds);
	const paths = notePaths(s, entries, o.folder);
	return entries.map((e) => ({ entityId: e.id, path: paths.get(e.id)!, content: buildNote(s, fieldTypes, e, s.schemas.get(e.typeId)!, paths, o) }));
}

/** The worldsmith-id a note's frontmatter carries (null: not a note this export wrote). */
export function exportedIdOf(content: string): string | null {
	const fm = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n---\s*(?:\r?\n|$)/.exec(content);
	if (!fm) return null;
	const m = /^worldsmith-id:\s*"?([^"\r\n]+?)"?\s*$/m.exec(fm[1]!);
	return m ? m[1]!.trim() : null;
}
