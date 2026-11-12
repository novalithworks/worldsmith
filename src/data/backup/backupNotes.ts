/**
 * Native notes in backups and world files (0.17), pure.
 *
 * A backup carries each native note's path and full text next to the world's JSON.
 * Restoring never overwrites a note: a missing note is written back, an identical one is left
 * alone, and a note that differs keeps its text while the backup's version is written next to
 * it as “<name> (restored).md” (or “(copy)” for a world imported as a copy), which the
 * entry then uses.
 */

export interface BackupNote {
	path: string;
	content: string;
}

/** A vault path a backup may write a note to: relative, a Markdown file, no `..`, not hidden. */
export function safeNotePath(path: unknown): path is string {
	if (typeof path !== 'string' || !path.endsWith('.md') || path.length > 1024) return false;
	if (path.startsWith('/') || path.includes('\\') || path.includes('\0')) return false;
	return path.split('/').every((p) => p !== '' && p !== '.' && p !== '..' && !p.startsWith('.'));
}

export interface NoteRestoreStep {
	from: string;
	to: string;
	/** False when the note is already there exactly. */
	write: boolean;
	content: string;
}

/**
 * Where each note of a backup goes. `current(path)` is the vault's text at a path (null when
 * there is no file). Paths are never shared between two notes.
 */
export function planNoteRestore(notes: BackupNote[], current: (path: string) => string | null, suffix: 'restored' | 'copy'): NoteRestoreStep[] {
	const out: NoteRestoreStep[] = [];
	const used = new Set<string>();
	for (const n of notes) {
		if (!safeNotePath(n.path) || typeof n.content !== 'string') continue;
		const cur = current(n.path);
		if (!used.has(n.path.toLowerCase()) && (cur === null || cur === n.content)) {
			used.add(n.path.toLowerCase());
			out.push({ from: n.path, to: n.path, write: cur === null, content: n.content });
			continue;
		}
		const base = n.path.slice(0, -3);
		let to = '';
		for (let i = 1; ; i++) {
			to = `${base} (${suffix}${i > 1 ? ` ${i}` : ''}).md`;
			if (used.has(to.toLowerCase())) continue;
			const c = current(to);
			if (c === null || c === n.content) break;
		}
		used.add(to.toLowerCase());
		out.push({ from: n.path, to, write: current(to) === null, content: n.content });
	}
	return out;
}

/** Entries follow their notes to where they were restored (nativeNote, linkedNote, moreNotes). */
export function remapNotePaths(files: Record<string, unknown>, moved: Map<string, string>): Record<string, unknown> {
	if (!moved.size) return files;
	const fix = (o: Record<string, unknown>) => {
		for (const k of ['nativeNote', 'linkedNote'] as const) {
			const v = o[k] as { path?: unknown } | null | undefined;
			if (v && typeof v.path === 'string' && moved.has(v.path)) o[k] = { ...v, path: moved.get(v.path) };
		}
		if (Array.isArray(o.moreNotes)) o.moreNotes = (o.moreNotes as Array<{ path?: unknown }>).map((m) => (m && typeof m.path === 'string' && moved.has(m.path) ? { ...m, path: moved.get(m.path) } : m));
	};
	const walk = (v: unknown): unknown => {
		if (Array.isArray(v)) return v.map(walk);
		if (v && typeof v === 'object') {
			const o: Record<string, unknown> = {};
			for (const [k, x] of Object.entries(v as Record<string, unknown>)) o[k] = walk(x);
			if ('nativeNote' in o || 'linkedNote' in o) fix(o);
			return o;
		}
		return v;
	};
	return walk(files) as Record<string, unknown>;
}

/** A note of a world imported as a copy names the copy (only the `worldsmith-world` line changes). */
export function rewriteWorldKey(content: string, oldId: string, newId: string): string {
	const m = /^(\uFEFF?---\r?\n)([\s\S]*?)(\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$))/.exec(content);
	if (!m) return content;
	const esc = oldId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	const yaml = m[2]!.replace(new RegExp(`^(worldsmith-world:[ \\t]*)(["']?)${esc}\\2([ \\t]*)$`, 'm'), `$1$2${newId}$2$3`);
	return m[1] + yaml + m[3] + content.slice(m[0].length);
}
