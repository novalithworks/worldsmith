import type { App, Component, PaneType } from 'obsidian';
import type { WorldsmithContext } from '../app/context';
import { Registry } from '../core/registry/Registry';
import type { BlockInstance, EntityRecord, EntitySchema, FieldDefinition } from '../core/types';
import type { WorldSession } from '../services/WorldSession';
import type { Route } from '../state/route';

export type BlockSurface = 'entity' | 'dashboard' | 'tasks';

export interface BlockRenderContext {
	ws: WorldsmithContext;
	app: App;
	session: WorldSession;
	/** Body element the block renders into. */
	el: HTMLElement;
	instance: BlockInstance;
	config: Record<string, unknown>;
	/** Lifetime of this block: register listeners/children here. */
	component: Component;
	surface: BlockSurface;
	/** Present on entity pages. */
	entity?: EntityRecord;
	schema?: EntitySchema;
	navigate(route: Route, newLeaf?: boolean | PaneType): void;
	/** Update the frame title (e.g. with a count). */
	setTitle(title: string): void;
	/** True while the page is in customize mode (blocks may show their own edit controls). */
	editing?: boolean;
	/** Save a new config for this block instance (customizable pages only). */
	setConfig?(config: Record<string, unknown>): void;
}

export interface BlockHandle {
	/** Config changed (M6 settings panel); re-render cheaply if possible. */
	update?(config: Record<string, unknown>): void;
}

/**
 * A block type. New blocks register here — the page builder never changes.
 *
 * `configFields` describe the block's settings using the field system, so the settings
 * panel (M6) is generated with the same editors used for entity properties.
 */
export interface BlockDefinition {
	id: string;
	name: string;
	icon: string;
	description: string;
	surfaces: BlockSurface[];
	/** 'card' draws a framed panel with a title; 'plain' gives the block the bare cell. */
	frame: 'card' | 'plain';
	defaultSize: { w: number; h: number };
	minW?: number;
	defaultConfig: Record<string, unknown>;
	/**
	 * Settings rows. A function gets the page's schema and the widget's current config, so
	 * rows can depend on earlier choices (pick a type → its fields); the dialog rebuilds
	 * after each choice.
	 */
	configFields?: FieldDefinition[] | ((session: WorldSession, scope?: { schema?: EntitySchema; config?: Record<string, unknown> }) => FieldDefinition[]);
	/**
	 * A setting changed in the settings dialog: return the config to save. Lets a widget
	 * clear settings that depended on the old value (a new type invalidates its fields).
	 */
	onSettingChange?(key: string, config: Record<string, unknown>): Record<string, unknown>;
	/** Only one instance per page (calendar, stats…). Default false. */
	singleton?: boolean;
	/** Short hint shown in the "Add a widget" panel. */
	hint?: string;
	/** Group in the "Add a widget" panel (e.g. "Showcase", "Connections"). */
	category?: string;
	/** Title shown in the frame header; may depend on context. */
	title?(ctx: BlockRenderContext): string;
	/** Optional icon shown in the frame header. */
	headerIcon?: string;
	render(ctx: BlockRenderContext): BlockHandle | void;
}

export class BlockRegistry extends Registry<BlockDefinition> {
	constructor() {
		super('BlockRegistry');
	}

	/** Blocks of parts the open world has switched off (0.29); set by the app. */
	hidden: (def: BlockDefinition) => boolean = () => false;

	forSurface(surface: BlockSurface): BlockDefinition[] {
		return this.all().filter((b) => b.surfaces.includes(surface) && !this.hidden(b));
	}
}
