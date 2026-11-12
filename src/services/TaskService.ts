import { RECORD_VERSIONS } from '../app/constants';
import type { EventBus } from '../core/events/EventBus';
import type { WorldsmithEvents } from '../core/events/events';
import type { DevTask, EntityRecord, EntitySchema, TaskPatch, TaskPriority, TaskRepeat, TaskStatus } from '../core/types';
import { clone, jsonEqual } from '../core/util/clone';
import { addDays, addMonths, isISODate, today } from '../core/util/dates';
import type { Disposable } from '../core/util/disposable';
import { uuid } from '../core/util/ids';
import type { EntityRepository } from '../data/repositories/EntityRepository';
import type { BucketStore } from '../data/storage/BucketStore';

export interface NewTask {
	title: string;
	entityId?: string | null;
	due?: string | null;
	priority?: TaskPriority;
	category?: string;
	notes?: string;
	optional?: boolean;
	status?: TaskStatus;
	repeat?: TaskRepeat | null;
}

/**
 * Development tasks. Every entry gets its type's default checklist when created; tasks
 * can also be added freely (to an entry, or to the world). Removing tasks returns them so
 * the UI can offer Undo; deleting an entry permanently removes its tasks.
 */
export class TaskService {
	private byEntity = new Map<string, Set<string>>();
	private subs: Disposable[] = [];

	constructor(
		private readonly store: BucketStore<DevTask>,
		private readonly entities: EntityRepository,
		private readonly schemas: { get(id: string): EntitySchema | undefined },
		private readonly events: EventBus<WorldsmithEvents>,
	) {
		for (const t of store.values()) this.index(t);
		this.subs.push(events.on('entity:deleted', ({ entity }) => void this.removeAllFor(entity.id)));
		// Keep typeId in step when an entry changes type.
		this.subs.push(
			events.on('entity:updated', ({ entity, change }) => {
				if (!change.keys.includes('typeId')) return;
				for (const t of this.forEntity(entity.id)) this.write(t, { ...t, typeId: entity.typeId }, ['typeId']);
			}),
		);
	}

	dispose(): void {
		for (const s of this.subs) s.dispose();
		this.subs = [];
	}

	// ── reading ───────────────────────────────────────────────────────────────

	get(id: string): DevTask | undefined {
		return this.store.get(id);
	}

	all(): DevTask[] {
		return this.store.all();
	}

	get size(): number {
		return this.store.size;
	}

	/** An entry's tasks in checklist order. */
	forEntity(entityId: string): DevTask[] {
		const ids = this.byEntity.get(entityId);
		if (!ids) return [];
		const out: DevTask[] = [];
		for (const id of ids) {
			const t = this.store.get(id);
			if (t) out.push(t);
		}
		return out.sort((a, b) => a.order - b.order || a.createdAt - b.createdAt);
	}

	/**
	 * Tasks that should appear in world-wide views: world-level tasks, and tasks whose entry
	 * exists and isn't in the trash.
	 */
	visible(): DevTask[] {
		const out: DevTask[] = [];
		for (const t of this.store.values()) {
			if (t.entityId) {
				const e = this.entities.get(t.entityId);
				if (!e || e.trashedAt) continue;
			}
			out.push(t);
		}
		return out;
	}

	/** done / counted tasks of an entry (optional ones only when asked). */
	stats(entityId: string, includeOptional = false): { done: number; total: number } {
		let done = 0;
		let total = 0;
		for (const t of this.forEntity(entityId)) {
			if (t.optional && !includeOptional) continue;
			total++;
			if (t.status === 'done') done++;
		}
		return { done, total };
	}

	// ── writing ───────────────────────────────────────────────────────────────

	create(input: NewTask): DevTask {
		const now = Date.now();
		const entity = input.entityId ? this.entities.get(input.entityId) : undefined;
		const siblings = input.entityId ? this.forEntity(input.entityId) : [];
		const task: DevTask = {
			v: RECORD_VERSIONS.task,
			id: uuid(),
			entityId: entity?.id ?? null,
			typeId: entity?.typeId ?? null,
			templateId: null,
			title: input.title.trim() || 'Untitled task',
			notes: input.notes ?? '',
			category: input.category?.trim() ?? '',
			status: input.status ?? 'open',
			optional: !!input.optional,
			priority: input.priority ?? 0,
			due: input.due && isISODate(input.due) ? input.due : null,
			repeat: input.repeat ?? null,
			order: siblings.length ? Math.max(...siblings.map((t) => t.order)) + 1 : now,
			createdAt: now,
			updatedAt: now,
			completedAt: input.status === 'done' ? now : null,
			rev: 0,
		};
		this.store.put(task);
		this.index(task);
		this.events.emit('task:created', { task });
		return task;
	}

	update(id: string, patch: TaskPatch): DevTask | null {
		const prev = this.store.get(id);
		if (!prev) return null;
		const next: DevTask = { ...prev };
		const keys: string[] = [];
		for (const [k, raw] of Object.entries(patch) as Array<[keyof TaskPatch, unknown]>) {
			let v = raw;
			if (k === 'due') v = typeof raw === 'string' && isISODate(raw) ? raw : null;
			if (k === 'title') v = typeof raw === 'string' && raw.trim() ? raw.trim() : prev.title;
			if (k === 'entityId') {
				const e = typeof raw === 'string' ? this.entities.get(raw) : undefined;
				v = e?.id ?? null;
				if (!jsonEqual(prev.typeId, e?.typeId ?? null)) {
					next.typeId = e?.typeId ?? null;
					keys.push('typeId');
				}
			}
			if (jsonEqual((prev as unknown as Record<string, unknown>)[k], v)) continue;
			(next as unknown as Record<string, unknown>)[k] = clone(v);
			keys.push(k);
		}
		if (keys.includes('status')) next.completedAt = next.status === 'done' ? Date.now() : null;
		if (!keys.length) return prev;
		const saved = this.write(prev, next, keys);
		// Completing a repeating task schedules the next one.
		if (keys.includes('status') && prev.status !== 'done' && saved.status === 'done' && saved.repeat) this.scheduleNext(saved);
		return saved;
	}

