import type { EventBus } from '../../core/events/EventBus';
import type { WorldsmithEvents } from '../../core/events/events';
import type { EntitySchema } from '../../core/types';
import type { BucketStore } from '../storage/BucketStore';

/** The active world's entity types. Built-in and custom types are stored identically. */
export class SchemaRepository {
	constructor(
		private readonly store: BucketStore<EntitySchema>,
		private readonly events: EventBus<WorldsmithEvents>,
	) {}

	get(id: string): EntitySchema | undefined {
		return this.store.get(id);
	}

	has(id: string): boolean {
		return this.store.has(id);
	}

	all(): EntitySchema[] {
		return this.store.all();
	}

	/** Insert or replace. Bumps rev/updatedAt on replace. */
	put(schema: EntitySchema): EntitySchema {
		const prev = this.store.get(schema.id);
		const next: EntitySchema = prev ? { ...schema, rev: prev.rev + 1, updatedAt: Date.now() } : schema;
		this.store.put(next);
		this.events.emit(prev ? 'schema:updated' : 'schema:created', { schema: next });
		return next;
	}

	remove(id: string): EntitySchema | null {
		const prev = this.store.get(id);
		if (!prev) return null;
		this.store.delete(id);
		this.events.emit('schema:deleted', { schema: prev });
		return prev;
	}
}
