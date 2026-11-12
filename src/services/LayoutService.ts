import { RECORD_VERSIONS } from '../app/constants';
import type { EventBus } from '../core/events/EventBus';
import type { WorldsmithEvents } from '../core/events/events';
import type { BlockInstance, EntityRecord, EntitySchema, LayoutDoc, LayoutScope } from '../core/types';
import { hydrateBlocks } from '../data/migrations/records';
import type { BucketStore } from '../data/storage/BucketStore';
import { defaultLayoutFor } from '../layouts/defaults';
import { compact, normalize } from '../layouts/engine/grid';

export type LayoutSource = 'entry' | 'type' | 'default';
export type EditableScope = { kind: 'type'; typeId: string } | { kind: 'entity'; entityId: string } | { kind: 'dashboard'; dashboardId: string };

const clone = (blocks: BlockInstance[]): BlockInstance[] => JSON.parse(JSON.stringify(blocks)) as BlockInstance[];

/**
 * Page layouts (Milestone 6). An entry page resolves its layout in this order:
 *
 *   the entry's own layout → its type's layout → the built-in default for the type
 *
 * Layout ids are derived from the scope (`type-character`, `entity-<id>`), so two devices
 * customizing the same page write the same file instead of creating duplicates.
 * Removing a layout returns the removed document so the UI can offer Undo.
 */
export class LayoutService {
	private readonly offs: Array<() => void> = [];

	constructor(
		private readonly store: BucketStore<LayoutDoc>,
		private readonly events: EventBus<WorldsmithEvents>,
	) {
		// A permanently deleted entry takes its own layout with it. A deleted *type* keeps its
		// layout: the entries survive with a missing type, and undoing the delete (or
		// re-creating the type) should bring the same page back.
		this.offs.push(events.on('entity:deleted', ({ entity }) => void this.reset({ kind: 'entity', entityId: entity.id })).dispose);
	}

	dispose(): void {
		for (const off of this.offs.splice(0)) off();
	}

	static idFor(scope: EditableScope): string {
		if (scope.kind === 'dashboard') return `dashboard-${scope.dashboardId}`;
		return scope.kind === 'type' ? `type-${scope.typeId}` : `entity-${scope.entityId}`;
	}

	/** A dashboard's widgets, or `fallback` (Home's default; empty for a new blank one). */
	dashboardLayout(dashboardId: string, fallback: () => BlockInstance[]): { blocks: BlockInstance[]; custom: boolean; stored: boolean } {
		const doc = this.get({ kind: 'dashboard', dashboardId });
		if (doc?.blocks.length) return { blocks: clone(doc.blocks), custom: true, stored: true };
		// A stored empty layout is an extra dashboard someone emptied on purpose.
		if (doc && dashboardId !== 'home') return { blocks: [], custom: true, stored: true };
		return { blocks: fallback(), custom: false, stored: !!doc };
	}

	get(scope: EditableScope): LayoutDoc | undefined {
		return this.store.get(LayoutService.idFor(scope));
	}

	/** The layout every entry of a type uses unless it has its own. */
	typeLayout(schema: EntitySchema): { blocks: BlockInstance[]; custom: boolean } {
		const doc = this.get({ kind: 'type', typeId: schema.id });
		return doc?.blocks.length ? { blocks: clone(doc.blocks), custom: true } : { blocks: defaultLayoutFor(schema), custom: false };
	}

	/** The layout an entry's page shows, and where it came from. */
	forEntity(entity: EntityRecord, schema: EntitySchema | undefined): { blocks: BlockInstance[]; source: LayoutSource } {
		const own = this.get({ kind: 'entity', entityId: entity.id });
		if (own?.blocks.length) return { blocks: clone(own.blocks), source: 'entry' };
		if (!schema) return { blocks: defaultLayoutFor(undefined), source: 'default' };
		const t = this.typeLayout(schema);
		return { blocks: t.blocks, source: t.custom ? 'type' : 'default' };
	}

	hasOwn(entityId: string): boolean {
		return !!this.get({ kind: 'entity', entityId })?.blocks.length;
	}

	/** Entries of a type that have their own layout. */
	overridesOf(typeId: string, entityOf: (id: string) => EntityRecord | undefined): EntityRecord[] {
		const out: EntityRecord[] = [];
		for (const doc of this.store.values()) {
			if (doc.scope.kind !== 'entity') continue;
			const e = entityOf(doc.scope.entityId);
			if (e && e.typeId === typeId && !e.trashedAt) out.push(e);
		}
		return out.sort((a, b) => a.name.localeCompare(b.name));
	}

	/**
	 * Save a layout for a type or an entry. Blocks are validated and packed first. An empty
	 * layout isn't a layout — resolution skips it — so saving one removes the document and
	 * the page falls back to the next level (returns null then).
	 */
	save(scope: EditableScope, blocks: BlockInstance[], name = '', o: { keepEmpty?: boolean } = {}): LayoutDoc | null {
		const id = LayoutService.idFor(scope);
		const prev = this.store.get(id);
		const packed = compact(normalize(hydrateBlocks(clone(blocks))));
		// An extra dashboard can be deliberately empty (keepEmpty); everywhere else an empty
		// layout means "use the next one down", so it isn't stored.
		if (!packed.length && !o.keepEmpty) {
			this.reset(scope);
			return null;
		}
		const now = Date.now();
		const doc: LayoutDoc = {
			v: RECORD_VERSIONS.layout,
			id,
			scope: scope,
			name: name || prev?.name || '',
			columns: 12,
			blocks: packed,
			createdAt: prev?.createdAt ?? now,
			updatedAt: now,
			rev: (prev?.rev ?? 0) + 1,
		};
		this.store.put(doc);
		this.events.emit('layout:saved', { layout: doc });
		return doc;
	}

	/** Remove a type's or entry's layout (back to the next one down). Returns it for Undo. */
	reset(scope: EditableScope): LayoutDoc | null {
		const id = LayoutService.idFor(scope);
		const prev = this.store.get(id);
		if (!prev) return null;
		this.store.delete(id);
		this.events.emit('layout:deleted', { layout: prev });
		return prev;
	}

	restore(doc: LayoutDoc): void {
		this.store.put({ ...doc, updatedAt: Date.now(), rev: doc.rev + 1 });
		this.events.emit('layout:saved', { layout: this.store.get(doc.id) as LayoutDoc });
	}

	/** Duplicating an entry copies its own layout, if it has one. */
	copyEntityLayout(fromId: string, toId: string): void {
		const own = this.get({ kind: 'entity', entityId: fromId });
		if (own?.blocks.length) this.save({ kind: 'entity', entityId: toId }, own.blocks, own.name);
	}

	all(): LayoutDoc[] {
		return this.store.all();
	}
}
