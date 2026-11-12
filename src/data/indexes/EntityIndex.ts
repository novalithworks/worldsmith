import type { EventBus } from '../../core/events/EventBus';
import type { WorldsmithEvents } from '../../core/events/events';
import type { EntityRecord } from '../../core/types';
import { DisposableStore } from '../../core/util/disposable';
import type { EntityRepository } from '../repositories/EntityRepository';

/**
 * Incrementally maintained lookup structures so views never scan every entity.
 *
 *  byType    typeId   → ids   (all records, including trashed; filter at query time)
 *  byParent  parentId → ids
 *  favorites / pinned / trashed sets
 *  recent    lazily sorted by updatedAt, invalidated on change
 */
export class EntityIndex {
	private byType = new Map<string, Set<string>>();
	private byParent = new Map<string, Set<string>>();
	private typeOf = new Map<string, string>();
	private parentOf = new Map<string, string>();
	private favorites = new Set<string>();
	private pinned = new Set<string>();
	private trashed = new Set<string>();
	private recentCache: string[] | null = null;
	private disposables = new DisposableStore();

	constructor(
		private readonly repo: EntityRepository,
		events: EventBus<WorldsmithEvents>,
	) {
		this.rebuild();
		this.disposables.add(events.on('entity:created', ({ entity }) => this.add(entity)));
		this.disposables.add(
			events.on('entity:updated', ({ entity, change }) => {
				this.recentCache = null;
				const structural = change.keys.some((k) => k === 'typeId' || k === 'parentId' || k === 'flags' || k === 'trashedAt');
				if (structural) {
					this.removeId(entity.id);
					this.add(entity);
				}
			}),
		);
		this.disposables.add(events.on('entity:deleted', ({ entity }) => this.removeId(entity.id, entity)));
	}

	rebuild(): void {
		this.byType.clear();
		this.byParent.clear();
		this.typeOf.clear();
		this.parentOf.clear();
		this.favorites.clear();
		this.pinned.clear();
		this.trashed.clear();
		this.recentCache = null;
		for (const e of this.repo.values()) this.add(e);
	}

	private add(e: EntityRecord): void {
		this.recentCache = null;
		addTo(this.byType, e.typeId, e.id);
		this.typeOf.set(e.id, e.typeId);
		if (e.parentId) {
			addTo(this.byParent, e.parentId, e.id);
			this.parentOf.set(e.id, e.parentId);
		}
		if (e.flags.favorite) this.favorites.add(e.id);
		if (e.flags.pinned) this.pinned.add(e.id);
		if (e.trashedAt) this.trashed.add(e.id);
	}

	private removeId(id: string, _known?: EntityRecord): void {
		this.recentCache = null;
		// typeOf/parentOf remember where the id was indexed, so removal is O(1) even
		// after the record itself has changed.
		const t = this.typeOf.get(id);
		if (t !== undefined) this.byType.get(t)?.delete(id);
		const p = this.parentOf.get(id);
		if (p) this.byParent.get(p)?.delete(id);
		this.typeOf.delete(id);
		this.parentOf.delete(id);
		this.favorites.delete(id);
		this.pinned.delete(id);
		this.trashed.delete(id);
	}

	/** Live entities of a type (not trashed). Archived are included unless excluded. */
	ofType(typeId: string, opts: { includeArchived?: boolean } = {}): EntityRecord[] {
		return this.resolve(this.byType.get(typeId), opts.includeArchived ?? false);
	}

	countOfType(typeId: string): number {
		let n = 0;
		for (const id of this.byType.get(typeId) ?? []) {
			const e = this.repo.get(id);
			if (e && !e.trashedAt && !e.archivedAt) n++;
		}
		return n;
	}

	childrenOf(parentId: string): EntityRecord[] {
		return this.resolve(this.byParent.get(parentId), true);
	}

	favoriteEntities(): EntityRecord[] {
		return this.resolve(this.favorites, false);
	}

	pinnedEntities(): EntityRecord[] {
		return this.resolve(this.pinned, false);
	}

	trashedEntities(): EntityRecord[] {
		const out: EntityRecord[] = [];
		for (const id of this.trashed) {
			const e = this.repo.get(id);
			if (e) out.push(e);
		}
		return out.sort((a, b) => (b.trashedAt ?? 0) - (a.trashedAt ?? 0));
	}

	recent(limit = 12): EntityRecord[] {
		if (!this.recentCache) {
			this.recentCache = this.repo
				.all()
				.filter((e) => !e.trashedAt)
				.sort((a, b) => b.updatedAt - a.updatedAt)
				.map((e) => e.id);
		}
		return this.recentCache
			.slice(0, limit)
			.map((id) => this.repo.get(id))
			.filter((e): e is EntityRecord => !!e);
	}

	private resolve(ids: Set<string> | undefined, includeArchived: boolean): EntityRecord[] {
		if (!ids) return [];
		const out: EntityRecord[] = [];
		for (const id of ids) {
			const e = this.repo.get(id);
			if (!e || e.trashedAt) continue;
			if (!includeArchived && e.archivedAt) continue;
			out.push(e);
		}
		return out;
	}

	dispose(): void {
		this.disposables.dispose();
	}
}

function addTo(map: Map<string, Set<string>>, key: string, id: string): void {
	let set = map.get(key);
	if (!set) {
		set = new Set();
		map.set(key, set);
	}
	set.add(id);
}
