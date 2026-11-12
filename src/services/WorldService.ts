import { unsafeJsonReason } from '../core/util/safeJson';
import { ensureFamilyFields } from './familyFields';
import { DEFAULT_SIDEBAR_GROUPS, DEFAULT_STATUSES, RECORD_VERSIONS } from '../app/constants';
import type { EventBus } from '../core/events/EventBus';
import type { WorldsmithEvents } from '../core/events/events';
import type { BannerRef, EntitySchema, EntityTypeTemplate, RelationTypeTemplate, SidebarConfig, StorageManifest, World } from '../core/types';
import { Registry } from '../core/registry/Registry';
import { BUILTIN_RELATION_TYPES } from '../schemas/relations';
import { uuid } from '../core/util/ids';
import type { Database } from '../data/Database';
import type { WorldBackup } from '../data/backup/BackupService';
import type { FieldTypeRegistry } from '../fields/FieldTypeRegistry';
import { schemaFromTemplate } from './SchemaService';
import { WorldSession } from './WorldSession';

export type WorldState =
	| { kind: 'loading' }
	| { kind: 'onboarding' }
	| { kind: 'ready'; session: WorldSession }
	| { kind: 'error'; message: string };

export interface CreateWorldInput {
	name: string;
	description?: string;
	icon?: string;
	banner?: BannerRef | null;
	/** Template ids to install. Defaults to every registered template. */
	types?: string[];
}

/**
 * Owns the lifecycle of worlds: opening storage, onboarding, creating, switching,
 * reloading. Exposes the current WorldSession to the UI.
 */
export class WorldService {
	private _state: WorldState = { kind: 'loading' };
	private listeners = new Set<(s: WorldState) => void>();
	/** Problems found while loading that the user should hear about. */
	readonly warnings: string[] = [];

	constructor(
		private readonly db: Database,
		private readonly events: EventBus<WorldsmithEvents>,
		private readonly fieldTypes: FieldTypeRegistry,
		private readonly templates: Registry<EntityTypeTemplate>,
		private readonly relationTemplates: Registry<RelationTypeTemplate> = builtinRelationRegistry(),
	) {}

	get state(): WorldState {
		return this._state;
	}

	get session(): WorldSession | null {
		return this._state.kind === 'ready' ? this._state.session : null;
	}

	onState(cb: (s: WorldState) => void): () => void {
		this.listeners.add(cb);
		return () => this.listeners.delete(cb);
	}

	private setState(s: WorldState): void {
		this._state = s;
		for (const l of this.listeners) l(s);
	}

	manifest(): StorageManifest | null {
		return this.db.manifest.get();
	}

	async init(): Promise<void> {
		this.setState({ kind: 'loading' });
		try {
			const { manifest, quarantined } = await this.db.open();
			if (quarantined) this.warnings.push(`The Worldsmith manifest could not be read; a copy was kept at ${quarantined}.`);
			if (!manifest || !manifest.activeWorldId || manifest.worlds.length === 0) {
				this.setState({ kind: 'onboarding' });
				return;
			}
			await this.open(manifest.activeWorldId);
		} catch (e) {
			console.error('[Worldsmith] failed to initialize', e);
			this.setState({ kind: 'error', message: e instanceof Error ? e.message : String(e) });
		}
	}

	private async open(worldId: string, o: { discard?: boolean } = {}): Promise<void> {
		this.closeCurrent(o);
		this.setState({ kind: 'loading' });
		const stores = this.db.world(worldId);
		const result = await stores.loadAll();
		if (!result.world) {
			this.db.closeWorld(worldId);
			throw new Error('This world’s world.json is missing or unreadable. Restore a backup from settings, or create a new world.');
		}
		if (result.quarantined.length) {
			this.warnings.push(
				`${result.quarantined.length} damaged file(s) were moved to the quarantine folder and skipped. Your other data loaded normally.`,
			);
		}
		const session = new WorldSession(stores, this.events, this.fieldTypes, this.templates, this.relationTemplates);
		this.repairSidebar(session);
		session.ensureRelationTypes();
		session.ensureTasksSeeded();
		ensureFamilyFields(session);
		this.setState({ kind: 'ready', session });
		this.events.emit('world:loaded', { world: session.world });
	}

