import type { EventBus } from '../core/events/EventBus';
import type { VisualKind, WorldsmithEvents } from '../core/events/events';
import { uuid } from '../core/util/ids';
import type { BucketStore } from '../data/storage/BucketStore';

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

interface Doc {
	id: string;
	name: string;
	createdAt: number;
	updatedAt: number;
	rev: number;
}

/**
 * Family trees, relationship graphs and maps (0.11): named documents, one file each.
 * Every change returns the version before it and every removal returns the document, so
 * the page can offer Undo. Nothing here deletes anything else (an entry, a connection or
 * an image) — documents only point at them.
 */
export class VisualDocs<T extends Doc> {
	constructor(
		readonly kind: VisualKind,
		private readonly store: BucketStore<T>,
		private readonly events: EventBus<WorldsmithEvents>,
		private readonly hydrate: (raw: unknown) => { record: T } | null,
		private readonly fallbackName: string,
	) {}

	/** In the order they were made. */
	list(): T[] {
		return this.store
			.all()
			.sort((a, b) => a.createdAt - b.createdAt || a.name.localeCompare(b.name))
			.map(clone);
	}

	get(id: string | null | undefined): T | undefined {
		const d = id ? this.store.get(id) : undefined;
		return d ? clone(d) : undefined;
	}

	has(id: string): boolean {
		return this.store.has(id);
	}

	/** A name no other document of this kind uses: "Houses", "Houses 2", … */
	uniqueName(name: string, except?: string): string {
		const base = name.trim() || this.fallbackName;
		const taken = new Set(this.store.all().filter((d) => d.id !== except).map((d) => d.name.toLowerCase()));
		if (!taken.has(base.toLowerCase())) return base;
		let n = 2;
		while (taken.has(`${base} ${n}`.toLowerCase())) n++;
		return `${base} ${n}`;
	}

	create(init: Partial<T> & { name: string }): T {
		const now = Date.now();
		const doc = this.hydrate({ ...clone(init), id: uuid(), name: this.uniqueName(init.name), createdAt: now, updatedAt: now, rev: 0 })!.record;
		this.store.put(doc);
		this.events.emit('doc:saved', { kind: this.kind, id: doc.id });
		return clone(doc);
	}

	duplicate(id: string): T | null {
		const d = this.store.get(id);
		if (!d) return null;
		const { id: _id, createdAt: _c, updatedAt: _u, rev: _r, ...rest } = clone(d);
		return this.create({ ...(rest as Partial<T>), name: `${d.name} copy` });
	}

	/** Change a document. Returns the version before, for Undo. */
	update(id: string, patch: Partial<T>): { before: T; after: T } | null {
		const prev = this.store.get(id);
		if (!prev) return null;
		const merged = { ...clone(prev), ...clone(patch), id, createdAt: prev.createdAt, updatedAt: Date.now(), rev: prev.rev + 1 } as T;
		if (patch.name !== undefined) merged.name = this.uniqueName(patch.name, id);
		const next = this.hydrate(merged)!.record;
		this.store.put(next);
		this.events.emit('doc:saved', { kind: this.kind, id });
		return { before: clone(prev), after: clone(next) };
	}

	remove(id: string): T | null {
		const d = this.store.get(id);
		if (!d) return null;
		this.store.delete(id);
		this.events.emit('doc:deleted', { kind: this.kind, id });
		return clone(d);
	}

	/** Put a removed or changed document back exactly as it was (Undo). */
	restore(doc: T): void {
		const cur = this.store.get(doc.id);
		const next = { ...clone(doc), updatedAt: Date.now(), rev: Math.max(doc.rev, cur?.rev ?? 0) + 1 };
		this.store.put(next);
		this.events.emit('doc:saved', { kind: this.kind, id: doc.id });
	}
}
