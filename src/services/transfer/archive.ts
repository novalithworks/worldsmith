import { sha256Hex, unsafeZipPath, unzip, ZipError, type ZipInput, type ZipLimits, DEFAULT_ZIP_LIMITS } from '../../core/util/zip';
import { unsafeJsonReason } from '../../core/util/safeJson';

/**
 * World archives (0.19): one `.worldsmith.zip` with everything a world needs in another vault.
 * Pure: no Obsidian, no DOM (Web Crypto and streams only), so it is tested headless.
 *
 *   manifest.json            what's inside, checksums, versions, what was left out and why
 *   README.txt               the same in plain words, for anyone opening the ZIP by hand
 *   world/<path>             every data file of the world folder, byte for byte
 *   vault/<vault path>       notes, images and attachments, byte for byte, at their own paths
 *
 * Importing never trusts the archive (see `inspectArchive`) and never overwrites a file
 * (see `planPlacements`): a different file already at a path makes the imported one land
 * beside it, and only the references that point at a moved file are changed.
 */

export const ARCHIVE_FORMAT = 'worldsmith/archive';
export const ARCHIVE_VERSION = 1;
export const ARCHIVE_EXT = '.worldsmith.zip';

export type ArchiveFileKind = 'data' | 'note' | 'media' | 'attachment';
export type ArchiveNoteRole = 'native' | 'adopted' | 'extra' | 'scene';

export interface ArchiveFile {
	/** Path inside the ZIP (`world/…` or `vault/…`). */
	path: string;
	size: number;
	sha256: string;
	kind: ArchiveFileKind;
}

/** A link inside an included note to another included file (for remapping on import). */
export interface ArchiveLink {
	/** The link text as written (`Midland`, `Art/seris.svg`). */
	link: string;
	/** The vault path it pointed at when exported. */
	target: string;
}

export interface ArchiveNote {
	vaultPath: string;
	role: ArchiveNoteRole;
	/** Entries this note belongs to. */
	entityIds: string[];
	/** Scenes this note is (Writing Studio). */
	sceneIds: string[];
	links: ArchiveLink[];
}

export type DependencyReason = 'missing' | 'not-chosen' | 'remote' | 'unsupported';

export interface ArchiveDependency {
	vaultPath: string;
	reason: DependencyReason;
	/** Who needs it, in plain words (“Ava — portrait”). */
	usedBy: string[];
}

export interface ArchiveCounts {
	entries: number;
	types: number;
	relations: number;
	tasks: number;
	maps: number;
	calendars: number;
	projects: number;
	scenes: number;
	layouts: number;
	views: number;
	dashboards: number;
	notes: number;
	images: number;
	attachments: number;
}

export interface ArchiveManifest {
	format: typeof ARCHIVE_FORMAT;
	v: number;
	/** Worldsmith version that made it. */
	app: string;
	createdAt: number;
	world: { id: string; name: string };
	/** Data versions: folder layout and every record kind. */
	schema: { storage: number; records: Record<string, number> };
	counts: ArchiveCounts;
	files: ArchiveFile[];
	notes: ArchiveNote[];
	/** Left out on purpose (not chosen, remote, unsupported). */
	excluded: ArchiveDependency[];
	/** Needed but not found when exporting. */
	missing: ArchiveDependency[];
	/** Set on backups (0.20): what made it. Absent on exports. */
	purpose?: { kind: string };
	/** SHA-256 over the world's data and notes (not images): equal means nothing changed. */
	fingerprint?: string;
}

/** One hash for the world's data and notes, from their file hashes (images left out). */
export async function fingerprintOf(files: ArchiveFile[]): Promise<string> {
	const lines = files
		.filter((f) => f.kind === 'data' || f.kind === 'note')
		.map((f) => `${f.path}\t${f.sha256}`)
		.sort()
		.join('\n');
	return sha256Hex(new TextEncoder().encode(lines));
}

export const SAFE_WORLD_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

/** File types an archive may carry into the vault (never executed; anything else is refused). */
export const VAULT_EXTS = new Set(['md', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'svg', 'bmp', 'heic', 'tif', 'tiff', 'ico', 'mp3', 'wav', 'ogg', 'm4a', 'flac', 'mp4', 'webm', 'mov', 'pdf', 'txt', 'csv', 'canvas', 'json']);

export function extOf(path: string): string {
	const name = path.split('/').pop() ?? path;
	const i = name.lastIndexOf('.');
	return i > 0 ? name.slice(i + 1).toLowerCase() : '';
}

