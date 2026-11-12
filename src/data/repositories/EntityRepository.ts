import type { EventBus } from '../../core/events/EventBus';
import type { WorldsmithEvents } from '../../core/events/events';
import type { EntityChange, EntityPatch, EntityRecord } from '../../core/types';
import { jsonEqual } from '../../core/util/clone';
import type { BucketStore } from '../storage/BucketStore';

/**
 * In-memory canonical entity state for the active world.
 *
 * Records are treated as immutable: update() creates a new object, so references held
 * by UI or a pending write are never mutated in place. Every update reports exactly which
 * keys changed (`name`, `values.age`, …) so the UI can patch only what's affected.
 */
export class EntityRepository {
	constructor(
		private readonly store: BucketStore<EntityRecord>,
		private readonly events: EventBus<WorldsmithEvents>,
	) {}

	get size(): number {
		return this.store.size;
	}

	get(id: string): EntityRecord | undefined {
		return this.store.get(id);
	}

	all(): EntityRecord[] {
		return this.store.all();
	}

	values(): IterableIterator<EntityRecord> {
		return this.store.values();
	}

	insert(record: EntityRecord): EntityRecord {
		if (this.store.has(record.id)) throw new Error(`[Worldsmith] entity ${record.id} already exists`);
		this.store.put(record);
		this.events.emit('entity:created', { entity: record });
		return record;
	}

	update(id: string, patch: EntityPatch): EntityRecord | null {
		const prev = this.store.get(id);
		if (!prev) return null;

		const keys: string[] = [];
		const next: EntityRecord = { ...prev };

		for (const [key, value] of Object.entries(patch) as Array<[keyof EntityPatch, unknown]>) {
			if (key === 'values') continue;
			if (!jsonEqual((prev as unknown as Record<string, unknown>)[key], value)) {
				(next as unknown as Record<string, unknown>)[key] = value;
				keys.push(key);
			}
		}

		if (patch.values) {
			const values = { ...prev.values };
			for (const [fieldId, value] of Object.entries(patch.values)) {
				if (value === undefined) {
					if (fieldId in values) {
						delete values[fieldId];
						keys.push(`values.${fieldId}`);
					}
				} else if (!jsonEqual(values[fieldId], value)) {
					values[fieldId] = value;
					keys.push(`values.${fieldId}`);
				}
			}
			next.values = values;
		}

		if (keys.length === 0) return prev;
		next.rev = prev.rev + 1;
		next.updatedAt = Date.now();
		this.store.put(next);
		const change: EntityChange = { id, keys };
		this.events.emit('entity:updated', { entity: next, change });
		return next;
	}

	/** Permanently delete. Trashing is an update of `trashedAt` instead. */
	remove(id: string): EntityRecord | null {
		const prev = this.store.get(id);
		if (!prev) return null;
		this.store.delete(id);
		this.events.emit('entity:deleted', { entity: prev });
		return prev;
	}
}