	setStatus(id: string, status: TaskStatus): DevTask | null {
		return this.update(id, { status });
	}

	toggleDone(id: string): DevTask | null {
		const t = this.store.get(id);
		if (!t) return null;
		return this.setStatus(id, t.status === 'done' ? 'open' : 'done');
	}

	/** Remove tasks; returns them for Undo (`restore`). */
	remove(ids: string[]): DevTask[] {
		const out: DevTask[] = [];
		for (const id of ids) {
			const t = this.store.get(id);
			if (!t) continue;
			this.store.delete(id);
			this.unindex(t);
			this.events.emit('task:deleted', { task: t });
			out.push(t);
		}
		return out;
	}

	restore(tasks: DevTask[]): number {
		let n = 0;
		for (const t of tasks) {
			if (this.store.has(t.id)) continue;
			if (t.entityId && !this.entities.get(t.entityId)) continue;
			const copy = clone(t);
			this.store.put(copy);
			this.index(copy);
			this.events.emit('task:created', { task: copy });
			n++;
		}
		return n;
	}

	/** Move a task within its entry's checklist (index among the entry's tasks). */
	move(id: string, toIndex: number): void {
		const t = this.store.get(id);
		if (!t?.entityId) return;
		const list = this.forEntity(t.entityId).filter((x) => x.id !== id);
		const idx = Math.max(0, Math.min(list.length, toIndex));
		list.splice(idx, 0, t);
		list.forEach((x, i) => {
			if (x.order !== i) this.write(x, { ...x, order: i }, ['order']);
		});
	}

	/** Give a new entry its type's default checklist. */
	instantiate(entity: EntityRecord): DevTask[] {
		const schema = this.schemas.get(entity.typeId);
		if (!schema?.defaultTasks.length) return [];
		const have = new Set(this.forEntity(entity.id).map((t) => t.templateId).filter(Boolean));
		const now = Date.now();
		const out: DevTask[] = [];
		schema.defaultTasks.forEach((tpl, i) => {
			if (have.has(tpl.id)) return;
			const task: DevTask = {
				v: RECORD_VERSIONS.task,
				id: uuid(),
				entityId: entity.id,
				typeId: entity.typeId,
				templateId: tpl.id,
				title: tpl.title,
				notes: tpl.description ?? '',
				category: tpl.category ?? '',
				status: 'open',
				optional: !!tpl.optional,
				priority: tpl.priority ?? 0,
				due: null,
				repeat: null,
				order: i,
				createdAt: now,
				updatedAt: now,
				completedAt: null,
				rev: 0,
			};
			this.store.put(task);
			this.index(task);
			this.events.emit('task:created', { task });
			out.push(task);
		});
		return out;
	}

	/** Add a type's template tasks that existing entries don't have yet. */
	syncTemplates(typeId: string): number {
		let n = 0;
		for (const e of this.entities.values()) if (e.typeId === typeId) n += this.instantiate(e).length;
		return n;
	}

	/** How many entries of a type are missing at least one template task. */
	missingTemplateCount(typeId: string): number {
		const schema = this.schemas.get(typeId);
		if (!schema?.defaultTasks.length) return 0;
		let n = 0;
		for (const e of this.entities.values()) {
			if (e.typeId !== typeId) continue;
			const have = new Set(this.forEntity(e.id).map((t) => t.templateId));
			if (schema.defaultTasks.some((tpl) => !have.has(tpl.id))) n++;
		}
		return n;
	}

	/** Copy an entry's tasks onto its duplicate. */
	copyTasks(sourceId: string, copyId: string): number {
		const copy = this.entities.get(copyId);
		if (!copy) return 0;
		let n = 0;
		for (const t of this.forEntity(sourceId)) {
			const now = Date.now();
			const dup: DevTask = { ...clone(t), id: uuid(), entityId: copyId, typeId: copy.typeId, createdAt: now, updatedAt: now, rev: 0 };
			this.store.put(dup);
			this.index(dup);
			this.events.emit('task:created', { task: dup });
			n++;
		}
		return n;
	}

	removeAllFor(entityId: string): DevTask[] {
		return this.remove(this.forEntity(entityId).map((t) => t.id));
	}

	private scheduleNext(done: DevTask): DevTask {
		const base = done.due ?? today();
		const due =
			done.repeat === 'daily' ? addDays(base, 1) : done.repeat === 'weekly' ? addDays(base, 7) : done.repeat === 'monthly' ? addMonths(base, 1) : addMonths(base, 12);
		return this.create({
			title: done.title,
			entityId: done.entityId,
			due,
			priority: done.priority,
			category: done.category,
			notes: done.notes,
			optional: done.optional,
			repeat: done.repeat,
		});
	}

	private write(prev: DevTask, next: DevTask, keys: string[]): DevTask {
		next.rev = prev.rev + 1;
		next.updatedAt = Date.now();
		this.unindex(prev);
		this.store.put(next);
		this.index(next);
		this.events.emit('task:updated', { task: next, prev, keys });
		return next;
	}

	private index(t: DevTask): void {
		if (!t.entityId) return;
		let set = this.byEntity.get(t.entityId);
		if (!set) {
			set = new Set();
			this.byEntity.set(t.entityId, set);
		}
		set.add(t.id);
	}

	private unindex(t: DevTask): void {
		if (t.entityId) this.byEntity.get(t.entityId)?.delete(t.id);
	}
}