/**
 * Why a vault path from an archive mustn't be written, or null. On top of the ZIP name
 * rules: no hidden folders (`.obsidian`, `.trash`), nothing inside Worldsmith's data folder,
 * and only the file types in `VAULT_EXTS`.
 */
export function unsafeVaultPath(p: string, dataFolder: string): string | null {
	const bad = unsafeZipPath(p);
	if (bad) return bad;
	if (p.split('/').some((s) => s.startsWith('.'))) return 'hidden folder or file';
	const root = dataFolder.replace(/\/+$/, '');
	if (root && (p === root || p.startsWith(`${root}/`))) return 'inside Worldsmith’s data folder';
	if (!VAULT_EXTS.has(extOf(p))) return `file type “.${extOf(p) || '?'}” isn’t allowed`;
	return null;
}

// ── counting ────────────────────────────────────────────────────────────────

function recordsIn(v: unknown): number {
	const r = (v as { records?: unknown[] } | null)?.records;
	return Array.isArray(r) ? r.length : v && typeof v === 'object' ? 1 : 0;
}

/** Counts from the world's data files (path inside the world folder → parsed JSON). */
export function countWorld(data: Record<string, unknown>, notes: ArchiveNote[], files: ArchiveFile[]): ArchiveCounts {
	let entries = 0;
	let scenes = 0;
	const sum = (prefix: string) => Object.entries(data).filter(([k]) => k.startsWith(prefix)).reduce((n, [, v]) => n + recordsIn(v), 0);
	for (const [k, v] of Object.entries(data)) {
		if (k.startsWith('entities/')) {
			const recs = Array.isArray((v as { records?: unknown[] })?.records) ? (v as { records: Array<{ trashedAt?: unknown }> }).records : [v as { trashedAt?: unknown }];
			entries += recs.filter((r) => r && !r.trashedAt).length;
		}
		if (k.startsWith('writing/manuscript/')) {
			const recs = Array.isArray((v as { records?: unknown[] })?.records) ? (v as { records: Array<{ kind?: string }> }).records : [];
			scenes += recs.filter((r) => r?.kind === 'scene').length;
		}
	}
	const world = data['world.json'] as { dashboards?: unknown[] } | undefined;
	return {
		entries,
		types: sum('schemas/'),
		relations: sum('relations/'),
		tasks: sum('tasks/'),
		maps: sum('maps/'),
		calendars: sum('calendars/'),
		projects: sum('writing/projects/'),
		scenes,
		layouts: sum('layouts/'),
		views: sum('views/'),
		dashboards: Array.isArray(world?.dashboards) ? world.dashboards.length : 0,
		notes: notes.length,
		images: files.filter((f) => f.kind === 'media').length,
		attachments: files.filter((f) => f.kind === 'attachment').length,
	};
}

// ── building ────────────────────────────────────────────────────────────────

export interface ArchiveSource {
	app: string;
	world: { id: string; name: string };
	schema: ArchiveManifest['schema'];
	/** World folder files: path inside the folder → exact bytes. */
	data: Map<string, Uint8Array>;
	/** Vault files: vault path → bytes and kind. */
	vault: Map<string, { data: Uint8Array; kind: Exclude<ArchiveFileKind, 'data'> }>;
	notes: ArchiveNote[];
	excluded: ArchiveDependency[];
	missing: ArchiveDependency[];
	createdAt?: number;
	purpose?: { kind: string };
}

/** The manifest and the ZIP entries for an archive (call `zip` on the entries). */
export async function buildArchive(src: ArchiveSource): Promise<{ manifest: ArchiveManifest; entries: ZipInput[] }> {
	const createdAt = src.createdAt ?? Date.now();
	const entries: ZipInput[] = [];
	const files: ArchiveFile[] = [];
	const parsed: Record<string, unknown> = {};
	const dec = new TextDecoder();
	for (const [rel, data] of [...src.data].sort(([a], [b]) => a.localeCompare(b))) {
		const path = `world/${rel}`;
		files.push({ path, size: data.length, sha256: await sha256Hex(data), kind: 'data' });
		entries.push({ path, data });
		try {
			parsed[rel] = JSON.parse(dec.decode(data));
		} catch {
			/* counted as nothing */
		}
	}
	for (const [vp, f] of [...src.vault].sort(([a], [b]) => a.localeCompare(b))) {
		const path = `vault/${vp}`;
		files.push({ path, size: f.data.length, sha256: await sha256Hex(f.data), kind: f.kind });
		entries.push({ path, data: f.data });
	}
	const manifest: ArchiveManifest = {
		format: ARCHIVE_FORMAT,
		v: ARCHIVE_VERSION,
		app: src.app,
		createdAt,
		world: src.world,
		schema: src.schema,
		counts: countWorld(parsed, src.notes, files),
		files,
		notes: src.notes,
		excluded: src.excluded,
		missing: src.missing,
		...(src.purpose ? { purpose: src.purpose } : {}),
		fingerprint: await fingerprintOf(files),
	};
	const enc = new TextEncoder();
	entries.unshift({ path: 'README.txt', data: enc.encode(readmeText(manifest)) });
	entries.unshift({ path: 'manifest.json', data: enc.encode(JSON.stringify(manifest, null, '\t')) });
	return { manifest, entries };
}

