import { ROUTES, type Route } from '../state/route';
import type { WorldSession } from './WorldSession';

/** Page keys: "tasks", "dashboard:<id>", "type:<typeId>", "page:<route>" (the Tools pages, 0.12.2). */
export const pageBannerKey = {
	tasks: () => 'tasks',
	page: (route: ToolPage) => `page:${route}`,
	dashboard: (id: string) => `dashboard:${id}`,
	type: (typeId: string) => `type:${typeId}`,
};

/** The Tools pages that can have a banner, with how they're named. */
export const TOOL_PAGES = {
	search: { name: 'Search', icon: 'search', label: 'the Search page' },
	timeline: { name: 'Timeline', icon: 'gantt-chart', label: 'the Timeline' },
	health: { name: 'World health', icon: 'heart-pulse', label: 'World health' },
	maps: { name: 'Maps', icon: 'map', label: 'the Maps page' },
	trees: { name: 'Trees', icon: 'network', label: 'the Trees page' },
	graph: { name: 'Graph', icon: 'share-2', label: 'the Graph' },
	media: { name: 'Media', icon: 'images', label: 'the Media page' },
	trash: { name: 'Trash', icon: 'trash-2', label: 'the Trash' },
} as const;
export type ToolPage = keyof typeof TOOL_PAGES;

/** The page a banner key names, for "where is this image used" lists. */
export function bannerPage(s: WorldSession, key: string): { name: string; icon: string; route: Route } {
	if (key === 'tasks') return { name: 'Tasks', icon: 'list-checks', route: ROUTES.tasks() };
	if (key.startsWith('page:')) {
		const page = key.slice(5) as ToolPage;
		const t = TOOL_PAGES[page];
		return { name: t?.name ?? 'Page', icon: t?.icon ?? 'image', route: { name: page } };
	}
	if (key.startsWith('map:')) {
		const m = s.maps.get(key.slice(4));
		return { name: m?.name ?? 'Map', icon: m?.icon ?? 'map', route: ROUTES.maps(key.slice(4)) };
	}
	if (key.startsWith('dashboard:')) {
		const d = s.dashboards.list().find((x) => x.id === key.slice(10));
		return { name: d?.name ?? 'Dashboard', icon: d?.icon ?? 'layout-dashboard', route: ROUTES.dashboard(key.slice(10)) };
	}
	const t = s.schemas.get(key.slice(5));
	return { name: t?.plural ?? 'Database', icon: t?.icon ?? 'database', route: ROUTES.database(key.slice(5)) };
}
