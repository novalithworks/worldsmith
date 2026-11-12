/**
 * An app location inside a Worldsmith pane. Routes are plain data so they can be stored
 * in view state (restored after restart) and pushed into Obsidian's navigation history.
 */
export interface Route {
	name: string;
	params?: Record<string, string>;
}

export const ROUTES = {
	/** Home, or one of the world's extra dashboards. */
	dashboard: (id?: string): Route => (id && id !== 'home' ? { name: 'dashboard', params: { id } } : { name: 'dashboard' }),
	tasks: (): Route => ({ name: 'tasks' }),
	/**
	 * The Writing Studio (WS2): its home or projects list, or one project's overview,
	 * manuscript or trash; `item` = the part, chapter or scene shown in the manuscript.
	 */
	writing: (o: { project?: string | null; view?: string | null; item?: string | null } = {}): Route => ({
		name: 'writing',
		params: Object.fromEntries(Object.entries(o).filter(([, v]) => !!v)) as Record<string, string>,
	}),
	database: (typeId: string): Route => ({ name: 'database', params: { typeId } }),
	entity: (id: string): Route => ({ name: 'entity', params: { id } }),
	search: (q?: string): Route => ({ name: 'search', params: q ? { q } : {} }),
	trash: (): Route => ({ name: 'trash' }),
	/** Every image the world uses; `show: 'missing'` for repairs. */
	media: (show?: string): Route => ({ name: 'media', params: show ? { show } : {} }),
	onboarding: (): Route => ({ name: 'onboarding' }),
	/** A connection's own page (its details, notes and custom properties). */
	relation: (edgeId: string): Route => ({ name: 'relation', params: { id: edgeId } }),
	/** Kinds of connection (Mentorship, Membership…). */
	relationships: (typeId?: string): Route => ({ name: 'relationships', params: typeId ? { typeId } : {} }),
	/** Page layouts for each type: presets, a live preview, and entries with their own. */
	layoutStudio: (typeId?: string): Route => ({ name: 'layout-studio', params: typeId ? { typeId } : {} }),
	/** How time is counted: months, weeks, festivals and eras (0.10). */
	calendars: (id?: string): Route => ({ name: 'calendars', params: id ? { id } : {} }),
	/** Every dated entry on one line (0.10). */
	timeline: (): Route => ({ name: 'timeline' }),
	features: (): Route => ({ name: 'features' }),
	/** Things in the world that look unfinished or broken, with fixes (0.10). */
	health: (show?: string): Route => ({ name: 'health', params: show ? { show } : {} }),
	/** Family trees and hierarchies (0.11). */
	trees: (id?: string): Route => ({ name: 'trees', params: id ? { id } : {} }),
	/** Everything and how it's connected (0.11). */
	graph: (id?: string, focus?: string): Route => ({ name: 'graph', params: Object.fromEntries(Object.entries({ id, focus }).filter(([, v]) => !!v)) as Record<string, string> }),
	/** Maps with pins, regions and routes; `focus` = an entry to show (0.11). */
	maps: (id?: string, focus?: string): Route => ({ name: 'maps', params: Object.fromEntries(Object.entries({ id, focus }).filter(([, v]) => !!v)) as Record<string, string> }),
	/** World files, type files, spreadsheets and Markdown notes. */
	transfer: (section?: string): Route => ({ name: 'transfer', params: section ? { section } : {} }),
	typeStudio: (typeId?: string, opts: { tab?: string; section?: string } = {}): Route => ({
		name: 'type-studio',
		params: Object.fromEntries(Object.entries({ typeId, tab: opts.tab, section: opts.section }).filter(([, v]) => !!v)) as Record<string, string>,
	}),
};

export function sameRoute(a: Route | null | undefined, b: Route | null | undefined): boolean {
	if (!a || !b) return false;
	if (a.name !== b.name) return false;
	const pa = a.params ?? {};
	const pb = b.params ?? {};
	const keys = new Set([...Object.keys(pa), ...Object.keys(pb)]);
	for (const k of keys) if (pa[k] !== pb[k]) return false;
	return true;
}

export function isRoute(v: unknown): v is Route {
	return typeof v === 'object' && v !== null && typeof (v as Route).name === 'string';
}
