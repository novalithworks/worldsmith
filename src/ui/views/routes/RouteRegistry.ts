import type { Component, PaneType } from 'obsidian';
import type { WorldsmithContext } from '../../../app/context';
import { Registry } from '../../../core/registry/Registry';
import type { WorldSession } from '../../../services/WorldSession';
import type { Route } from '../../../state/route';

export interface RouteContext {
	ws: WorldsmithContext;
	/** Null only for routes with `needsWorld: false` (onboarding). */
	session: WorldSession | null;
	el: HTMLElement;
	params: Record<string, string>;
	/** Lifetime of the page; released on navigation. */
	component: Component;
	navigate: (route: Route, newLeaf?: boolean | PaneType) => void;
	/** Replace the current route's params without a history entry (e.g. search text). */
	replaceParams(params: Record<string, string>): void;
	setTitle(title: string): void;
}

/**
 * An app page. New pages (Tasks, Timeline, Type Studio…) register here; the shell and
 * router never change.
 */
export interface RouteDefinition {
	id: string;
	needsWorld?: boolean;
	title(params: Record<string, string>, session: WorldSession | null): string;
	icon(params: Record<string, string>, session: WorldSession | null): string;
	render(ctx: RouteContext): void;
}

export class RouteRegistry extends Registry<RouteDefinition> {
	constructor() {
		super('RouteRegistry');
	}
}
