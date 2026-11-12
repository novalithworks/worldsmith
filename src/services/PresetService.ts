import { RECORD_VERSIONS } from '../app/constants';
import type { EventBus } from '../core/events/EventBus';
import type { WorldsmithEvents } from '../core/events/events';
import type { BlockInstance, LayoutPresetDoc } from '../core/types';
import { uuid } from '../core/util/ids';
import { hydrateBlocks } from '../data/migrations/records';
import type { BucketStore } from '../data/storage/BucketStore';
import { compact, normalize } from '../layouts/engine/grid';

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

export interface PresetInput {
	name: string;
	icon?: string;
	description?: string;
	blocks: BlockInstance[];
	fromType?: string | null;
}

/**
 * Layout presets people make in Layout Studio (0.10): named page arrangements kept in
 * `presets/<id>.json`, usable by any type. Removing one returns it so the UI can offer Undo.
 */
export class PresetService {
	constructor(
		private readonly store: BucketStore<LayoutPresetDoc>,
		private readonly events: EventBus<WorldsmithEvents>,
	) {}

	/** In the order they were made. */
	list(): LayoutPresetDoc[] {
		return this.store
			.all()
			.filter((p) => p.blocks.length)
			.sort((a, b) => a.createdAt - b.createdAt || a.name.localeCompare(b.name))
			.map(clone);
	}

	get(id: string): LayoutPresetDoc | undefined {
		const p = this.store.get(id);
		return p ? clone(p) : undefined;
	}

	/** A name not used by another preset: "Heroes", "Heroes 2", … */
	uniqueName(name: string, except?: string): string {
		const base = name.trim() || 'My layout';
		const taken = new Set(this.store.all().filter((p) => p.id !== except).map((p) => p.name.toLowerCase()));
		if (!taken.has(base.toLowerCase())) return base;
		let n = 2;
		while (taken.has(`${base} ${n}`.toLowerCase())) n++;
		return `${base} ${n}`;
	}

	create(input: PresetInput): LayoutPresetDoc {
		const blocks = this.pack(input.blocks);
		if (!blocks.length) throw new Error('A preset needs at least one widget.');
		const now = Date.now();
		const doc: LayoutPresetDoc = {
			v: RECORD_VERSIONS.preset,
			id: uuid(),
			name: this.uniqueName(input.name),
			icon: input.icon || 'layout-template',
			description: input.description?.trim() ?? '',
			blocks,
			fromType: input.fromType ?? null,
			createdAt: now,
			updatedAt: now,
			rev: 0,
		};
		this.store.put(doc);
		this.events.emit('preset:saved', { preset: clone(doc) });
		return clone(doc);
	}

	/** Change details or the arrangement. Returns the version before, for Undo. */
	update(id: string, patch: Partial<Pick<LayoutPresetDoc, 'name' | 'icon' | 'description' | 'blocks' | 'fromType'>>): { before: LayoutPresetDoc; after: LayoutPresetDoc } | null {
		const prev = this.store.get(id);
		if (!prev) return null;
		const next: LayoutPresetDoc = { ...clone(prev), updatedAt: Date.now(), rev: prev.rev + 1 };
		if (patch.name !== undefined) next.name = this.uniqueName(patch.name, id);
		if (patch.icon !== undefined) next.icon = patch.icon || 'layout-template';
		if (patch.description !== undefined) next.description = patch.description.trim();
		if (patch.fromType !== undefined) next.fromType = patch.fromType;
		if (patch.blocks) {
			const blocks = this.pack(patch.blocks);
			if (!blocks.length) throw new Error('A preset needs at least one widget.');
			next.blocks = blocks;
		}
		this.store.put(next);
		this.events.emit('preset:saved', { preset: clone(next) });
		return { before: clone(prev), after: clone(next) };
	}

	duplicate(id: string): LayoutPresetDoc | null {
		const p = this.store.get(id);
		if (!p) return null;
		return this.create({ name: `${p.name} copy`, icon: p.icon, description: p.description, blocks: p.blocks, fromType: p.fromType });
	}

	remove(id: string): LayoutPresetDoc | null {
		const p = this.store.get(id);
		if (!p) return null;
		this.store.delete(id);
		this.events.emit('preset:deleted', { preset: clone(p) });
		return clone(p);
	}

	/** Put back a removed or changed preset exactly as it was (Undo). */
	restore(doc: LayoutPresetDoc): void {
		const cur = this.store.get(doc.id);
		const next = { ...clone(doc), updatedAt: Date.now(), rev: Math.max(doc.rev, cur?.rev ?? 0) + 1 };
		this.store.put(next);
		this.events.emit('preset:saved', { preset: clone(next) });
	}

	private pack(blocks: BlockInstance[]): BlockInstance[] {
		return compact(normalize(hydrateBlocks(clone(blocks))));
	}
}
