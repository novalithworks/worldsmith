import type { Disposable } from '../../core/util/disposable';

/**
 * The few vault operations the Writing Studio needs, by path. The app passes Obsidian's
 * vault in (`obsidianVault.ts`); tests pass an in-memory one. Keeping it this small makes
 * the safety rules easy to check: there is no delete, no rename and no plain overwrite —
 * notes are only ever created (never over an existing file) or changed through
 * `process`, which hands over the current text and writes the result atomically.
 */
export interface NoteFile {
	path: string;
	mtime: number;
	size: number;
}

export type VaultChange =
	| { type: 'create' | 'modify' | 'delete'; path: string; folder: boolean }
	| { type: 'rename'; path: string; oldPath: string; folder: boolean };

export interface ManuscriptVault {
	/** A file (not a folder) at this path. */
	file(path: string): NoteFile | null;
	/** Anything (file or folder) at this path. */
	exists(path: string): boolean;
	isFolder(path: string): boolean;
	/** Every Markdown note inside a folder and its subfolders ('' = the whole vault). */
	markdownFiles(folder: string): NoteFile[];
	read(path: string): Promise<string>;
	/** Obsidian's cached copy: cheap, used for word counts. */
	cachedRead(path: string): Promise<string>;
	/** Create a new note. Must fail when anything already exists at the path. */
	create(path: string, text: string): Promise<NoteFile>;
	createFolder(path: string): Promise<void>;
	/** Change a note's text atomically; when `fn` throws, nothing is written. */
	process(path: string, fn: (text: string) => string): Promise<string>;
	onChange(cb: (change: VaultChange) => void): Disposable;
}

/** "a//b/" → "a/b"; leading "./" and slashes removed. */
export function cleanPath(path: string): string {
	return path
		.replace(/\\/g, '/')
		.split('/')
		.filter((p) => p && p !== '.')
		.join('/');
}

export function joinVaultPath(...parts: string[]): string {
	return cleanPath(parts.filter(Boolean).join('/'));
}

export function parentFolder(path: string): string {
	const i = path.lastIndexOf('/');
	return i < 0 ? '' : path.slice(0, i);
}

export function fileName(path: string): string {
	return path.slice(path.lastIndexOf('/') + 1);
}

/** "Chapters/Scene 1.md" → "Scene 1". */
export function baseName(path: string): string {
	return fileName(path).replace(/\.md$/i, '');
}

/** A scene title from a note's name, without an ordering number: "01 Ash on the wind" → "Ash on the wind". */
export function sceneTitle(path: string): string {
	const name = baseName(path);
	const bare = name.replace(/^\s*\d+\s*[-._)]?\s+/, '').trim();
	return bare || name;
}

/** Is `path` the folder itself or anything inside it? ('' contains everything.) */
export function inFolder(path: string, folder: string): boolean {
	return !folder || path === folder || path.startsWith(`${folder}/`);
}

/** Characters not allowed in vault file names. */
export function safeNoteName(name: string): string {
	const cleaned = name.replace(/[\\/:*?"<>|#^[\]]/g, ' ').replace(/\s+/g, ' ').trim();
	return cleaned.slice(0, 120).replace(/^\.+/, '').trim() || 'Untitled';
}

/** Natural order ("Scene 2" before "Scene 10"), ignoring case and accents. */
export const naturalCompare = (a: string, b: string): number => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }) || (a < b ? -1 : a > b ? 1 : 0);

/** Natural order of paths, folder by folder (a folder's notes sort by their own names). */
export function naturalPathCompare(a: string, b: string): number {
	const pa = a.split('/');
	const pb = b.split('/');
	for (let i = 0; i < Math.min(pa.length, pb.length); i++) {
		// Names without ".md" so "Scene 1.md" sorts before "Scene 1 b.md".
		const c = naturalCompare(pa[i]!.replace(/\.md$/i, ''), pb[i]!.replace(/\.md$/i, ''));
		if (c) return c;
	}
	return pa.length - pb.length;
}

/** A note path nothing uses yet: "Scene.md", then "Scene 2.md", … (any case counts as taken). */
export function freeNotePath(vault: ManuscriptVault, folder: string, name: string, skip = 0): string {
	const base = safeNoteName(name);
	const lower = new Set(vault.markdownFiles(folder).map((f) => f.path.toLowerCase()));
	const taken = (p: string) => vault.exists(p) || lower.has(p.toLowerCase());
	// `skip` steps past names that failed to create although they looked free.
	let n = 1 + skip;
	let path = joinVaultPath(folder, n === 1 ? `${base}.md` : `${base} ${n}.md`);
	while (taken(path)) path = joinVaultPath(folder, `${base} ${++n}.md`);
	return path;
}

/** Make a folder and its parents (existing ones are fine). */
export async function ensureVaultFolder(vault: ManuscriptVault, folder: string): Promise<void> {
	let cur = '';
	for (const part of cleanPath(folder).split('/').filter(Boolean)) {
		cur = cur ? `${cur}/${part}` : part;
		if (vault.isFolder(cur)) continue;
		if (vault.exists(cur)) throw new Error(`“${cur}” is a file, not a folder.`);
		try {
			await vault.createFolder(cur);
		} catch (e) {
			// Created meanwhile (e.g. by Sync) — fine.
			if (!vault.isFolder(cur)) throw e;
		}
	}
}

/**
 * Write a brand-new note at a free path and return it. Never replaces anything: when the
 * name is taken between choosing and writing (a double click, Sync), the next free name
 * is tried.
 */
export async function createNewNote(vault: ManuscriptVault, folder: string, name: string, text: string): Promise<NoteFile> {
	await ensureVaultFolder(vault, folder);
	let lastError: unknown;
	for (let attempt = 0; attempt < 6; attempt++) {
		const path = freeNotePath(vault, folder, name, attempt);
		try {
			return await vault.create(path, text);
		} catch (e) {
			lastError = e;
		}
	}
	throw lastError instanceof Error ? lastError : new Error(String(lastError));
}