	/** Flush and close the active world (before relocating storage). */
	async shutdown(): Promise<void> {
		const s = this.session;
		s?.writing.flushProgress();
		if (s) await s.stores.flush();
		await this.db.queue.idle();
		this.closeCurrent();
		this.setState({ kind: 'loading' });
	}

	private closeCurrent(o: { discard?: boolean } = {}): void {
		const s = this.session;
		if (!s) return;
		// After a restore the files on disk are the truth: the old session's edits are dropped.
		if (o.discard) s.stores.discard();
		else void s.stores.flush();
		s.dispose();
		this.db.closeWorld(s.worldId);
		this.events.emit('world:unloaded', { worldId: s.worldId });
	}

	async createWorld(input: CreateWorldInput): Promise<WorldSession> {
		const manifest = this.db.manifest.get() ?? (await this.db.createManifest());
		const now = Date.now();
		const id = uuid();
		const chosen = this.templates
			.all()
			.filter((t) => !input.types || input.types.includes(t.id))
			.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
		const schemas: EntitySchema[] = chosen.map(schemaFromTemplate);

		const world: World = {
			v: RECORD_VERSIONS.world,
			id,
			name: input.name.trim() || 'Untitled world',
			description: input.description?.trim() ?? '',
			icon: input.icon || 'globe-2',
			banner: input.banner ?? null,
			statuses: DEFAULT_STATUSES.map((s) => ({ ...s })),
			defaultStatus: 'idea',
			sidebar: buildSidebar(schemas),
			progress: { mode: 'blend', includeOptional: false },
			pages: {},
			dashboards: [],
			// New worlds have no entries yet; new entries get their tasks on creation.
			tasksSeeded: true,
			// New worlds' character types come with Parents, Children and Spouses already.
			familyFields: true,
			pageBanners: {},
			mainCalendar: null,
			timeline: { types: [], tags: [], bands: ['era'], spans: {} },
			health: { ignored: [] },
			createdAt: now,
			updatedAt: now,
			rev: 0,
		};

		// Write world + schemas to disk before switching, so a crash mid-way never leaves
		// a manifest entry that points at nothing.
		const stores = this.db.world(id);
		await stores.world.save(world);
		for (const s of schemas) stores.schemas.put(s);
		await stores.schemas.flush();

		manifest.worlds.push({ id, name: world.name, folder: `worlds/${id}` });
		manifest.activeWorldId = id;
		await this.db.manifest.save(manifest);
		this.db.closeWorld(id);

		await this.open(id);
		return this.session as WorldSession;
	}

	/**
	 * Import a world from a Worldsmith backup/export file anywhere in the vault. Refuses to
	 * overwrite a world that already exists (use restore for that) — never destroys data.
	 */
	async importBackup(path: string): Promise<void> {
		const res = await this.db.files.read<WorldBackup>(path);
		await this.importBundle(res.value as WorldBackup);
	}

	/** Is this a world export file, and is that world already here? */
	inspectBundle(raw: unknown): { ok: true; name: string; worldId: string; exists: boolean; entries: number; types: number } | { ok: false; error: string } {
		const b = raw as Partial<WorldBackup> | null;
		if (!b || typeof b !== 'object' || b.format !== 'worldsmith/backup' || typeof b.worldId !== 'string' || !b.files || typeof b.files !== 'object') return { ok: false, error: 'That file isn’t a Worldsmith world file.' };
		// The id becomes a folder name: only plain ids (a crafted file can't point elsewhere).
		if (!SAFE_ID.test(b.worldId)) return { ok: false, error: 'That world file is damaged (its id isn’t valid).' };
		const why = unsafeJsonReason(b);
		if (why) return { ok: false, error: `That world file can’t be imported (${why}).` };
		const world = b.files['world.json'] as { name?: string; id?: string } | undefined;
		if (!world) return { ok: false, error: 'That file has no world in it (world.json is missing).' };
		if (world.id !== undefined && world.id !== b.worldId) return { ok: false, error: 'That world file is damaged (its ids don’t match).' };
		const count = (prefix: string) =>
			Object.entries(b.files!)
				.filter(([k]) => k.startsWith(prefix))
				.reduce((n, [, v]) => n + (Array.isArray((v as { records?: unknown[] })?.records) ? (v as { records: unknown[] }).records.length : 1), 0);
		const manifest = this.db.manifest.get();
		return { ok: true, name: world.name ?? 'Imported world', worldId: b.worldId, exists: !!manifest?.worlds.some((w) => w.id === b.worldId), entries: count('entities/'), types: count('schemas/') };
	}

