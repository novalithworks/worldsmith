import { Notice } from 'obsidian';
import type { WritingService } from '../../services/writing/WritingService';

/**
 * WS6 (0.24): a writing sprint. One at a time; it counts the words written in its project
 * while it runs (today's words at the end minus at the start, so it's net like the rest) and
 * is logged in the project when it ends. It keeps running when the studio closes.
 */

export interface Sprint {
	projectId: string;
	start: number;
	minutes: number;
	endsAt: number;
	startWords: number;
}

let current: Sprint | null = null;
let timer: number | null = null;
const listeners = new Set<() => void>();

export function sprint(): Sprint | null {
	return current;
}

export function onSprint(fn: () => void): () => void {
	listeners.add(fn);
	return () => listeners.delete(fn);
}

function changed(): void {
	for (const fn of listeners) fn();
}

/** Words written so far in the running sprint. */
export function sprintWords(w: WritingService): number {
	return current ? w.wordsToday(current.projectId) - current.startWords : 0;
}

export function startSprint(w: WritingService, projectId: string, minutes: number): void {
	stopSprint(w, false);
	const start = Date.now();
	current = { projectId, start, minutes, endsAt: start + minutes * 60_000, startWords: w.wordsToday(projectId) };
	timer = window.setTimeout(() => stopSprint(w, true), minutes * 60_000);
	changed();
}

/**
 * End the sprint. Finished (time ran out): logged with its full length. Stopped early: logged
 * with the minutes it ran, if at least one.
 */
export function stopSprint(w: WritingService, finished: boolean): void {
	if (!current) return;
	if (timer !== null) window.clearTimeout(timer);
	timer = null;
	const s = current;
	current = null;
	const ran = finished ? s.minutes : Math.floor((Date.now() - s.start) / 60_000);
	const words = w.wordsToday(s.projectId) - s.startWords;
	if (ran >= 1) {
		w.logSprint(s.projectId, { start: s.start, minutes: ran, words });
		new Notice(finished ? `Sprint done: ${words.toLocaleString()} words in ${ran} minutes.` : `Sprint stopped after ${ran} minute${ran === 1 ? '' : 's'}: ${words.toLocaleString()} words.`, 8000);
	}
	changed();
}

/** Time left, as m:ss. */
export function timeLeft(now = Date.now()): string {
	if (!current) return '';
	const s = Math.max(0, Math.round((current.endsAt - now) / 1000));
	return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
