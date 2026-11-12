/*
 * Words written this session (WS3): for each of a project's notes, its words now minus its
 * words the first time the studio knew them since Obsidian started. Counted note by note, so
 * a note counted late (after a restart, or found later) starts from its own first count and
 * never shows up as words written. Nothing is stored; goals and history are WS6.
 *
 * Split and merge (and their undo) move text between notes without anyone writing it: for a
 * short while after one, the notes it touched keep the words they had, whatever their counts
 * do, so the session doesn't jump.
 */

interface Session {
	/** Each note's words when the session first knew them. */
	base: Map<string, number>;
	/** Each note's words at the last count. */
	last: Map<string, number>;
	/** Notes whose words written are fixed for now (split, merge), and until when. */
	held: Map<string, { written: number; until: number }>;
	/** All the project's notes are held until then (an undo, which can touch any note). */
	allUntil: number;
	allWritten: Map<string, number>;
}

const sessions = new Map<string, Session>();
/** How long counts may take to catch up after a split or merge. */
export const SESSION_HOLD_MS = 8000;

function sessionOf(projectId: string): Session {
	let s = sessions.get(projectId);
	if (!s) {
		s = { base: new Map(), last: new Map(), held: new Map(), allUntil: 0, allWritten: new Map() };
		sessions.set(projectId, s);
	}
	return s;
}

/**
 * The words written in a project this session, given each note's words now (null while a
 * note hasn't been counted). A note's first known count is its starting point. Null until
 * at least one note has been counted.
 */
export function sessionDelta(projectId: string, notes: Iterable<[path: string, words: number | null]>, now = Date.now()): number | null {
	const s = sessionOf(projectId);
	let delta = 0;
	let known = false;
	for (const [path, words] of notes) {
		if (words === null) continue;
		known = true;
		s.last.set(path, words);
		const b = s.base.get(path);
		if (b === undefined) {
			s.base.set(path, words);
			continue;
		}
		const h = s.held.get(path);
		const fixed = h && h.until > now ? h.written : s.allUntil > now ? s.allWritten.get(path) : undefined;
		if (fixed !== undefined) {
			// Keep what was written in this note; its count moving now isn't writing.
			s.base.set(path, words - fixed);
			delta += fixed;
		} else delta += words - b;
	}
	for (const [p, h] of s.held) if (h.until <= now) s.held.delete(p);
	return known ? delta : null;
}

/**
 * Text is about to move between notes without being written (a split or merge): hold these
 * notes' words written as they are now. `null` holds every note of the project (an undo).
 */
export function holdSession(projectId: string, paths: Array<string | null | undefined> | null, now = Date.now(), ms = SESSION_HOLD_MS): void {
	const s = sessionOf(projectId);
	const written = (p: string) => {
		const b = s.base.get(p);
		const l = s.last.get(p);
		return b === undefined || l === undefined ? undefined : l - b;
	};
	if (paths === null) {
		s.allUntil = now + ms;
		s.allWritten = new Map();
		for (const p of s.base.keys()) {
			const w = written(p);
			if (w !== undefined) s.allWritten.set(p, w);
		}
		return;
	}
	for (const p of paths) {
		if (!p) continue;
		const w = written(p);
		// A note the session hasn't counted yet starts from its first count anyway.
		if (w !== undefined) s.held.set(p, { written: w, until: now + ms });
	}
}

/** "+312 words this session", "−40 words this session", "No words yet this session". Pure. */
export function sessionLabel(delta: number): string {
	if (delta === 0) return 'No new words yet this session';
	const n = Math.abs(delta).toLocaleString();
	return `${delta > 0 ? '+' : '−'}${n} ${Math.abs(delta) === 1 ? 'word' : 'words'} this session`;
}