	/**
	 * Add a world from an export file. A world that's already here is never overwritten: it
	 * can be added as a copy (new id, “(copy)” name) instead.
	 */
	async importBundle(bundle: WorldBackup, o: { asCopy?: boolean } = {}): Promise<string> {
		const info = this.inspectBundle(bundle);
		if (!info.ok) throw new Error(info.error);
		const manifest = this.db.manifest.get() ?? (await this.db.createManifest());
		let b = bundle;
		if (manifest.worlds.some((w) => w.id === bundle.worldId)) {
			if (!o.asCopy) throw new Error('This world is already in your vault. Import it as a copy, or restore it from Settings → Backups.');
			b = copyBundle(bundle, uuid());
		} else if (await this.db.adapter.exists(this.db.paths.worldDir(bundle.worldId))) {
			// Its folder is here without being listed (an earlier attempt, or Sync still
			// arriving): never write into it — import as a copy instead.
			b = copyBundle(bundle, uuid());
		}
		await this.db.backups.restoreBundle(b, b.worldId !== bundle.worldId ? { copyOf: bundle.worldId } : {});
		const worldFile = b.files['world.json'] as { name?: string } | undefined;
		manifest.worlds.push({ id: b.worldId, name: worldFile?.name ?? 'Imported world', folder: `worlds/${b.worldId}` });
		manifest.activeWorldId = b.worldId;
		await this.db.manifest.save(manifest);
		await this.open(b.worldId);
		return b.worldId;
	}

	/** A world export file of the open world (pending edits are written first). */
	async exportWorld(): Promise<WorldBackup> {
		const s = this.session;
		if (!s) throw new Error('No world is open.');
		await this.db.flushAllStrict();
		return this.db.backups.bundle(s.worldId, 'export');
	}

	async switchWorld(worldId: string): Promise<void> {
		const manifest = this.db.manifest.require();
		if (!manifest.worlds.some((w) => w.id === worldId)) throw new Error('Unknown world');
		manifest.activeWorldId = worldId;
		this.db.manifest.set(manifest);
		try {
			await this.open(worldId);
		} catch (e) {
			this.setState({ kind: 'error', message: e instanceof Error ? e.message : String(e) });
		}
	}

	/**
	 * Re-read the active world from disk (after sync or a manual file edit). `discard` drops
	 * the open world's unsaved changes instead of writing them (after a backup restore, so
	 * nothing still in memory is written over what was restored).
	 */
	async reload(o: { discard?: boolean } = {}): Promise<void> {
		const s = this.session;
		if (!s) return this.init();
		if (o.discard) s.stores.discard();
		else await s.stores.flush();
		await this.db.queue.idle();
		try {
			await this.open(s.worldId, o);
		} catch (e) {
			this.setState({ kind: 'error', message: e instanceof Error ? e.message : String(e) });
		}
	}

	/** Keep the manifest's cached world name in sync with world.json. */
	syncManifestName(world: World): void {
		const m = this.db.manifest.get();
		const entry = m?.worlds.find((w) => w.id === world.id);
		if (m && entry && entry.name !== world.name) {
			entry.name = world.name;
			this.db.manifest.set(m);
		}
	}

	/** Make sure every schema appears in some sidebar group (e.g. after an import). */
	private repairSidebar(session: WorldSession): void {
		const world = session.world;
		const listed = new Set<string>();
		for (const g of world.sidebar.groups) for (const i of g.items) if (i.kind === 'type') listed.add(i.typeId);
		const missing = session.schemaRepo.all().filter((s) => !listed.has(s.id));
		const sidebar = world.sidebar.groups.length ? structuredCloneSafe(world.sidebar) : buildSidebar([]);
		let changed = !world.sidebar.groups.length;
		for (const s of missing) {
			addTypeToSidebar(sidebar, s);
			changed = true;
		}
		if (ensureStudioItem(sidebar)) changed = true;
		if (ensureRelationshipsItem(sidebar)) changed = true;
		if (ensureLayoutStudioItem(sidebar)) changed = true;
		if (ensureTransferItem(sidebar)) changed = true;
		if (ensureMediaItem(sidebar)) changed = true;
		if (ensureTimeItems(sidebar)) changed = true;
		if (ensureVisualItems(sidebar)) changed = true;
		if (changed) session.updateWorld({ sidebar });
	}