export function readmeText(m: ArchiveManifest): string {
	const c = m.counts;
	const lines = [
		`Worldsmith world archive — ${m.world.name}`,
		`Made ${new Date(m.createdAt).toISOString()} by Worldsmith ${m.app} (archive format ${m.v}).`,
		'',
		'To use it: in Obsidian, open Worldsmith → Import & export → Import world, and choose this file.',
		'Importing never overwrites anything in your vault.',
		'',
		`Inside: ${c.entries} entries, ${c.types} types, ${c.relations} connections, ${c.tasks} tasks, ${c.maps} maps,`,
		`${c.calendars} calendars, ${c.projects} writing projects (${c.scenes} scenes), ${c.notes} notes,`,
		`${c.images} images and ${c.attachments} other attachments.`,
		'',
		'Folders: world/ holds the world’s data files; vault/ holds notes, images and attachments',
		'at the paths they had in the original vault. manifest.json lists every file with its',
		'SHA-256 checksum, and what was left out or missing.',
	];
	if (m.missing.length) lines.push('', `Missing when exported (${m.missing.length}):`, ...m.missing.map((d) => `  ${d.vaultPath} — ${d.usedBy.join(', ')}`));
	if (m.excluded.length) lines.push('', `Left out on purpose (${m.excluded.length}):`, ...m.excluded.map((d) => `  ${d.vaultPath} — ${reasonText(d.reason)}`));
	return lines.join('\n') + '\n';
}

export function reasonText(r: DependencyReason): string {
	return r === 'missing' ? 'not found in the vault' : r === 'not-chosen' ? 'not chosen for this export' : r === 'remote' ? 'a web address (not downloaded)' : 'file type not supported';
}

// ── inspecting (verify, and the first step of every import) ────────────────

export interface InspectOptions {
	/** Versions this Worldsmith understands. */
	storageVersion: number;
	records: Record<string, number>;
	dataFolder: string;
	limits?: ZipLimits;
}

export interface InspectResult {
	ok: boolean;
	/** Reasons the archive can't be imported. */
	problems: string[];
	/** Worth knowing, not blocking (missing or left-out files). */
	warnings: string[];
	manifest: ArchiveManifest | null;
	/** Checked contents, ZIP path → bytes (only when ok). */
	contents: Map<string, Uint8Array>;
	/** World data, path inside the world folder → parsed JSON (only when ok). */
	data: Record<string, unknown>;
	totalBytes: number;
}

/**
 * Read and check an archive without writing anything: ZIP structure and checksums, the
 * manifest, versions, every listed file present with its SHA-256, no unlisted files, safe
 * paths and allowed file types, the world's data files parse, and notes point at files that
 * are there.
 */
