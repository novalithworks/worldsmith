import type { BlockInstanceId, BlockTypeId, EntityId, LayoutId, TypeId } from './ids';

export type LayoutScope =
	| { kind: 'global' }
	| { kind: 'type'; typeId: TypeId }
	| { kind: 'entity'; entityId: EntityId }
	| { kind: 'dashboard'; dashboardId: string };

/**
 * A block placed on the 12-column grid.
 * x/w are columns; y/h are content-sized row tracks (see ARCHITECTURE §8).
 */
export interface BlockInstance {
	id: BlockInstanceId;
	type: BlockTypeId;
	x: number;
	y: number;
	w: number;
	h: number;
	/**
	 * Fixed height in pixels, set by dragging the bottom edge while customizing; absent or
	 * null = as tall as its content. (`h` is the grid row span used for placement.)
	 */
	height?: number | null;
	config: Record<string, unknown>;
	title?: string | null;
	collapsed?: boolean;
	hidden?: boolean;
	locked?: boolean;
}

export interface LayoutDoc {
	v: number;
	id: LayoutId;
	scope: LayoutScope;
	name: string;
	columns: number;
	blocks: BlockInstance[];
	createdAt: number;
	updatedAt: number;
	rev: number;
}

/** Layout template without persistence metadata, used by schemas and defaults. */
export interface LayoutTemplate {
	columns?: number;
	blocks: Array<Omit<BlockInstance, 'id'> & { id?: string }>;
}

/**
 * A layout preset someone made (Layout Studio, 0.10): a named arrangement that any type
 * can use. Widgets that name fields or sections are fitted to each type when applied.
 */
export interface LayoutPresetDoc {
	v: number;
	id: string;
	name: string;
	icon: string;
	description: string;
	blocks: BlockInstance[];
	/** The type it was made from (its own fields fit exactly); null when unknown. */
	fromType: string | null;
	createdAt: number;
	updatedAt: number;
	rev: number;
}