	dispose(): void {
		const s = this.session;
		if (s) s.dispose();
		this.listeners.clear();
	}
}

/** Standalone registry of the built-in relationship types (tests, headless use). */
export function builtinRelationRegistry(): Registry<RelationTypeTemplate> {
	const r = new Registry<RelationTypeTemplate>('RelationTypeRegistry');
	for (const t of BUILTIN_RELATION_TYPES) r.register(t);
	return r;
}

function structuredCloneSafe<T>(v: T): T {
	return JSON.parse(JSON.stringify(v)) as T;
}

export function buildSidebar(schemas: EntitySchema[]): SidebarConfig {
	const sidebar: SidebarConfig = {
		groups: DEFAULT_SIDEBAR_GROUPS.map((g) => ({ id: g.id, label: g.label, items: [] })),
		hidden: [],
	};
	for (const s of schemas) addTypeToSidebar(sidebar, s);
	const tools = sidebar.groups.find((g) => g.id === 'tools');
	if (tools) {
		tools.items.push({ kind: 'route', route: 'search', label: 'Search', icon: 'search' });
		tools.items.push({ kind: 'route', route: 'trash', label: 'Trash', icon: 'trash-2' });
	}
	ensureStudioItem(sidebar);
	ensureRelationshipsItem(sidebar);
	ensureLayoutStudioItem(sidebar);
	ensureTransferItem(sidebar);
	ensureMediaItem(sidebar);
	ensureTimeItems(sidebar);
	ensureVisualItems(sidebar);
	return sidebar;
}

/** Worlds created before 0.5 get a Media entry in the Tools group once (before Trash). */
export function ensureMediaItem(sidebar: SidebarConfig): boolean {
	const has = sidebar.groups.some((g) => g.items.some((i) => i.kind === 'route' && i.route === 'media'));
	if (has || sidebar.hidden.includes('route:media')) return false;
	let tools = sidebar.groups.find((g) => g.id === 'tools');
	if (!tools) {
		tools = { id: 'tools', label: 'Tools', items: [] };
		sidebar.groups.push(tools);
	}
	const item = { kind: 'route' as const, route: 'media', label: 'Media', icon: 'images' };
	const trash = tools.items.findIndex((i) => i.kind === 'route' && i.route === 'trash');
	tools.items.splice(trash === -1 ? tools.items.length : trash, 0, item);
	return true;
}

/**
 * A Studio page's sidebar entry, added once to worlds created before it existed — after
 * `after` when that's in the group, else at the end. Never re-added once the user hides it.
 */
function ensureStudioRoute(sidebar: SidebarConfig, route: string, label: string, iconName: string, after?: string): boolean {
	const has = sidebar.groups.some((g) => g.items.some((i) => i.kind === 'route' && i.route === route));
	if (has || sidebar.hidden.includes(`route:${route}`)) return false;
	let studio = sidebar.groups.find((g) => g.id === 'studio');
	if (!studio) {
		studio = { id: 'studio', label: 'Studio', items: [] };
		sidebar.groups.push(studio);
	}
	const at = after ? studio.items.findIndex((i) => i.kind === 'route' && i.route === after) : -1;
	studio.items.splice(at === -1 ? studio.items.length : at + 1, 0, { kind: 'route', route, label, icon: iconName });
	return true;
}

/** Worlds created before Type Studio existed get its sidebar entry added once. */
export function ensureStudioItem(sidebar: SidebarConfig): boolean {
	return ensureStudioRoute(sidebar, 'type-studio', 'Type Studio', 'shapes');
}

/** Worlds created before relations get a Relationships entry in the Studio group once. */
export function ensureRelationshipsItem(sidebar: SidebarConfig): boolean {
	return ensureStudioRoute(sidebar, 'relationships', 'Relationships', 'waypoints');
}

/** Layout Studio (0.9), right after Type Studio. */
export function ensureLayoutStudioItem(sidebar: SidebarConfig): boolean {
	return ensureStudioRoute(sidebar, 'layout-studio', 'Layout Studio', 'layout-template', 'type-studio');
}

/** Import & export (0.9), at the end of the Studio group. */
export function ensureTransferItem(sidebar: SidebarConfig): boolean {
	return ensureStudioRoute(sidebar, 'transfer', 'Import & export', 'arrow-down-up');
}

