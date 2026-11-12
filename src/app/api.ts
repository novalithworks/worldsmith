import type { BlockDefinition } from '../blocks/BlockRegistry';
import type { EventBus } from '../core/events/EventBus';
import type { WorldsmithEvents } from '../core/events/events';
import type { EntityTypeTemplate, RelationTypeTemplate } from '../core/types';
import type { Disposable } from '../core/util/disposable';
import type { FieldTypeDefinition } from '../fields/FieldType';
import type { WorldSession } from '../services/WorldSession';
import type { Route } from '../state/route';
import type { RouteDefinition } from '../ui/views/routes/RouteRegistry';
import type { OpenOptions } from './context';

/**
 * The Worldsmith extension surface, available as `app.plugins.plugins.worldsmith.api`.
 * Worldsmith registers its own built-ins through these same calls.
 *
 * Every register* returns a Disposable; call dispose() when your plugin unloads.
 * The API is versioned: additive changes bump the minor version.
 */
export interface WorldsmithAPI {
	readonly version: string;
	readonly events: EventBus<WorldsmithEvents>;
	/** The active world, or null during onboarding/loading. */
	readonly session: WorldSession | null;
	registerFieldType(def: FieldTypeDefinition): Disposable;
	registerBlock(def: BlockDefinition): Disposable;
	/** Adds a type template; worlds can install it (Type Studio, M9). */
	registerEntityType(template: EntityTypeTemplate): Disposable;
	/** Adds a relationship type template; new worlds (and worlds whose fields reference it) get it. */
	registerRelationType(template: RelationTypeTemplate): Disposable;
	registerRoute(def: RouteDefinition): Disposable;
	open(route: Route, opts?: OpenOptions): Promise<void>;
}

export const API_VERSION = '0.2.0';
