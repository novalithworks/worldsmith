import type { PaneType } from 'obsidian';
import type { WorldsmithContext } from '../../app/context';
import { viewKind, type BlockInstance, type DatabaseView } from '../../core/types';
import { uuid } from '../../core/util/ids';
import { DASHBOARD_LAYOUT, materialize } from '../../layouts/defaults';
import { HOME_DASHBOARD } from '../../services/DashboardService';
import type { WorldSession } from '../../services/WorldSession';
import { ROUTES, type Route } from '../../state/route';
import { actionNotice } from '../components/notice';
import { DashboardSuggestModal } from '../dashboards/DashboardSuggestModal';

/** How a view's layout reads as a dashboard list. */
export function widgetStyleFor(view: DatabaseView): 'list' | 'cards' | 'table' | 'portraits' {
	const kind = viewKind(view);
	return kind === 'table' ? 'table' : kind === 'gallery' ? 'portraits' : kind === 'cards' ? 'cards' : 'list';
}

/** The widget that shows a saved view on a dashboard (it follows the view as it changes). */
export function viewWidget(view: DatabaseView, y: number): BlockInstance {
	const style = widgetStyleFor(view);
	return {
		id: `entry-list-${uuid().slice(0, 8)}`,
		type: 'entry-list',
		x: 0,
		y,
		w: style === 'list' ? 6 : 12,
		h: 1,
		config: { source: 'view', view: view.id, type: view.typeId, style, limit: style === 'table' ? 10 : 8 },
	};
}

/** Put a saved view on Home or a dashboard (chosen from a list), with Undo-free "Open" link. */
export function addViewToDashboard(ws: WorldsmithContext, s: WorldSession, view: DatabaseView, navigate: (r: Route, nl?: boolean | PaneType) => void): void {
	new DashboardSuggestModal(
		ws.app,
		s,
		(dashboardId) => {
			const isHome = dashboardId === HOME_DASHBOARD;
			// The default view is saved first, so the widget has something stable to point at.
			if (!s.views.isStored(view.id)) s.views.update(view.id, {});
			const cur = s.layouts.dashboardLayout(dashboardId, () => (isHome ? materialize(DASHBOARD_LAYOUT) : [])).blocks;
			const bottom = cur.reduce((m, b) => Math.max(m, b.y + b.h), 0);
			if (!isHome) s.dashboards.adopt(dashboardId);
			s.layouts.save({ kind: 'dashboard', dashboardId }, [...cur, viewWidget(view, bottom)], isHome ? 'Home' : (s.dashboards.get(dashboardId)?.name ?? ''), { keepEmpty: !isHome });
			const name = isHome ? 'Home' : (s.dashboards.get(dashboardId)?.name ?? 'the dashboard');
			actionNotice(`“${view.name}” added to ${name}.`, { label: 'Open', run: () => navigate(ROUTES.dashboard(dashboardId)) });
		},
		{ placeholder: `Show “${view.name}” on which dashboard?` },
	).open();
}
