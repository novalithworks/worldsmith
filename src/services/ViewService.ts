import { RECORD_VERSIONS } from '../app/constants';
import type { EventBus } from '../core/events/EventBus';
import type { WorldsmithEvents } from '../core/events/events';
import type { DatabaseView, ViewKind, ViewSort } from '../core/types';
import { uuid } from '../core/util/ids';
import type { BucketStore } from '../data/storage/BucketStore';

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** The id of a type's built-in "All …" view (the same on every device, so syncing never duplicates it). */
export const defaultViewId = (typeId: string): string => `all-${typeId}`;

export type ViewPatch = Partial<Omit<DatabaseView, 'v' | 'id' | 'typeId' | 'createdAt' | 'updatedAt' | 'rev'>>;

/**
 * Saved database views (Milestone 8). Every type has at least one view: until it's changed,
 * "All {plural}" is synthetic (nothing on disk) and uses this device's last layout and sort.
 * The first change stores it under a fixed id, so two devices can't create two copies.
 */
export class ViewService {
	constructor(
		private readonly store: BucketStore<DatabaseView>,
		private readonly events: EventBus<WorldsmithEvents>,
		private readonly plural: (typeId: string) => string,
		/** This device's old per-type layout/sort (before saved views), seeds the default view. */
		private readonly legacy: (typeId: string) => { kind?: ViewKind; sort?: ViewSort } = () => ({}),
	) {}

	/** A type's views in tab order (never empty). */
	forType(typeId: string): DatabaseView[] {
		const stored = this.store
			.all()
			.filter((v) => v.typeId === typeId)
			.sort((a, b) => a.order - b.order || a.createdAt - b.createdAt);
		return stored.length ? stored : [this.defaultView(typeId)];
	}

	/** A view by id — stored, or a type's synthetic default. */
	get(id: string): DatabaseView | undefined {
		const v = this.store.get(id);
		if (v) return clone(v);
		if (id.startsWith('all-')) {
			const typeId = id.slice(4);
			if (!this.store.all().some((x) => x.typeId === typeId)) return this.defaultView(typeId);
		}
		return undefined;
	}

	/** Every stored view (dashboards list them as sources). */
	all(): DatabaseView[] {
		return this.store.all().map(clone);
	}

	isStored(id: string): boolean {
		return this.store.has(id);
	}

	defaultView(typeId: string): DatabaseView {
		const now = Date.now();
		const legacy = this.legacy(typeId);
		// Last edited, newest first is what an empty sort means; anything else (oldest first too) is kept.
		const sort = legacy.sort && !(legacy.sort.field === '__updated' && legacy.sort.dir === 'desc') ? [legacy.sort] : [];
		return {
			v: RECORD_VERSIONS.view,
			id: defaultViewId(typeId),
			typeId,
			name: `All ${this.plural(typeId).toLowerCase()}`,
			icon: null,
			kind: legacy.kind ?? 'cards',
			match: 'all',
			conditions: [],
			sorts: sort,
			groupBy: null,
			collapsed: [],
			columns: null,
			card: { fields: null, image: 'portrait', size: 'm' },
			board: { field: '__status' },
			showArchived: false,
			order: 0,
			createdAt: now,
			updatedAt: now,
			rev: 0,
		};
	}

	/** Change a view (storing the synthetic default on its first change). */
	update(id: string, patch: ViewPatch): DatabaseView | null {
		const cur = this.get(id);
		if (!cur) return null;
		return this.put({ ...cur, ...clone(patch) });
	}

	create(typeId: string, init: ViewPatch & { name: string }): DatabaseView {
		// Keep the default tab in place: a type's first saved view stores it too.
		const existing = this.forType(typeId);
		for (const v of existing) if (!this.store.has(v.id)) this.put(v, false);
		const now = Date.now();
		const view: DatabaseView = {
			...this.defaultView(typeId),
			...clone(init),
			id: uuid().slice(0, 8),
			typeId,
			order: Math.max(0, ...existing.map((v) => v.order)) + 1,
			createdAt: now,
			updatedAt: now,
			rev: 0,
		};
		return this.put(view);
	}

	duplicate(id: string): DatabaseView | null {
		const src = this.get(id);
		if (!src) return null;
		const { v: _v, id: _id, typeId, createdAt: _c, updatedAt: _u, rev: _r, order: _o, ...rest } = src;
		void [_v, _id, _c, _u, _r, _o];
		const copy = this.create(typeId, { ...rest, name: `${src.name} copy` });
		// Right after the original.
		const list = this.forType(typeId).filter((v) => v.id !== copy.id);
		list.splice(list.findIndex((v) => v.id === id) + 1, 0, copy);
		list.forEach((v, i) => v.order !== i && this.put({ ...v, order: i }));
		return this.get(copy.id) ?? copy;
	}

	move(id: string, delta: number): void {
		const v = this.get(id);
		if (!v) return;
		const list = this.forType(v.typeId);
		const i = list.findIndex((x) => x.id === id);
		const to = i + delta;
		if (i < 0 || to < 0 || to >= list.length) return;
		const [m] = list.splice(i, 1);
		if (m) list.splice(to, 0, m);
		list.forEach((x, n) => x.order !== n && this.put({ ...x, order: n }));
	}

	/** Delete a view. The last one can't go (the type would have none). Returns it for Undo. */
	remove(id: string): DatabaseView | null {
		const v = this.store.get(id);
		if (!v) return null;
		if (this.store.all().filter((x) => x.typeId === v.typeId).length <= 1) return null;
		const copy = clone(v);
		this.store.delete(id);
		this.events.emit('view:deleted', { view: copy });
		return copy;
	}

	restore(view: DatabaseView): void {
		if (this.store.has(view.id)) return;
		this.put(view, false);
	}

	private put(view: DatabaseView, bump = true): DatabaseView {
		const prev = this.store.get(view.id);
		const next: DatabaseView = { ...clone(view), v: RECORD_VERSIONS.view, updatedAt: bump ? Date.now() : view.updatedAt, rev: (prev?.rev ?? view.rev ?? 0) + 1 };
		this.store.put(next);
		this.events.emit('view:saved', { view: clone(next) });
		return clone(next);
	}
}
