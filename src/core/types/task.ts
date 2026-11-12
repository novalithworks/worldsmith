import type { EntityId, TaskId, TypeId } from './ids';

export type TaskStatus = 'open' | 'in-progress' | 'blocked' | 'done';

export const TASK_STATUSES: Array<{ id: TaskStatus; label: string; color: 'gray' | 'blue' | 'orange' | 'green' }> = [
	{ id: 'open', label: 'Open', color: 'gray' },
	{ id: 'in-progress', label: 'In progress', color: 'blue' },
	{ id: 'blocked', label: 'Blocked', color: 'orange' },
	{ id: 'done', label: 'Done', color: 'green' },
];

/** 0 none · 1 low · 2 medium · 3 high · 4 urgent */
export type TaskPriority = 0 | 1 | 2 | 3 | 4;

export const TASK_PRIORITIES: Array<{ id: TaskPriority; label: string }> = [
	{ id: 0, label: 'None' },
	{ id: 1, label: 'Low' },
	{ id: 2, label: 'Medium' },
	{ id: 3, label: 'High' },
	{ id: 4, label: 'Urgent' },
];

export type TaskRepeat = 'daily' | 'weekly' | 'monthly' | 'yearly';

/** Declared on a schema; instantiated into DevTasks when an entity is created. */
export interface TaskTemplate {
	id: string;
	title: string;
	category?: string;
	priority?: TaskPriority;
	optional?: boolean;
	description?: string;
}

/**
 * A development task. `due` is a real-world calendar date ("YYYY-MM-DD", local time) —
 * the writing schedule. Fictional-calendar dates arrive with calendars (Milestone 10).
 */
export interface DevTask {
	v: number;
	id: TaskId;
	/** The entry it belongs to; null for world-level tasks. */
	entityId: EntityId | null;
	typeId: TypeId | null;
	/** Schema task template it came from (lets "add to existing entries" skip duplicates). */
	templateId: string | null;
	title: string;
	notes: string;
	category: string;
	status: TaskStatus;
	optional: boolean;
	priority: TaskPriority;
	due: string | null;
	repeat: TaskRepeat | null;
	order: number;
	createdAt: number;
	updatedAt: number;
	completedAt: number | null;
	rev: number;
}

export type TaskPatch = Partial<Pick<DevTask, 'title' | 'notes' | 'category' | 'status' | 'optional' | 'priority' | 'due' | 'repeat' | 'order' | 'entityId'>>;