export async function inspectArchive(bytes: Uint8Array, o: InspectOptions): Promise<InspectResult> {
	const res: InspectResult = { ok: false, problems: [], warnings: [], manifest: null, contents: new Map(), data: {}, totalBytes: 0 };
	let contents: Map<string, Uint8Array>;
	try {
		contents = await unzip(bytes, o.limits ?? DEFAULT_ZIP_LIMITS);
	} catch (e) {
		res.problems.push(e instanceof ZipError ? `The archive can’t be read: ${e.message}.` : `The archive can’t be read (${e instanceof Error ? e.message : String(e)}).`);
		return res;
	}
	const raw = contents.get('manifest.json');
	if (!raw) {
		res.problems.push('This isn’t a Worldsmith world archive (manifest.json is missing).');
		return res;
	}
	let m: ArchiveManifest;
	try {
		m = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw)) as ArchiveManifest;
	} catch {
		res.problems.push('The archive’s manifest.json is damaged.');
		return res;
	}
	const mWhy = unsafeJsonReason(m);
	if (mWhy) {
		res.problems.push(`The archive’s manifest can’t be used (${mWhy}).`);
		return res;
	}
	if (!m || m.format !== ARCHIVE_FORMAT) {
		res.problems.push('This isn’t a Worldsmith world archive.');
		return res;
	}
	if (typeof m.v !== 'number' || m.v < 1) {
		res.problems.push('The archive’s format version is missing or invalid.');
		return res;
	}
	if (m.v > ARCHIVE_VERSION) {
		res.problems.push(`This archive was made by a newer Worldsmith (${m.app ?? 'unknown version'}, archive format ${m.v}). Update Worldsmith to import it.`);
		return res;
	}
	res.manifest = m;
	if (!m.world || typeof m.world.id !== 'string' || !SAFE_WORLD_ID.test(m.world.id)) res.problems.push('The archive’s world id isn’t valid.');
	if (!Array.isArray(m.files) || !Array.isArray(m.notes) || !Array.isArray(m.excluded) || !Array.isArray(m.missing)) {
		res.problems.push('The archive’s manifest is incomplete.');
		return res;
	}
	if (m.schema && typeof m.schema.storage === 'number' && m.schema.storage > o.storageVersion) res.problems.push(`The world’s data is from a newer Worldsmith (data layout ${m.schema.storage}). Update Worldsmith to import it.`);
	for (const [kind, ver] of Object.entries(m.schema?.records ?? {})) {
		const mine = o.records[kind];
		if (typeof ver === 'number' && typeof mine === 'number' && ver > mine) res.problems.push(`The world’s ${kind} records are from a newer Worldsmith (version ${ver}). Update Worldsmith to import it.`);
	}

	const listed = new Set<string>();
	const vaultPaths = new Set<string>();
	for (const f of m.files) {
		if (!f || typeof f.path !== 'string' || typeof f.sha256 !== 'string') {
			res.problems.push('The manifest lists a file without a name or checksum.');
			continue;
		}
		if (listed.has(f.path.toLowerCase())) res.problems.push(`“${f.path}” is listed twice.`);
		listed.add(f.path.toLowerCase());
		const data = contents.get(f.path);
		if (!data) {
			res.problems.push(`“${f.path}” is listed but missing from the archive.`);
			continue;
		}
		res.totalBytes += data.length;
		if (data.length !== f.size || (await sha256Hex(data)) !== f.sha256) res.problems.push(`“${f.path}” is corrupted (its checksum doesn’t match).`);
		if (f.kind === 'data') {
			if (!f.path.startsWith('world/') || !f.path.endsWith('.json')) res.problems.push(`“${f.path}” isn’t a world data file.`);
			else {
				try {
					const parsed: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(data));
					const why = unsafeJsonReason(parsed);
					if (why) res.problems.push(`“${f.path}” can’t be imported (${why}).`);
					else res.data[f.path.slice(6)] = parsed;
				} catch {
					res.problems.push(`“${f.path}” is damaged (it isn’t valid data).`);
				}
			}
		} else if (f.kind === 'note' || f.kind === 'media' || f.kind === 'attachment') {
			if (!f.path.startsWith('vault/')) {
				res.problems.push(`“${f.path}” is in the wrong folder.`);
				continue;
			}
			const vp = f.path.slice(6);
			const bad = unsafeVaultPath(vp, o.dataFolder);
			if (bad) res.problems.push(`“${vp}” can’t be imported (${bad}).`);
			if (f.kind === 'note' && extOf(vp) !== 'md') res.problems.push(`“${vp}” is listed as a note but isn’t one.`);
			vaultPaths.add(vp);
		} else res.problems.push(`“${f.path}” has an unknown kind.`);
	}
	for (const path of contents.keys()) {
		if (path === 'manifest.json' || path === 'README.txt') continue;
		if (!listed.has(path.toLowerCase())) res.problems.push(`“${path}” is in the archive but not in its manifest.`);
	}
	const world = res.data['world.json'] as { id?: string } | undefined;
	if (!world) res.problems.push('The archive has no world in it (world/world.json is missing).');
	else if (world.id !== m.world?.id) res.problems.push('The archive is damaged (its world ids don’t match).');
	for (const n of m.notes) {
		if (!n || typeof n.vaultPath !== 'string' || !vaultPaths.has(n.vaultPath)) res.problems.push(`A note in the manifest (${n?.vaultPath ?? '?'}) isn’t in the archive.`);
		else if (!Array.isArray(n.links)) n.links = [];
	}
	if (m.missing.length) res.warnings.push(`${m.missing.length} file${m.missing.length === 1 ? ' was' : 's were'} missing when the world was exported, so ${m.missing.length === 1 ? 'it isn’t' : 'they aren’t'} in the archive.`);
	if (m.excluded.length) res.warnings.push(`${m.excluded.length} file${m.excluded.length === 1 ? ' was' : 's were'} left out on purpose.`);
	res.ok = res.problems.length === 0;
	if (res.ok) res.contents = contents;
	else res.data = {};
	return res;
}

