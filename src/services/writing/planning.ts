import type { PlotThread, SceneStatus, StoryBeat, WritingProject, WritingTemplate, WritingTemplateNode } from '../../core/types';
import { slugId, uuid } from '../../core/util/ids';
import type { OutlineNode } from './WritingService';
import type { BeatSpec } from './structures';

/*
 * Story planning (WS4), the pure parts: editing a project's status and thread lists without
 * ever losing what scenes have, and turning a project into a reusable template. Unit-tested
 * in tests/ws4.test.ts.
 */

/**
 * A new list of statuses or threads. What was on the old list and isn't on the new one goes
 * to `retired` (so scenes that have it still say what it was, and it can be brought back);
 * what comes back onto the list leaves `retired`. Nothing is ever dropped.
 */
export function editList<T extends { id: string }>(current: T[], next: T[], retired: T[]): { list: T[]; retired: T[] } {
	const keep = new Map(next.map((x) => [x.id, x]));
	const out = new Map(retired.filter((r) => !keep.has(r.id)).map((r) => [r.id, r]));
	for (const c of current) if (!keep.has(c.id)) out.set(c.id, c);
	return { list: [...keep.values()], retired: [...out.values()] };
}

/** An id for a new status or thread: a slug of its name, unique among every one the project ever had. */
export function listId(label: string, taken: Iterable<string>): string {
	return slugId(label.trim() || 'item', taken);
}

/** The new list is usable: at least one status, names given, ids unique. Returns a reason when not. */
export function checkStatuses(list: SceneStatus[]): string | null {
	if (!list.length) return 'A project needs at least one status.';
	if (list.some((s) => !s.label.trim())) return 'Every status needs a name.';
	if (new Set(list.map((s) => s.id)).size !== list.length) return 'Two statuses have the same id.';
	return null;
}

export function checkThreads(list: PlotThread[]): string | null {
	if (list.some((s) => !s.label.trim())) return 'Every plot thread needs a name.';
	if (new Set(list.map((s) => s.id)).size !== list.length) return 'Two plot threads have the same id.';
	return null;
}

/** New beats from a structure (fresh ids, no scenes yet). */
export function beatsFrom(specs: BeatSpec[], source: string): StoryBeat[] {
	return specs.map((s) => ({ id: uuid(), label: s.label, description: s.description, group: s.group, position: s.position, sceneIds: [], source }));
}

/** The project's structure as a template: kinds, titles and synopses (never note text), its beats, statuses and threads. */
export function templateFrom(project: WritingProject, tree: OutlineNode[]): Pick<WritingTemplate, 'outline' | 'beats' | 'statuses' | 'defaultStatus' | 'threads'> {
	const walk = (nodes: OutlineNode[]): WritingTemplateNode[] =>
		nodes.map((n) => {
			const kids = walk(n.children);
			return { kind: n.item.kind, title: n.item.title, ...(n.item.synopsis ? { synopsis: n.item.synopsis } : {}), ...(kids.length ? { children: kids } : {}) };
		});
	return {
		outline: walk(tree),
		beats: project.beats.filter((b) => b.source === project.structure).map(({ label, description, group, position }) => ({ label, description, group, position })),
		statuses: project.statuses.map((s) => ({ id: s.id, label: s.label, color: s.color, done: s.done })),
		defaultStatus: project.defaultStatus,
		threads: project.threads.map((t) => ({ id: t.id, label: t.label, color: t.color, description: t.description })),
	};
}

/** How many scenes of an outline (for a template's description). */
export function sceneCount(nodes: WritingTemplateNode[]): number {
	return nodes.reduce((n, x) => n + (x.kind === 'scene' ? 1 : 0) + sceneCount(x.children ?? []), 0);
}
