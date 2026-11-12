import type { BlockInstance, DashboardMeta, LayoutDoc, SemanticColor, World } from '../core/types';
import { uuid } from '../core/util/ids';
import type { LayoutService } from './LayoutService';

export const HOME_DASHBOARD = 'home';

/** What a removed dashboard needs to come back exactly as it was (Undo). */
export interface RemovedDashboard {
	meta: DashboardMeta;
	index: number;
	layout: LayoutDoc | null;
}

/**
 * Extra dashboards (Milestone 7). Home is built in; the others are listed in world.json
 * (`dashboards`, sidebar order) with their widgets in layouts/ (`dashboard-<id>`), so a
 * name change and a widget change touch different files and sync independently.
 */
export class DashboardService {
	constructor(
		private readonly getWorld: () => World,
		private readonly updateWorld: (patch: Partial<World>) => void,
		private readonly layouts: LayoutService,
	) {}

	/** Save the list (one entry per id, first wins). */
	private write(list: DashboardMeta[]): void {
		const seen = new Set<string>();
		this.updateWorld({ dashboards: list.filter((d) => (seen.has(d.id) ? false : (seen.add(d.id), true))) });
	}

	/**
	 * Every dashboard, in sidebar order. Widgets saved for a dashboard that isn't in the list
	 * (an older Worldsmith on another device rewrote world.json without it, or the list
	 * synced before the widgets) are listed after the others, named after their layout. They
	 * are never written back on their own — only when you rename, move or delete — so a
	 * dashboard deleted elsewhere can't be resurrected by a sync race.
	 */
	list(): DashboardMeta[] {
		const listed = this.getWorld().dashboards;
		const known = new Set(listed.map((d) => d.id));
		const extra: DashboardMeta[] = [];
		for (const doc of this.layouts.all()) {
			if (doc.scope.kind !== 'dashboard') continue;
			const id = doc.scope.dashboardId;
			if (id === HOME_DASHBOARD || known.has(id)) continue;
			known.add(id);
			extra.push({ id, name: doc.name || 'Recovered dashboard', icon: 'layout-dashboard', color: null, description: '', createdAt: doc.createdAt });
		}
		return extra.length ? [...listed, ...extra.sort((a, b) => a.createdAt - b.createdAt)] : listed;
	}

	get(id: string): DashboardMeta | undefined {
		return this.list().find((d) => d.id === id);
	}

	create(input: { name: string; icon?: string; color?: SemanticColor | null; description?: string; blocks?: BlockInstance[] }): DashboardMeta {
		const meta: DashboardMeta = {
			id: uuid().slice(0, 8),
			name: input.name.trim() || 'New dashboard',
			icon: input.icon || 'layout-dashboard',
			color: input.color ?? null,
			description: input.description?.trim() ?? '',
			createdAt: Date.now(),
			...(input.blocks?.length ? { seeded: true } : {}),
		};
		// Widgets first, then the list: a device that syncs both sees a complete dashboard
		// as soon as it's listed (and `seeded` covers the other order).
		if (input.blocks?.length) this.layouts.save({ kind: 'dashboard', dashboardId: meta.id }, input.blocks, meta.name);
		// list() already shows the new widgets file as a nameless "recovered" dashboard;
		// the real entry replaces it.
		this.write([...this.list().filter((d) => d.id !== meta.id), meta]);
		return meta;
	}

	/** Write a dashboard that's only known from its widgets file into the list. */
	adopt(id: string): void {
		if (id === HOME_DASHBOARD || this.getWorld().dashboards.some((d) => d.id === id)) return;
		if (this.get(id)) this.write(this.list());
	}

	/** Whether a dashboard's widgets file exists (it may still be on its way by sync). */
	hasLayout(id: string): boolean {
		return !!this.layouts.get({ kind: 'dashboard', dashboardId: id });
	}

	update(id: string, patch: Partial<Pick<DashboardMeta, 'name' | 'icon' | 'color' | 'description'>>): void {
		const clean = { ...patch };
		if (clean.name !== undefined) clean.name = clean.name.trim() || 'Dashboard';
		this.write(this.list().map((d) => (d.id === id ? { ...d, ...clean } : d)));
	}

	duplicate(id: string): DashboardMeta | null {
		const src = this.get(id);
		if (!src) return null;
		const blocks = this.layouts.get({ kind: 'dashboard', dashboardId: id })?.blocks ?? [];
		const copy = this.create({ name: `${src.name} copy`, icon: src.icon, color: src.color, description: src.description, blocks });
		// Keep the copy right after its original.
		const rest = this.list().filter((d) => d.id !== copy.id);
		const at = rest.findIndex((d) => d.id === id) + 1;
		rest.splice(at, 0, copy);
		this.write(rest);
		return copy;
	}

	move(id: string, delta: number): void {
		const list = [...this.list()];
		const i = list.findIndex((d) => d.id === id);
		const to = i + delta;
		if (i < 0 || to < 0 || to >= list.length) return;
		const [d] = list.splice(i, 1);
		if (d) list.splice(to, 0, d);
		this.write(list);
	}

	/** Remove a dashboard and its layout. Returns everything needed to undo. */
	remove(id: string): RemovedDashboard | null {
		const list = this.list();
		const index = list.findIndex((d) => d.id === id);
		const meta = list[index];
		if (!meta) return null;
		const layout = this.layouts.reset({ kind: 'dashboard', dashboardId: id });
		this.write(list.filter((d) => d.id !== id));
		return { meta, index, layout };
	}

	restore(r: RemovedDashboard): void {
		if (this.get(r.meta.id)) return;
		if (r.layout) this.layouts.restore(r.layout);
		const list = this.list().filter((d) => d.id !== r.meta.id);
		list.splice(Math.min(r.index, list.length), 0, r.meta);
		this.write(list);
	}
}