// ── planning an import ──────────────────────────────────────────────────────

export interface Placement {
	/** Vault path in the archive. */
	from: string;
	/** Where it goes in this vault. */
	to: string;
	kind: Exclude<ArchiveFileKind, 'data'>;
	/** write: a new file; reuse: an identical file is already there (images only). */
	action: 'write' | 'reuse';
	sha256: string;
}

/**
 * Where each vault file goes. A free path takes the file. An identical image or attachment
 * already there is reused. Anything else lands beside it as “name (imported).ext” (or
 * “(copy)” for a copy, then “… 2”, “… 3”): nothing is ever written over. Notes are never
 * reused, so two worlds never share one note.
 */
export function planPlacements(
	files: ArchiveFile[],
	existing: (path: string) => { exists: boolean; sha256?: string | null },
	o: { suffix: 'imported' | 'copy' },
): { placements: Placement[]; moved: Map<string, string> } {
	const taken = new Set<string>();
	const placements: Placement[] = [];
	const moved = new Map<string, string>();
	const free = (p: string) => !taken.has(p.toLowerCase()) && !existing(p).exists;
	for (const f of files) {
		if (f.kind === 'data') continue;
		const from = f.path.slice(6);
		const here = existing(from);
		let to = from;
		let action: Placement['action'] = 'write';
		if (taken.has(from.toLowerCase())) to = '';
		else if (here.exists) {
			if (f.kind !== 'note' && here.sha256 && here.sha256 === f.sha256) action = 'reuse';
			else to = '';
		}
		if (!to) {
			const dot = from.lastIndexOf('.');
			const base = dot > from.lastIndexOf('/') ? from.slice(0, dot) : from;
			const ext = dot > from.lastIndexOf('/') ? from.slice(dot) : '';
			for (let i = 1; ; i++) {
				const cand = `${base} (${o.suffix}${i > 1 ? ` ${i}` : ''})${ext}`;
				if (free(cand)) {
					to = cand;
					break;
				}
			}
			moved.set(from, to);
		}
		taken.add(to.toLowerCase());
		placements.push({ from, to, kind: f.kind, action, sha256: f.sha256 });
	}
	return { placements, moved };
}

/**
 * The world's data with every reference to a moved file changed: any string equal to a moved
 * vault path (an image's `path`, a note's `path`, a scene's `notePath`, a file field) becomes
 * the new path. Nothing else changes.
 */
export function remapPaths<T>(value: T, moved: Map<string, string>): T {
	if (!moved.size) return value;
	const walk = (v: unknown): unknown => {
		if (typeof v === 'string') return moved.get(v) ?? v;
		if (Array.isArray(v)) return v.map(walk);
		if (v && typeof v === 'object') {
			const out: Record<string, unknown> = {};
			for (const [k, x] of Object.entries(v as Record<string, unknown>)) out[k] = walk(x);
			return out;
		}
		return v;
	};
	return walk(value) as T;
}

function escapeRe(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Point the given links in a note at new link text: `[[old]]`, `[[old|alias]]`,
 * `[[old#heading]]`, `![[old]]` and `[text](old)` (also URL-encoded). Everything else in
 * the note stays byte for byte.
 */
export function rewriteLinks(text: string, changes: Array<{ link: string; to: string }>): string {
	let out = text;
	for (const { link, to } of changes) {
		if (!link || link === to) continue;
		const wiki = new RegExp(`(!?\\[\\[)${escapeRe(link)}(?=(?:[|#^][^\\]]*)?\\]\\])`, 'g');
		out = out.replace(wiki, (_m, open: string) => `${open}${to}`);
		const enc = encodeURI(link);
		for (const variant of new Set([link, enc])) {
			const md = new RegExp(`(\\]\\()${escapeRe(variant)}(?=\\))`, 'g');
			out = out.replace(md, (_m, open: string) => `${open}${variant === enc ? encodeURI(to) : to}`);
		}
	}
	return out;
}
