import type { App, Component, PaneType } from 'obsidian';
import type { WorldsmithContext } from '../app/context';
import type { EntityRecord, FieldDefinition } from '../core/types';
import type { WorldSession } from '../services/WorldSession';
import type { Route } from '../state/route';

/**
 * A field type has two halves:
 *  - FieldTypeLogic: pure behaviour (defaults, validation, coercion, text, sorting).
 *    No DOM, no Obsidian — used by services, search, sorting and headless tests.
 *  - FieldTypeUI: how values are displayed and edited.
 *
 * Both are registered together as one FieldTypeDefinition. Adding a field type means
 * writing one file that exports a definition and adding it to fields/builtin.ts.
 */
export type FieldCategory = 'text' | 'number' | 'choice' | 'date' | 'media' | 'relation' | 'computed' | 'other';

export type CoerceResult = { ok: true; value: unknown } | { ok: false };

export interface FieldTypeLogic {
	id: string;
	label: string;
	icon: string;
	category: FieldCategory;
	description?: string;
	/** Computed types (rollup, formula, children) never store a value on the entity. */
	computed?: boolean;
	/** Whether toText output is added to the search haystack. Default true. */
	searchable?: boolean;
	/** Default cell width hint in property grids. */
	defaultWidth?: 'full' | 'half' | 'third';
	/**
	 * Kind-specific settings, described as ordinary field definitions. Type Studio renders
	 * them with the same editors used on entity pages; values are stored in field.config
	 * under each definition's id.
	 */
	configFields?: FieldDefinition[];
	/** Whether a placeholder setting makes sense for this kind. */
	supportsPlaceholder?: boolean;
	/** Shows the choices editor (select / multiselect). */
	hasOptions?: boolean;
	/** Short note shown in Type Studio (e.g. "Linking arrives with relations"). */
	studioNote?: string;
	/**
	 * Values that point at vault files: `'ref'` = one `{ path }`, `'refs'` = a list of them.
	 * Worldsmith follows renames for these and lists images in the media library.
	 * `images: false` for kinds that hold any file (not shown as images).
	 */
	media?: { shape: 'ref' | 'refs'; images: boolean };
	defaultValue(field: FieldDefinition): unknown;
	isEmpty(value: unknown): boolean;
	/** Returns an error message, or null when valid. Empty values are checked separately. */
	validate(value: unknown, field: FieldDefinition): string | null;
	/** Convert an arbitrary value (e.g. after a field type change) into this type. */
	coerce(value: unknown, field: FieldDefinition): CoerceResult;
	/** Plain-text representation for search, cards and tooltips. */
	toText(value: unknown, field: FieldDefinition): string;
	compare?(a: unknown, b: unknown, field: FieldDefinition): number;
}

/**
 * The live app around a field, for kinds that work across entries (relations, rollups).
 * Present on entity pages; absent in previews and settings dialogs, where those kinds
 * show a read-only summary instead.
 */
export interface FieldHost {
	ws: WorldsmithContext;
	session: WorldSession;
	navigate(route: Route, newLeaf?: boolean | PaneType): void;
}

export interface FieldRenderContext {
	app: App;
	field: FieldDefinition;
	entity: EntityRecord | null;
	/** Owner for anything that needs cleanup (Markdown renders, listeners). */
	component: Component;
	host?: FieldHost;
}

export interface FieldEditorContext extends FieldRenderContext {
	value: unknown;
	readOnly?: boolean;
	/** Called with the new value. Editors debounce typing themselves. */
	onChange(value: unknown): void;
}

export interface FieldEditorHandle {
	/** External value change (another pane, undo). Must not steal focus or caret. */
	setValue(value: unknown): void;
	focus(): void;
	destroy?(): void;
}

export interface FieldTypeUI {
	renderDisplay(el: HTMLElement, value: unknown, ctx: FieldRenderContext): void;
	createEditor(el: HTMLElement, ctx: FieldEditorContext): FieldEditorHandle;
}

export interface FieldTypeDefinition extends FieldTypeLogic {
	ui?: FieldTypeUI;
}
