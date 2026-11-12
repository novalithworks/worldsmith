import { Component } from 'obsidian';
import { ROUTES } from '../../../state/route';
import { emptyState } from '../../components/dom';
import { own } from '../../components/lifecycle';
import { DatabasePage } from '../../database/DatabasePage';
import type { RouteDefinition } from './RouteRegistry';

export const databaseRoute: RouteDefinition = {
	id: 'database',
	needsWorld: true,
	title: (p, s) => s?.schemas.get(p.typeId ?? '')?.plural ?? 'Database',
	icon: (p, s) => s?.schemas.get(p.typeId ?? '')?.icon ?? 'database',
	render(ctx) {
		const s = ctx.session!;
		const typeId = ctx.params.typeId ?? '';
		const schema = s.schemas.get(typeId);
		const page = ctx.el.createDiv({ cls: 'ws-page ws-page--database' });
		if (!schema) {
			emptyState(page, {
				icon: 'database',
				title: 'This type no longer exists',
				actionLabel: 'Back to dashboard',
				actionIcon: 'home',
				onAction: () => ctx.navigate(ROUTES.dashboard()),
			});
			return;
		}
		// Each mount gets its own lifetime so a schema change can remount cleanly.
		let scope: Component | null = null;
		const mount = () => {
			if (scope) ctx.component.removeChild(scope);
			scope = new Component();
			ctx.component.addChild(scope);
			page.empty();
			const current = s.schemas.get(typeId);
			if (current) new DatabasePage({ ...ctx, component: scope }, s, current, page).mount();
		};
		mount();
		own(ctx.component, s.events.on('schema:updated', ({ schema: changed }) => changed.id === typeId && mount()));
	},
};