/** A Tools page's entry, added once (before Trash, or after `after`). Never re-added once hidden. */
function ensureToolsRoute(sidebar: SidebarConfig, route: string, label: string, iconName: string, after?: string): boolean {
	const has = sidebar.groups.some((g) => g.items.some((i) => i.kind === 'route' && i.route === route));
	if (has || sidebar.hidden.includes(`route:${route}`)) return false;
	let tools = sidebar.groups.find((g) => g.id === 'tools');
	if (!tools) {
		tools = { id: 'tools', label: 'Tools', items: [] };
		sidebar.groups.push(tools);
	}
	const item = { kind: 'route' as const, route, label, icon: iconName };
	const at = after ? tools.items.findIndex((i) => i.kind === 'route' && i.route === after) : -1;
	const trash = tools.items.findIndex((i) => i.kind === 'route' && i.route === 'trash');
	tools.items.splice(at !== -1 ? at + 1 : trash === -1 ? tools.items.length : trash, 0, item);
	return true;
}

/** Calendars (Studio, after Relationships), Timeline and World health (Tools), 0.10. */
export function ensureTimeItems(sidebar: SidebarConfig): boolean {
	const a = ensureStudioRoute(sidebar, 'calendars', 'Calendars', 'calendar-range', 'relationships');
	const b = ensureToolsRoute(sidebar, 'timeline', 'Timeline', 'gantt-chart', 'search');
	const c = ensureToolsRoute(sidebar, 'health', 'World health', 'heart-pulse', 'timeline');
	return a || b || c;
}

/** Maps, Trees and the Relationship graph (Tools, after Timeline), 0.11; "Family trees" became "Trees" in 0.12. */
export function ensureVisualItems(sidebar: SidebarConfig): boolean {
	const a = ensureToolsRoute(sidebar, 'maps', 'Maps', 'map', 'timeline');
	const b = ensureToolsRoute(sidebar, 'trees', 'Trees', 'network', 'maps');
	const c = ensureToolsRoute(sidebar, 'graph', 'Graph', 'share-2', 'trees');
	// The old name, unless it was renamed by hand.
	let d = false;
	for (const g of sidebar.groups)
		for (const i of g.items)
			if (i.kind === 'route' && i.route === 'trees' && i.label === 'Family trees') {
				i.label = 'Trees';
				d = true;
			} else if (i.kind === 'route' && i.route === 'graph' && i.label === 'Relationship graph') {
				// 0.30: “Relationship graph” became “Graph” (unless renamed by hand).
				i.label = 'Graph';
				d = true;
			}
	return a || b || c || d;
}

export function addTypeToSidebar(sidebar: SidebarConfig, schema: EntitySchema): void {
	let group = sidebar.groups.find((g) => g.id === schema.group);
	if (!group) {
		group = sidebar.groups.find((g) => g.id === 'custom');
		if (!group) {
			group = { id: 'custom', label: 'Custom', items: [] };
			const toolsIdx = sidebar.groups.findIndex((g) => g.id === 'tools');
			sidebar.groups.splice(toolsIdx === -1 ? sidebar.groups.length : toolsIdx, 0, group);
		}
	}
	if (!group.items.some((i) => i.kind === 'type' && i.typeId === schema.id)) {
		group.items.push({ kind: 'type', typeId: schema.id });
	}
}

/**
 * The same world under a new id: every record that names the old world id (world.json's id,
 * each entry's worldId) is rewritten, and the name gets “(copy)”. Nothing else changes.
 */
/** World, type and relation ids that are safe to use as file and folder names. */
export const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

export function copyBundle(bundle: WorldBackup, newId: string): WorldBackup {
	const old = bundle.worldId;
	const walk = (v: unknown): unknown => {
		if (Array.isArray(v)) return v.map(walk);
		if (v && typeof v === 'object') {
			const out: Record<string, unknown> = {};
			for (const [k, x] of Object.entries(v as Record<string, unknown>)) out[k] = (k === 'worldId' || k === 'activeWorldId') && x === old ? newId : walk(x);
			return out;
		}
		return v;
	};
	const files = walk(bundle.files) as Record<string, unknown>;
	const world = files['world.json'] as Record<string, unknown> | undefined;
	if (world) {
		if (world.id === old) world.id = newId;
		if (typeof world.name === 'string') world.name = `${world.name} (copy)`;
	}
	return { ...bundle, worldId: newId, files };
}
