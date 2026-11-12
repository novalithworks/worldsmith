import type { SemanticColor, StatusId, TypeId, WorldId } from './ids';
import type { BannerRef } from './media';

export type StatusCategory = 'idea' | 'active' | 'done' | 'archived';

export interface StatusDefinition {
	id: StatusId;
	label: string;
	color: SemanticColor;
	category: StatusCategory;
	icon?: string;
}

export type SidebarItem =
	| { kind: 'type'; typeId: TypeId }
	| { kind: 'route'; route: string; label?: string; icon?: string };

export interface SidebarGroup {
	id: string;
	label: string;
	collapsed?: boolean;
	items: SidebarItem[];
}

export interface SidebarConfig {
	groups: SidebarGroup[];
	/** Item keys ("type:<id>" | "route:<name>") hidden from the sidebar. */
	hidden: string[];
}

export interface ProgressConfig {
	mode: 'tasks' | 'fields' | 'blend';
	includeOptional: boolean;
}

/**
 * An extra dashboard (Milestone 7). Home is built in and never listed here; these are the
 * pages people add under "Dashboards" in the sidebar. Their layouts live in layouts/
 * (`dashboard-<id>`); this list holds names, icons and sidebar order.
 */
export interface DashboardMeta {
	id: string;
	name: string;
	icon: string;
	color: SemanticColor | null;
	description: string;
	createdAt: number;
	/**
	 * Created with widgets (from a template or a copy). If the dashboard arrives by sync
	 * before its widgets file, the page waits instead of offering to start it empty.
	 */
	seeded?: boolean;
}

/** Saved layout of a customizable page (the Tasks home). */
export interface PageLayout {
	blocks: import('./layout').BlockInstance[];
}

export interface World {
	v: number;
	id: WorldId;
	name: string;
	description: string;
	icon: string;
	banner: BannerRef | null;
	statuses: StatusDefinition[];
	defaultStatus: StatusId;
	sidebar: SidebarConfig;
	progress: ProgressConfig;
	/** Customizable pages, keyed by page id ("tasks"). Missing = built-in default. */
	pages: Record<string, PageLayout>;
	/** Extra dashboards, in sidebar order. Home isn't listed. */
	dashboards: DashboardMeta[];
	/** Set once existing entries have received their schema's default tasks. */
	tasksSeeded: boolean;
	/** Set once character types have Parents, Children and Spouses fields (0.12). */
	familyFields?: boolean;
	/**
	 * Banners of pages other than entries and Home (0.10), keyed by page:
	 * "tasks", "dashboard:<id>", "type:<typeId>" (a type's database).
	 */
	pageBanners: Record<string, BannerRef>;
	/** The calendar dates use unless they name another (0.10). Null = the first one. */
	mainCalendar: string | null;
	/** What the Timeline page shows (0.10). */
	timeline: TimelineConfig;
	/** World health check (0.10): findings someone chose to ignore, by key. */
	health: { ignored: string[] };
	/** Parts of Worldsmith this world has switched off (0.29). Absent = on. */
	features?: import('../features').FeatureFlags;
	/** Native note templates per type (0.17). Absent = the built-in that fits each type. */
	noteTemplates?: import('./nativeNote').NoteTemplateConfig;
	createdAt: number;
	updatedAt: number;
	rev: number;
}

/** Timeline page settings (0.10). Empty lists mean "everything". */
export interface TimelineConfig {
	types: TypeId[];
	tags: string[];
	/** Types drawn as coloured bands behind everything (eras, ages, reigns). */
	bands: TypeId[];
	/** Per type: which date fields start and end a span. Absent = guessed from the fields. */
	spans: Record<TypeId, { start: string; end: string | null }>;
}

export interface ManifestWorldEntry {
	id: WorldId;
	name: string;
	folder: string;
}

export interface StorageManifest {
	format: 'worldsmith/manifest';
	v: number;
	storageVersion: number;
	createdAt: number;
	activeWorldId: WorldId | null;
	worlds: ManifestWorldEntry[];
}
