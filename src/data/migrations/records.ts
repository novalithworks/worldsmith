import { cleanFeatures } from '../../core/features';
import { normalizeGallery, normalizeRef } from '../../core/util/media';
import { normalizeAppearance, normalizeSections } from '../../services/notes/templates';
import type {
	DatabaseView,
	ViewCondition,
	BannerRef,
	BlockInstance,
	Calendar,
	CalendarEra,
	CalendarFestival,
	CalendarMonth,
	LayoutPresetDoc,
	NoteTemplate,
	GraphDoc,
	MapDoc,
	MapLayer,
	MapPath,
	MapPin,
	MapRegion,
	SemanticColor,
	TreeDoc,
	LayoutDoc,
	LayoutScope,
	ChronoDate,
	DevTask,
	EdgeStatus,
	EntityRecord,
	RelationEdge,
	RelationType,
	EntitySchema,
	FieldDefinition,
	SectionDefinition,
	StorageManifest,
	World,
	ManuscriptItem,
	ManuscriptKind,
	PlotThread,
	ProjectKind,
	SceneStatus,
	WritingProject,
	StoryBeat,
	WritingTemplate,
	WritingTemplateNode,
} from '../../core/types';
import { DEFAULT_SCENE_STATUSES, DEFAULT_STATUSES, RECORD_VERSIONS, STORAGE_VERSION } from '../../app/constants';

/**
 * Record-level migrations + normalization.
 *
 * `hydrateX(raw)` runs every registered upgrade step from the record's `v` to the
 * current version, then normalizes (fills missing properties with safe defaults, drops
 * wrong-typed values). This is what makes partially written, hand-edited or older files
 * load safely. Returns `upgraded: true` when the stored shape should be rewritten.
 *
 * To change a record shape:
 *   1. bump RECORD_VERSIONS.<kind> in app/constants.ts
 *   2. add `{ from: n, up(raw) { … } }` to the matching STEPS list below
 */
type Raw = Record<string, unknown>;
interface Step {
	from: number;
	up(raw: Raw): Raw;
}

const ENTITY_STEPS: Step[] = [];
const SCHEMA_STEPS: Step[] = [];
const WORLD_STEPS: Step[] = [];
const EDGE_STEPS: Step[] = [];
const TASK_STEPS: Step[] = [];
const RELATION_TYPE_STEPS: Step[] = [];

function runSteps(raw: Raw, steps: Step[], target: number): { raw: Raw; upgraded: boolean } {
	let v = typeof raw.v === 'number' ? raw.v : 1;
	let upgraded = typeof raw.v !== 'number';
	let cur = raw;
	while (v < target) {
		const step = steps.find((s) => s.from === v);
		if (!step) break;
		cur = step.up(cur);
		v++;
		upgraded = true;
	}
	cur.v = target;
	return { raw: cur, upgraded };
}

const isObj = (v: unknown): v is Raw => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown, d = ''): string => (typeof v === 'string' ? v : d);
const num = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const strArr = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
const nullableNum = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

export function hydrateEntity(input: unknown): { record: EntityRecord; upgraded: boolean } | null {
	if (!isObj(input) || typeof input.id !== 'string' || typeof input.typeId !== 'string') return null;
	const { raw, upgraded } = runSteps({ ...input }, ENTITY_STEPS, RECORD_VERSIONS.entity);
	const now = Date.now();
	const media = isObj(raw.media) ? raw.media : {};
	const flags = isObj(raw.flags) ? raw.flags : {};
	const record: EntityRecord = {
		// Keys a newer version added are kept.
		...(raw as object),
		v: RECORD_VERSIONS.entity,
		id: raw.id as string,
		worldId: str(raw.worldId),
		typeId: raw.typeId as string,
		name: str(raw.name, 'Untitled'),
		aliases: strArr(raw.aliases),
		tags: strArr(raw.tags),
		description: str(raw.description),
		status: str(raw.status, 'idea'),
		values: isObj(raw.values) ? { ...raw.values } : {},
		media: {
			icon: typeof media.icon === 'string' ? media.icon : null,
			portrait: normalizeRef(media.portrait),
			banner: normalizeRef(media.banner),
			symbol: normalizeRef(media.symbol),
			gallery: normalizeGallery(media.gallery),
		},
		parentId: typeof raw.parentId === 'string' ? raw.parentId : null,
		sortOrder: num(raw.sortOrder, 0),
		flags: {
			favorite: flags.favorite === true,
			pinned: flags.pinned === true,
			hidden: flags.hidden === true,
		},
		linkedNote: isObj(raw.linkedNote) && typeof raw.linkedNote.path === 'string' ? { path: raw.linkedNote.path } : null,
		moreNotes: Array.isArray(raw.moreNotes)
			? (raw.moreNotes as unknown[])
					.filter((n): n is Raw => isObj(n) && typeof n.path === 'string' && !!n.path)
					.map((n) => (typeof n.label === 'string' && n.label ? { path: n.path as string, label: n.label } : { path: n.path as string }))
					.filter((n, i, all) => all.findIndex((x) => x.path === n.path) === i)
			: [],
		createdAt: num(raw.createdAt, now),
		updatedAt: num(raw.updatedAt, now),
		rev: num(raw.rev, 0),
		archivedAt: nullableNum(raw.archivedAt),
		trashedAt: nullableNum(raw.trashedAt),
	};
	return { record, upgraded };
}

function hydrateField(f: unknown): FieldDefinition | null {
	if (!isObj(f) || typeof f.id !== 'string' || typeof f.type !== 'string') return null;
	return { ...(f as unknown as FieldDefinition), label: str(f.label, f.id) };
}

function hydrateSection(s: unknown): SectionDefinition | null {
	if (!isObj(s) || typeof s.id !== 'string') return null;
	return { ...(s as unknown as SectionDefinition), label: str(s.label, s.id), fieldIds: strArr(s.fieldIds) };
}

export function hydrateSchema(input: unknown): { record: EntitySchema; upgraded: boolean } | null {
	if (!isObj(input) || typeof input.id !== 'string') return null;
	const { raw, upgraded } = runSteps({ ...input }, SCHEMA_STEPS, RECORD_VERSIONS.schema);
	const now = Date.now();
	const display = isObj(raw.display) ? raw.display : {};
	const hierarchy = isObj(raw.hierarchy) ? raw.hierarchy : {};
	const singular = str(raw.singular, raw.id as string);
	const record: EntitySchema = {
		v: RECORD_VERSIONS.schema,
		id: raw.id as string,
		singular,
		plural: str(raw.plural, singular + 's'),
		icon: str(raw.icon, 'box'),
		description: str(raw.description),
		color: typeof raw.color === 'string' ? (raw.color as EntitySchema['color']) : null,
		group: str(raw.group, 'custom'),
		fields: Array.isArray(raw.fields) ? raw.fields.map(hydrateField).filter((f): f is FieldDefinition => !!f) : [],
		sections: Array.isArray(raw.sections)
			? raw.sections.map(hydrateSection).filter((s): s is SectionDefinition => !!s)
			: [],
		display: { subtitleFields: strArr(display.subtitleFields), cardFields: strArr(display.cardFields) },
		hierarchy: {
			allowParent: hierarchy.allowParent !== false,
			parentTypes: strArr(hierarchy.parentTypes),
			childTypes: strArr(hierarchy.childTypes),
		},
		defaultTasks: Array.isArray(raw.defaultTasks) ? (raw.defaultTasks.filter(isObj) as never) : [],
		defaultLayout: isObj(raw.defaultLayout) ? (raw.defaultLayout as never) : null,
		origin: isObj(raw.origin) ? (raw.origin as never) : null,
		archived: raw.archived === true,
		createdAt: num(raw.createdAt, now),
		updatedAt: num(raw.updatedAt, now),
		rev: num(raw.rev, 0),
	};
	return { record, upgraded };
}

export function hydrateWorld(input: unknown): { value: World; upgraded: boolean } | null {
	if (!isObj(input) || typeof input.id !== 'string') return null;
	const { raw, upgraded } = runSteps({ ...input }, WORLD_STEPS, RECORD_VERSIONS.world);
	const now = Date.now();
	const sidebar = isObj(raw.sidebar) ? raw.sidebar : {};
	const progress = isObj(raw.progress) ? raw.progress : {};
	const statuses = Array.isArray(raw.statuses) && raw.statuses.length ? (raw.statuses as World['statuses']) : DEFAULT_STATUSES;
	const timeline = isObj(raw.timeline) ? raw.timeline : {};
	const health = isObj(raw.health) ? raw.health : {};
	const value: World = {
		// Keys a newer version added are kept, so this version never drops them on save.
		...(raw as object),
		v: RECORD_VERSIONS.world,
		id: raw.id as string,
		name: str(raw.name, 'Untitled world'),
		description: str(raw.description),
		icon: str(raw.icon, 'globe-2'),
		banner: normalizeRef(raw.banner),
		statuses,
		defaultStatus: str(raw.defaultStatus, statuses[0]?.id ?? 'idea'),
		sidebar: {
			groups: Array.isArray(sidebar.groups) ? (sidebar.groups.filter(isObj) as never) : [],
			hidden: strArr(sidebar.hidden),
		},
		progress: {
			mode: progress.mode === 'fields' || progress.mode === 'tasks' ? progress.mode : 'blend',
			includeOptional: progress.includeOptional === true,
		},
		pages: isObj(raw.pages)
			? Object.fromEntries(
					Object.entries(raw.pages)
						.filter(([, v]) => isObj(v) && Array.isArray((v).blocks))
						.map(([k, v]) => [k, { blocks: hydrateBlocks((v as Raw).blocks) }]),
				)
			: {},
		dashboards: hydrateDashboards(raw.dashboards, now),
		tasksSeeded: raw.tasksSeeded === true,
		familyFields: raw.familyFields === true,
		pageBanners: isObj(raw.pageBanners)
			? Object.fromEntries(
					Object.entries(raw.pageBanners)
						.map(([k, v]) => [k, normalizeRef<BannerRef>(v)] as const)
						.filter((e): e is [string, NonNullable<ReturnType<typeof normalizeRef>>] => !!e[1]),
				)
			: {},
		mainCalendar: typeof raw.mainCalendar === 'string' && raw.mainCalendar ? raw.mainCalendar : null,
		timeline: {
			...timeline,
			types: strArr(timeline.types),
			tags: strArr(timeline.tags),
			bands: Array.isArray(timeline.bands) ? strArr(timeline.bands) : ['era'],
			spans: isObj(timeline.spans)
				? Object.fromEntries(
						Object.entries(timeline.spans)
							.filter(([, v]) => isObj(v) && typeof (v).start === 'string')
							.map(([k, v]) => [k, { start: (v as Raw).start as string, end: typeof (v as Raw).end === 'string' ? ((v as Raw).end as string) : null }]),
					)
				: {},
		},
		health: { ...health, ignored: strArr(health.ignored) },
		...(isObj(raw.features) ? { features: cleanFeatures(raw.features) } : {}),
		createdAt: num(raw.createdAt, now),
		updatedAt: num(raw.updatedAt, now),
		rev: num(raw.rev, 0),
	};
	return { value, upgraded };
}

/** Extra dashboards: drop malformed rows and duplicate ids, keep order; "home" is reserved. */
function hydrateDashboards(input: unknown, now: number): World['dashboards'] {
	if (!Array.isArray(input)) return [];
	const seen = new Set<string>(['home']);
	const out: World['dashboards'] = [];
	for (const d of input) {
		if (!isObj(d) || typeof d.id !== 'string' || !d.id || seen.has(d.id)) continue;
		seen.add(d.id);
		out.push({
			...(d as object),
			id: d.id,
			name: str(d.name, 'Dashboard'),
			icon: str(d.icon, 'layout-dashboard'),
			color: typeof d.color === 'string' && d.color ? (d.color as never) : null,
			description: str(d.description),
			createdAt: num(d.createdAt, now),
		});
	}
	return out;
}

const EDGE_STATUSES: EdgeStatus[] = ['active', 'ended', 'strained', 'unknown'];

function chronoOrNull(v: unknown): ChronoDate | null {
	return isObj(v) && typeof v.year === 'number' && typeof v.precision === 'string' ? (v as unknown as ChronoDate) : null;
}

export function hydrateEdge(input: unknown): { record: RelationEdge; upgraded: boolean } | null {
	if (!isObj(input)) return null;
	if (typeof input.id !== 'string' || typeof input.type !== 'string' || typeof input.from !== 'string' || typeof input.to !== 'string') return null;
	const { raw, upgraded } = runSteps({ ...input }, EDGE_STEPS, RECORD_VERSIONS.edge);
	const now = Date.now();
	const strength = nullableNum(raw.strength);
	const record: RelationEdge = {
		v: RECORD_VERSIONS.edge,
		id: raw.id as string,
		type: raw.type as string,
		from: raw.from as string,
		to: raw.to as string,
		status: EDGE_STATUSES.includes(raw.status as EdgeStatus) ? (raw.status as EdgeStatus) : null,
		strength: strength === null ? null : Math.max(1, Math.min(5, Math.round(strength))),
		secret: raw.secret === true,
		start: chronoOrNull(raw.start),
		end: chronoOrNull(raw.end),
		description: str(raw.description),
		notes: str(raw.notes),
		props: isObj(raw.props) ? { ...raw.props } : {},
		order: num(raw.order, 0),
		createdAt: num(raw.createdAt, now),
		updatedAt: num(raw.updatedAt, now),
		rev: num(raw.rev, 0),
	};
	return { record, upgraded };
}

export function hydrateRelationType(input: unknown): { record: RelationType; upgraded: boolean } | null {
	if (!isObj(input) || typeof input.id !== 'string') return null;
	const { raw, upgraded } = runSteps({ ...input }, RELATION_TYPE_STEPS, RECORD_VERSIONS.relationType);
	const now = Date.now();
	const label = str(raw.label, raw.id as string);
	const forwardLabel = str(raw.forwardLabel, label);
	const symmetric = raw.symmetric === true;
	const record: RelationType = {
		v: RECORD_VERSIONS.relationType,
		id: raw.id as string,
		label,
		forwardLabel,
		reverseLabel: symmetric ? forwardLabel : str(raw.reverseLabel, `${label} of`),
		symmetric,
		category: str(raw.category, 'Custom'),
		sourceTypes: strArr(raw.sourceTypes),
		targetTypes: strArr(raw.targetTypes),
		fields: Array.isArray(raw.fields) ? raw.fields.map(hydrateField).filter((f): f is FieldDefinition => !!f) : [],
		origin: isObj(raw.origin) ? (raw.origin as never) : null,
		createdAt: num(raw.createdAt, now),
		updatedAt: num(raw.updatedAt, now),
		rev: num(raw.rev, 0),
	};
	if (typeof raw.description === 'string' && raw.description) record.description = raw.description;
	if (typeof raw.icon === 'string' && raw.icon) record.icon = raw.icon;
	if (typeof raw.color === 'string') record.color = raw.color as RelationType['color'];
	return { record, upgraded };
}

const TASK_STATUS_IDS = ['open', 'in-progress', 'blocked', 'done'];
const REPEATS = ['daily', 'weekly', 'monthly', 'yearly'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function hydrateTask(input: unknown): { record: DevTask; upgraded: boolean } | null {
	if (!isObj(input) || typeof input.id !== 'string') return null;
	const { raw, upgraded } = runSteps({ ...input }, TASK_STEPS, RECORD_VERSIONS.task);
	const now = Date.now();
	// 'complete' was the planned name before 0.4.0.
	const status = raw.status === 'complete' ? 'done' : raw.status;
	const priority = num(raw.priority, 0);
	const record: DevTask = {
		v: RECORD_VERSIONS.task,
		id: raw.id as string,
		entityId: typeof raw.entityId === 'string' ? raw.entityId : null,
		typeId: typeof raw.typeId === 'string' ? raw.typeId : null,
		templateId: typeof raw.templateId === 'string' ? raw.templateId : null,
		title: str(raw.title, 'Untitled task'),
		notes: str(raw.notes),
		category: str(raw.category),
		status: TASK_STATUS_IDS.includes(status as string) ? (status as DevTask['status']) : 'open',
		optional: raw.optional === true,
		priority: Math.max(0, Math.min(4, Math.round(priority))) as DevTask['priority'],
		due: typeof raw.due === 'string' && DATE_RE.test(raw.due) ? raw.due : null,
		repeat: REPEATS.includes(raw.repeat as string) ? (raw.repeat as DevTask['repeat']) : null,
		order: num(raw.order, 0),
		createdAt: num(raw.createdAt, now),
		updatedAt: num(raw.updatedAt, now),
		completedAt: nullableNum(raw.completedAt),
		rev: num(raw.rev, 0),
	};
	return { record, upgraded: upgraded || status !== raw.status };
}

export function hydrateManifest(input: unknown): { value: StorageManifest; upgraded: boolean } | null {
	if (!isObj(input)) return null;
	const worlds = Array.isArray(input.worlds)
		? input.worlds.filter((w): w is Raw => isObj(w) && typeof w.id === 'string').map((w) => ({
				id: w.id as string,
				name: str(w.name, 'World'),
				folder: str(w.folder, `worlds/${w.id as string}`),
			}))
		: [];
	return {
		value: {
			format: 'worldsmith/manifest',
			v: RECORD_VERSIONS.manifest,
			storageVersion: num(input.storageVersion, STORAGE_VERSION),
			createdAt: num(input.createdAt, Date.now()),
			activeWorldId: typeof input.activeWorldId === 'string' ? input.activeWorldId : (worlds[0]?.id ?? null),
			worlds,
		},
		upgraded: typeof input.v !== 'number',
	};
}

// ── layouts ──────────────────────────────────────────────────────────────────

const LAYOUT_STEPS: Step[] = [];
const int = (v: unknown, d: number, lo: number, hi: number): number => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : d);

/**
 * One placed block. Unknown keys are kept (future flags survive older versions); the
 * geometry is clamped to the 12-column grid so a hand-edited file can't break a page.
 */
/** A block's fixed height (px) when the user sets one. */
export const BLOCK_HEIGHT_MIN = 80;
export const BLOCK_HEIGHT_MAX = 2400;

export function hydrateBlock(input: unknown, i = 0): BlockInstance | null {
	if (!isObj(input) || typeof input.type !== 'string' || !input.type) return null;
	const w = int(input.w, 12, 1, 12);
	const out: BlockInstance = {
		...(input as object),
		id: typeof input.id === 'string' && input.id ? input.id : `${input.type}-${i}`,
		type: input.type,
		x: Math.min(int(input.x, 0, 0, 11), 12 - w),
		y: int(input.y, i, 0, 10_000),
		w,
		h: int(input.h, 1, 1, 100),
		config: isObj(input.config) ? { ...input.config } : {},
	};
	if ('title' in input && typeof input.title !== 'string' && input.title !== null) delete out.title;
	if ('height' in input) {
		const ht = input.height;
		if (typeof ht === 'number' && Number.isFinite(ht)) out.height = Math.round(Math.min(BLOCK_HEIGHT_MAX, Math.max(BLOCK_HEIGHT_MIN, ht)));
		else delete out.height;
	}
	return out;
}

export function hydrateBlocks(input: unknown): BlockInstance[] {
	if (!Array.isArray(input)) return [];
	const seen = new Set<string>();
	const out: BlockInstance[] = [];
	input.forEach((b, i) => {
		const h = hydrateBlock(b, i);
		if (!h) return;
		if (seen.has(h.id)) {
			// Renamed ids can collide with later ones too ("a", "a", "a-1"): keep counting.
			const base = h.id;
			let n = i;
			while (seen.has(`${base}-${n}`)) n++;
			h.id = `${base}-${n}`;
		}
		seen.add(h.id);
		out.push(h);
	});
	return out;
}

export function hydrateLayout(input: unknown): { record: LayoutDoc; upgraded: boolean } | null {
	if (!isObj(input) || typeof input.id !== 'string') return null;
	const { raw, upgraded } = runSteps({ ...input }, LAYOUT_STEPS, RECORD_VERSIONS.layout);
	const sc = isObj(raw.scope) ? raw.scope : null;
	let scope: LayoutScope | null = null;
	if (sc?.kind === 'type' && typeof sc.typeId === 'string') scope = { kind: 'type', typeId: sc.typeId };
	else if (sc?.kind === 'entity' && typeof sc.entityId === 'string') scope = { kind: 'entity', entityId: sc.entityId };
	else if (sc?.kind === 'dashboard' && typeof sc.dashboardId === 'string') scope = { kind: 'dashboard', dashboardId: sc.dashboardId };
	else if (sc?.kind === 'global') scope = { kind: 'global' };
	if (!scope) return null;
	const now = Date.now();
	return {
		record: {
			v: RECORD_VERSIONS.layout,
			id: raw.id as string,
			scope,
			name: str(raw.name),
			columns: 12,
			blocks: hydrateBlocks(raw.blocks),
			createdAt: num(raw.createdAt, now),
			updatedAt: num(raw.updatedAt, now),
			rev: num(raw.rev, 0),
		},
		upgraded,
	};
}

// ── Saved database views (M8) ──────────────────────────────────────────────────

const VIEW_STEPS: Step[] = [];

/**
 * A saved view, validated without losing anything a newer Worldsmith wrote: malformed filter /
 * sort / column rows are dropped (never the whole view), unknown keys are kept at every level,
 * and a layout or filter this version doesn't know is kept verbatim (drawn as cards / reported
 * as a filter it can't use) so saving here never rewrites it.
 */
export function hydrateView(input: unknown): { record: DatabaseView; upgraded: boolean } | null {
	if (!isObj(input) || typeof input.id !== 'string' || !input.id || typeof input.typeId !== 'string' || !input.typeId) return null;
	const fromV = typeof input.v === 'number' && Number.isFinite(input.v) ? input.v : 1;
	const { raw, upgraded } = runSteps({ ...input }, VIEW_STEPS, RECORD_VERSIONS.view);
	const now = Date.now();
	const card = isObj(raw.card) ? raw.card : {};
	const board = isObj(raw.board) ? raw.board : {};
	const conditions = (Array.isArray(raw.conditions) ? raw.conditions : [])
		.filter((c): c is Raw => isObj(c) && typeof c.field === 'string' && !!c.field)
		.map((c, i) => {
			const id = typeof c.id === 'string' && c.id ? c.id : `c${i}`;
			const op = typeof c.op === 'string' && c.op ? c.op : 'is';
			// A number is read as text; anything else (a newer version's shape) is kept as it was.
			const value = typeof c.value === 'string' ? c.value : typeof c.value === 'number' ? String(c.value) : c.value === undefined || c.value === null ? '' : c.value;
			return { ...c, id, field: c.field as string, op, value } as ViewCondition;
		});
	const sorts = (Array.isArray(raw.sorts) ? raw.sorts : [])
		.filter((x): x is Raw => isObj(x) && typeof x.field === 'string' && !!x.field)
		.map((x) => ({ ...x, field: x.field as string, dir: x.dir === 'desc' ? ('desc' as const) : ('asc' as const) }));
	const seenCols = new Set<string>();
	const columns = Array.isArray(raw.columns)
		? raw.columns
				.filter((c): c is Raw => isObj(c) && typeof c.id === 'string' && !!c.id && !seenCols.has(c.id) && (seenCols.add(c.id), true))
				.map((c) => {
					const { width, ...rest } = c;
					return { ...rest, id: c.id as string, ...(typeof width === 'number' && width >= 60 && width <= 900 ? { width: Math.round(width) } : {}) };
				})
		: null;
	return {
		record: {
			...(raw as object),
			v: Math.max(RECORD_VERSIONS.view, fromV),
			id: raw.id as string,
			typeId: raw.typeId as string,
			name: str(raw.name, 'View'),
			icon: typeof raw.icon === 'string' && raw.icon ? raw.icon : null,
			kind: (typeof raw.kind === 'string' && raw.kind ? raw.kind : 'cards') as DatabaseView['kind'],
			match: raw.match === 'any' ? 'any' : 'all',
			conditions,
			sorts,
			groupBy: typeof raw.groupBy === 'string' && raw.groupBy ? raw.groupBy : null,
			collapsed: strArr(raw.collapsed),
			columns,
			card: {
				...card,
				fields: Array.isArray(card.fields) ? strArr(card.fields) : null,
				image: card.image === 'banner' || card.image === 'none' ? card.image : 'portrait',
				size: card.size === 's' || card.size === 'l' ? card.size : 'm',
			},
			board: { ...board, field: typeof board.field === 'string' && board.field ? board.field : '__status' },
			showArchived: raw.showArchived === true,
			order: num(raw.order, 0),
			createdAt: num(raw.createdAt, now),
			updatedAt: num(raw.updatedAt, now),
			rev: num(raw.rev, 0),
		},
		upgraded,
	};
}

// ── Layout presets (0.10) ──────────────────────────────────────────────────────

export function hydrateLayoutPreset(input: unknown): { record: LayoutPresetDoc; upgraded: boolean } | null {
	if (!isObj(input) || typeof input.id !== 'string' || !input.id) return null;
	const fromV = typeof input.v === 'number' && Number.isFinite(input.v) ? input.v : 1;
	const { raw, upgraded } = runSteps({ ...input }, [], RECORD_VERSIONS.preset);
	const now = Date.now();
	return {
		record: {
			...(raw as object),
			v: Math.max(RECORD_VERSIONS.preset, fromV),
			id: raw.id as string,
			name: str(raw.name).trim() || 'My layout',
			icon: str(raw.icon) || 'layout-template',
			description: str(raw.description),
			blocks: hydrateBlocks(raw.blocks),
			fromType: typeof raw.fromType === 'string' && raw.fromType ? raw.fromType : null,
			createdAt: num(raw.createdAt, now),
			updatedAt: num(raw.updatedAt, now),
			rev: num(raw.rev, 0),
		},
		upgraded,
	};
}

// ── Calendars (0.10) ───────────────────────────────────────────────────────────

const intIn = (v: unknown, d: number, lo = -Infinity, hi = Infinity): number => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.trunc(v))) : d);

/** Rows with an id, unique ids, in order. */
function rows<T>(input: unknown, make: (r: Raw, i: number) => T | null): T[] {
	if (!Array.isArray(input)) return [];
	const seen = new Set<string>();
	const out: T[] = [];
	input.forEach((r, i) => {
		if (!isObj(r)) return;
		let id = typeof r.id === 'string' && r.id ? r.id : `r${i}`;
		while (seen.has(id)) id = `${id}-${i}`;
		seen.add(id);
		const v = make({ ...r, id }, i);
		if (v) out.push(v);
	});
	return out;
}

export function hydrateCalendar(input: unknown): { record: Calendar; upgraded: boolean } | null {
	if (!isObj(input) || typeof input.id !== 'string' || !input.id) return null;
	const fromV = typeof input.v === 'number' && Number.isFinite(input.v) ? input.v : 1;
	const { raw, upgraded } = runSteps({ ...input }, [], RECORD_VERSIONS.calendar);
	const now = Date.now();
	const months = rows<CalendarMonth>(raw.months, (r) => ({ ...(r as object), id: r.id as string, name: str(r.name).trim() || 'Month', short: str(r.short), days: intIn(r.days, 30, 1, 400) }));
	const weekdays = strArr(raw.weekdays).slice(0, 30);
	const record: Calendar = {
		...(raw as object),
		v: Math.max(RECORD_VERSIONS.calendar, fromV),
		id: raw.id as string,
		name: str(raw.name).trim() || 'Calendar',
		description: str(raw.description),
		months,
		weekdays,
		weekdayOffset: weekdays.length ? intIn(raw.weekdayOffset, 0, 0, weekdays.length - 1) : 0,
		festivals: rows<CalendarFestival>(raw.festivals, (r) => ({
			...(r as object),
			id: r.id as string,
			name: str(r.name).trim() || 'Festival',
			after: intIn(r.after, 0, 0, months.length),
			days: intIn(r.days, 1, 1, 60),
			every: intIn(r.every, 1, 1, 1000),
			...(typeof r.from === 'number' && Number.isFinite(r.from) ? { from: Math.trunc(r.from) } : {}),
		})),
		eras: rows<CalendarEra>(raw.eras, (r) => ({
			...(r as object),
			id: r.id as string,
			name: str(r.name).trim() || 'Era',
			abbr: str(r.abbr).trim(),
			start: intIn(r.start, 0),
			direction: r.direction === 'down' ? 'down' : 'up',
			firstYear: r.firstYear === 0 ? 0 : 1,
			color: typeof r.color === 'string' && r.color ? (r.color as never) : null,
		})),
		style: (['day-month-year', 'month-day-year', 'year-month-day', 'numeric', 'custom'] as const).includes(raw.style as never) ? (raw.style as Calendar['style']) : 'day-month-year',
		pattern: isObj(raw.pattern) ? { ...(raw.pattern as object), day: str(raw.pattern.day), month: str(raw.pattern.month), year: str(raw.pattern.year) } : null,
		showWeekday: raw.showWeekday === true,
		offset: intIn(raw.offset, 0),
		createdAt: num(raw.createdAt, now),
		updatedAt: num(raw.updatedAt, now),
		rev: num(raw.rev, 0),
	};
	return { record, upgraded };
}

// ── Trees, graphs and maps (0.11) ──────────────────────────────────────────────

const COLORS = ['red', 'orange', 'yellow', 'green', 'cyan', 'blue', 'purple', 'pink', 'gray'];
const color = (v: unknown): SemanticColor | null => (typeof v === 'string' && COLORS.includes(v) ? (v as SemanticColor) : null);
const oneOf = <T extends string>(v: unknown, list: readonly T[], d: T): T => (list.includes(v as T) ? (v as T) : d);
const flt = (v: unknown, d: number, lo: number, hi: number): number => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);
const strOrNull = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);
const BACKGROUNDS = ['plain', 'dots', 'grid', 'parchment'] as const;

function docBase(raw: Raw, version: number, fromV: number, name: string, icon: string, now: number) {
	return {
		v: Math.max(version, fromV),
		id: raw.id as string,
		name: str(raw.name).trim() || name,
		description: str(raw.description),
		icon: str(raw.icon) || icon,
		createdAt: num(raw.createdAt, now),
		updatedAt: num(raw.updatedAt, now),
		rev: num(raw.rev, 0),
	};
}

const versionOf = (input: Raw) => (typeof input.v === 'number' && Number.isFinite(input.v) ? input.v : 1);

export function hydrateTree(input: unknown): { record: TreeDoc; upgraded: boolean } | null {
	if (!isObj(input) || typeof input.id !== 'string' || !input.id) return null;
	const { raw, upgraded } = runSteps({ ...input }, [], RECORD_VERSIONS.tree);
	const now = Date.now();
	const kind = oneOf(raw.kind, ['family', 'hierarchy'] as const, 'family');
	const show = isObj(raw.show) ? raw.show : {};
	const bool = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d);
	const record: TreeDoc = {
		...(raw as object),
		...docBase(raw, RECORD_VERSIONS.tree, versionOf(input), kind === 'family' ? 'Family tree' : 'Hierarchy', kind === 'family' ? 'network' : 'list-tree', now),
		kind,
		rootId: strOrNull(raw.rootId),
		typeId: strOrNull(raw.typeId),
		up: intIn(raw.up, kind === 'family' ? 2 : 0, 0, 8),
		down: intIn(raw.down, kind === 'family' ? 2 : 6, 0, 12),
		direction: oneOf(raw.direction, ['down', 'up', 'right'] as const, 'down'),
		card: oneOf(raw.card, ['portrait', 'compact', 'name'] as const, kind === 'family' ? 'portrait' : 'compact'),
		colorBy: oneOf(raw.colorBy, ['type', 'status', 'generation', 'none'] as const, kind === 'family' ? 'generation' : 'type'),
		lines: oneOf(raw.lines, ['curved', 'square', 'straight'] as const, 'curved'),
		background: oneOf(raw.background, BACKGROUNDS, 'dots'),
		show: {
			...(show as object),
			photos: bool(show.photos, true),
			dates: bool(show.dates, true),
			type: bool(show.type, kind === 'hierarchy'),
			partners: bool(show.partners, true),
			siblings: bool(show.siblings, true),
			status: bool(show.status, false),
		},
		parentKinds: Array.isArray(raw.parentKinds) ? strArr(raw.parentKinds) : ['parent-of'],
		partnerKinds: Array.isArray(raw.partnerKinds) ? strArr(raw.partnerKinds) : ['marriage', 'romance'],
		collapsed: strArr(raw.collapsed),
	};
	return { record, upgraded };
}

export function hydrateGraph(input: unknown): { record: GraphDoc; upgraded: boolean } | null {
	if (!isObj(input) || typeof input.id !== 'string' || !input.id) return null;
	const { raw, upgraded } = runSteps({ ...input }, [], RECORD_VERSIONS.graph);
	const now = Date.now();
	const pinned: Record<string, [number, number]> = {};
	if (isObj(raw.pinned)) {
		for (const [k, v] of Object.entries(raw.pinned)) {
			if (Array.isArray(v) && v.length === 2 && v.every((n) => typeof n === 'number' && Number.isFinite(n))) pinned[k] = [v[0] as number, v[1] as number];
		}
	}
	const record: GraphDoc = {
		...(raw as object),
		...docBase(raw, RECORD_VERSIONS.graph, versionOf(input), 'Connections', 'share-2', now),
		types: strArr(raw.types),
		kinds: strArr(raw.kinds),
		tags: strArr(raw.tags),
		focusId: strOrNull(raw.focusId),
		depth: intIn(raw.depth, 2, 1, 4),
		hideIsolated: raw.hideIsolated !== false,
		showSecret: raw.showSecret !== false,
		showParents: raw.showParents === true,
		labels: oneOf(raw.labels, ['always', 'hover', 'never'] as const, 'always'),
		edgeLabels: raw.edgeLabels === true,
		colorBy: oneOf(raw.colorBy, ['type', 'status', 'none'] as const, 'type'),
		sizeByLinks: raw.sizeByLinks !== false,
		photos: raw.photos !== false,
		spacing: flt(raw.spacing, 1, 0.5, 2),
		background: oneOf(raw.background, BACKGROUNDS, 'dots'),
		pinned,
		pinOnDrag: raw.pinOnDrag === true,
	};
	return { record, upgraded };
}

const point = (v: unknown): [number, number] | null => (Array.isArray(v) && v.length >= 2 && typeof v[0] === 'number' && typeof v[1] === 'number' && Number.isFinite(v[0]) && Number.isFinite(v[1]) ? [Math.min(1, Math.max(0, v[0])), Math.min(1, Math.max(0, v[1]))] : null);
const points = (v: unknown): Array<[number, number]> => (Array.isArray(v) ? v.map(point).filter((p): p is [number, number] => !!p) : []);
const LINE_STYLES = ['solid', 'dashed', 'dotted'] as const;
const PIN_SIZES = ['s', 'm', 'l'] as const;

function mapItem(r: Raw) {
	return {
		...(r as object),
		id: r.id as string,
		entityId: strOrNull(r.entityId),
		label: str(r.label),
		note: str(r.note),
		layerId: strOrNull(r.layerId),
		color: color(r.color),
	};
}

export function hydrateMap(input: unknown): { record: MapDoc; upgraded: boolean } | null {
	if (!isObj(input) || typeof input.id !== 'string' || !input.id) return null;
	const { raw, upgraded } = runSteps({ ...input }, [], RECORD_VERSIONS.map);
	const now = Date.now();
	const grid = isObj(raw.grid) ? raw.grid : {};
	const scale = isObj(raw.scale) && typeof raw.scale.width === 'number' && raw.scale.width > 0 ? { ...(raw.scale as object), width: flt(raw.scale.width, 100, 0.001, 1e9), unit: str(raw.scale.unit).trim() || 'miles' } : null;
	// Anything we can't read is kept beside the record (never silently dropped on the next save).
	const asFound = (v: unknown, read: number) => (Array.isArray(v) && v.length !== read ? { pointsAsFound: v } : {});
	const record: MapDoc = {
		...(raw as object),
		...(raw.scale != null && !scale ? { scaleAsFound: raw.scale } : {}),
		...docBase(raw, RECORD_VERSIONS.map, versionOf(input), 'Map', 'map', now),
		image: normalizeRef(raw.image) ?? null,
		aspect: flt(raw.aspect, 1.5, 0.1, 10),
		backdrop: oneOf(raw.backdrop, ['parchment', 'plain', 'night', 'sea'] as const, 'parchment'),
		entityId: strOrNull(raw.entityId),
		pins: rows<MapPin>(raw.pins, (r) => {
			// A pin whose position can't be read goes to the middle rather than being lost.
			const p = point([r.x, r.y]) ?? [0.5, 0.5];
			return { ...mapItem(r), x: p[0], y: p[1], icon: strOrNull(r.icon), size: PIN_SIZES.includes(r.size as never) ? (r.size as MapPin['size']) : null, mapId: strOrNull(r.mapId) };
		}),
		regions: rows<MapRegion>(raw.regions, (r) => {
			// Too few corners to draw are kept anyway (the map just doesn't draw them).
			const pts = points(r.points);
			return { ...mapItem(r), ...asFound(r.points, pts.length), points: pts, opacity: flt(r.opacity, 0.25, 0, 1), style: oneOf(r.style, LINE_STYLES, 'solid') };
		}),
		paths: rows<MapPath>(raw.paths, (r) => {
			const pts = points(r.points);
			return { ...mapItem(r), ...asFound(r.points, pts.length), points: pts, style: oneOf(r.style, LINE_STYLES, 'dashed'), width: flt(r.width, 3, 1, 12), arrow: r.arrow === true };
		}),
		layers: rows<MapLayer>(raw.layers, (r) => ({ ...(r as object), id: r.id as string, name: str(r.name).trim() || 'Layer', visible: r.visible !== false, color: color(r.color) })),
		scale,
		grid: { ...(grid as object), show: grid.show === true, kind: oneOf(grid.kind, ['square', 'hex'] as const, 'square'), cells: intIn(grid.cells, 20, 2, 200), opacity: flt(grid.opacity, 0.25, 0.05, 1) },
		labels: oneOf(raw.labels, ['always', 'hover', 'zoom'] as const, 'always'),
		pinSize: oneOf(raw.pinSize, PIN_SIZES, 'm'),
		compass: raw.compass === true,
	};
	return { record, upgraded };
}

// ── Writing Studio (WS2) ───────────────────────────────────────────────────────

const PROJECT_KIND_LIST: readonly ProjectKind[] = ['novel', 'novella', 'short-story', 'anthology', 'script'];
const MANUSCRIPT_KINDS: readonly ManuscriptKind[] = ['part', 'chapter', 'scene'];
/** "HH:MM" (24 h); anything else reads as no time. */
const timeOrNull = (v: unknown): string | null => {
	const m = typeof v === 'string' ? /^(\d{1,2}):(\d{2})$/.exec(v.trim()) : null;
	if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) return null;
	return `${m[1]!.padStart(2, '0')}:${m[2]}`;
};
const positiveOrNull = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.round(v) : null);

const status = (r: Raw): SceneStatus => ({ ...(r as object), id: r.id as string, label: str(r.label).trim() || (r.id as string), color: color(r.color) ?? 'gray', done: r.done === true });
const thread = (r: Raw): PlotThread => ({ ...(r as object), id: r.id as string, label: str(r.label).trim() || 'Thread', color: color(r.color), description: str(r.description) });
const percentOrNull = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? Math.min(100, Math.max(0, v)) : null);
const beat = (r: Raw): StoryBeat => ({
	...(r as object),
	id: r.id as string,
	label: str(r.label).trim() || 'Beat',
	description: str(r.description),
	group: str(r.group),
	position: percentOrNull(r.position),
	sceneIds: [...new Set(strArr(r.sceneIds).filter(Boolean))],
	source: str(r.source) || 'custom',
});
const templateNodes = (v: unknown, depth = 0): WritingTemplateNode[] =>
	!Array.isArray(v) || depth > 3
		? []
		: v.flatMap((n): WritingTemplateNode[] => {
				if (!isObj(n) || !MANUSCRIPT_KINDS.includes(n.kind as ManuscriptKind)) return [];
				const kids = templateNodes(n.children, depth + 1);
				return [{ ...(n as object), kind: n.kind as ManuscriptKind, title: str(n.title).trim() || 'Untitled', synopsis: str(n.synopsis), ...(kids.length ? { children: kids } : { children: undefined }) }];
			});

export function hydrateWritingTemplate(input: unknown): { record: WritingTemplate; upgraded: boolean } | null {
	if (!isObj(input) || typeof input.id !== 'string' || !input.id) return null;
	const fromV = versionOf(input);
	const { raw, upgraded } = runSteps({ ...input }, [], RECORD_VERSIONS.writingTemplate);
	const now = Date.now();
	const record: WritingTemplate = {
		...(raw as object),
		v: Math.max(RECORD_VERSIONS.writingTemplate, fromV),
		id: raw.id as string,
		name: str(raw.name).trim() || 'Untitled template',
		description: str(raw.description),
		outline: templateNodes(raw.outline),
		// Unknown keys on a template's beats are kept too (the row id `rows` adds is not).
		beats: rows<WritingTemplate['beats'][number]>(raw.beats, ({ id: _id, ...r }) => ({ ...(r as object), label: str(r.label).trim() || 'Beat', description: str(r.description), group: str(r.group), position: percentOrNull(r.position) })),
		defaultStatus: typeof raw.defaultStatus === 'string' && raw.defaultStatus ? raw.defaultStatus : null,
		statuses: rows<SceneStatus>(raw.statuses, status),
		threads: rows<PlotThread>(raw.threads, thread),
		trashedAt: nullableNum(raw.trashedAt),
		createdAt: num(raw.createdAt, now),
		updatedAt: num(raw.updatedAt, now),
		rev: num(raw.rev, 0),
	};
	return { record, upgraded };
}

function cleanDays(v: Record<string, unknown>): Record<string, number> {
	const out: Record<string, number> = {};
	for (const [k, n] of Object.entries(v)) if (/^\d{4}-\d{2}-\d{2}$/.test(k) && typeof n === 'number' && Number.isFinite(n) && n !== 0) out[k] = Math.round(n);
	return out;
}

function cleanSprints(v: unknown[]): Array<{ start: number; minutes: number; words: number }> {
	return v
		.filter((x): x is Record<string, unknown> => isObj(x))
		.map((x) => ({ start: num(x.start, 0), minutes: Math.max(0, Math.round(num(x.minutes, 0))), words: Math.round(num(x.words, 0)) }))
		.filter((x) => x.start > 0 && x.minutes > 0)
		.slice(-100);
}

function cleanPasses(v: unknown[]): Array<{ id: string; name: string; createdAt: number; done: string[] }> {
	const seen = new Set<string>();
	const out: Array<{ id: string; name: string; createdAt: number; done: string[] }> = [];
	for (const x of v) {
		if (!isObj(x)) continue;
		const id = str(x.id);
		const name = str(x.name).trim();
		if (!id || !name || seen.has(id)) continue;
		seen.add(id);
		const done = Array.isArray(x.done) ? [...new Set(x.done.filter((d): d is string => typeof d === 'string' && !!d))] : [];
		const checklist = Array.isArray(x.checklist)
			? x.checklist
					.filter((c): c is Record<string, unknown> => isObj(c) && typeof c.id === 'string' && typeof c.text === 'string')
					.map((c) => ({ id: String(c.id), text: String(c.text), done: c.done === true }))
					.slice(0, 200)
			: undefined;
		out.push({ id, name, createdAt: num(x.createdAt, 0), done, ...(checklist ? { checklist } : {}) });
	}
	return out.slice(0, 50);
}

function cleanArcs(v: Record<string, unknown>): Record<string, CharacterArcRecord> {
	const out: Record<string, CharacterArcRecord> = {};
	const TEXT = ['wants', 'needs', 'flaw', 'internal', 'external', 'arc'] as const;
	for (const [id, a] of Object.entries(v)) {
		if (!id || id === '__proto__' || !isObj(a)) continue;
		const rec: CharacterArcRecord = { start: str(a.start), end: str(a.end) };
		for (const k of TEXT) if (typeof a[k] === 'string' && a[k]) rec[k] = a[k];
		if (isObj(a.points)) {
			const pts: Record<string, number> = {};
			for (const [s, n] of Object.entries(a.points)) if (s !== '__proto__' && typeof n === 'number' && Number.isFinite(n)) pts[s] = Math.max(-1, Math.min(1, n));
			if (Object.keys(pts).length) rec.points = pts;
		}
		if (isObj(a.turning)) {
			const tp: Record<string, string> = {};
			for (const [s, t] of Object.entries(a.turning)) if (s !== '__proto__' && typeof t === 'string' && t.trim()) tp[s] = t.slice(0, 200);
			if (Object.keys(tp).length) rec.turning = tp;
		}
		if (rec.start || rec.end || TEXT.some((k) => rec[k]) || rec.points || rec.turning) out[id] = rec;
	}
	return out;
}

interface CharacterArcRecord {
	start: string;
	end: string;
	wants?: string;
	needs?: string;
	flaw?: string;
	internal?: string;
	external?: string;
	arc?: string;
	points?: Record<string, number>;
	turning?: Record<string, string>;
}

export function hydrateWritingProject(input: unknown): { record: WritingProject; upgraded: boolean } | null {
	if (!isObj(input) || typeof input.id !== 'string' || !input.id) return null;
	const fromV = versionOf(input);
	const { raw, upgraded } = runSteps({ ...input }, [], RECORD_VERSIONS.writingProject);
	const now = Date.now();
	let statuses = rows<SceneStatus>(raw.statuses, status);
	// A project always has statuses to choose from.
	if (!statuses.length) statuses = DEFAULT_SCENE_STATUSES.map((x) => ({ ...x }));
	const defaultStatus = typeof raw.defaultStatus === 'string' && statuses.some((x) => x.id === raw.defaultStatus) ? raw.defaultStatus : statuses[0]!.id;
	const record: WritingProject = {
		// Keys a newer version added are kept.
		...(raw as object),
		v: Math.max(RECORD_VERSIONS.writingProject, fromV),
		id: raw.id as string,
		name: str(raw.name).trim() || 'Untitled project',
		kind: oneOf(raw.kind, PROJECT_KIND_LIST, 'novel'),
		folder: str(raw.folder).replace(/^\/+|\/+$/g, ''),
		description: str(raw.description),
		statuses,
		defaultStatus,
		threads: rows<PlotThread>(raw.threads, thread),
		// WS4 (older records have none of these).
		retiredStatuses: rows<SceneStatus>(raw.retiredStatuses, status).filter((x) => !statuses.some((y) => y.id === x.id)),
		retiredThreads: rows<PlotThread>(raw.retiredThreads, thread),
		beats: rows<StoryBeat>(raw.beats, beat),
		structure: strOrNull(raw.structure),
		// WS5 (0.23): character arcs; only text, only for ids, never empty ones.
		...(isObj(raw.arcs) ? { arcs: cleanArcs(raw.arcs) } : {}),
		// WS6 (0.24): progress (absent on older records).
		...('dailyGoal' in raw ? { dailyGoal: positiveOrNull(raw.dailyGoal) } : {}),
		...('deadline' in raw ? { deadline: typeof raw.deadline === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.deadline) ? raw.deadline : null } : {}),
		...(isObj(raw.days) ? { days: cleanDays(raw.days) } : {}),
		...(Array.isArray(raw.sprints) ? { sprints: cleanSprints(raw.sprints) } : {}),
		...(Array.isArray(raw.passes) ? { passes: cleanPasses(raw.passes) } : {}),
		...(Array.isArray(raw.marks)
			? {
					marks: raw.marks
						.filter((x): x is Record<string, unknown> => isObj(x) && typeof x.id === 'string' && typeof x.sceneId === 'string')
						.map((x) => ({ id: String(x.id), sceneId: String(x.sceneId), quote: str(x.quote).slice(0, 2000), note: str(x.note).slice(0, 2000), createdAt: num(x.createdAt, 0) }))
						.slice(-500),
				}
			: {}),
		...(Array.isArray(raw.research)
			? {
					research: raw.research
						.filter((x): x is Record<string, unknown> => isObj(x) && typeof x.id === 'string' && ['note', 'image', 'link', 'source', 'entry', 'board'].includes(String(x.kind)))
						.map((x) => ({
							id: String(x.id),
							kind: String(x.kind) as 'note',
							title: str(x.title).slice(0, 300),
							...(typeof x.path === 'string' ? { path: x.path } : {}),
							...(typeof x.url === 'string' ? { url: x.url.slice(0, 2000) } : {}),
							...(typeof x.citation === 'string' ? { citation: x.citation.slice(0, 300) } : {}),
							...(typeof x.entityId === 'string' ? { entityId: x.entityId } : {}),
							...(Array.isArray(x.images) ? { images: x.images.filter((i): i is string => typeof i === 'string').slice(0, 60) } : {}),
							scenes: Array.isArray(x.scenes) ? [...new Set(x.scenes.filter((i): i is string => typeof i === 'string'))] : [],
							createdAt: num(x.createdAt, 0),
						}))
						.slice(0, 1000),
				}
			: {}),
		...('weeklyGoal' in raw ? { weeklyGoal: positiveOrNull(raw.weeklyGoal) } : {}),
		...('monthlyGoal' in raw ? { monthlyGoal: positiveOrNull(raw.monthlyGoal) } : {}),
		...(Array.isArray(raw.sessions)
			? {
					sessions: raw.sessions
						.filter((x): x is Record<string, unknown> => isObj(x))
						.map((x) => ({ start: num(x.start, 0), end: num(x.end, 0), words: Math.round(num(x.words, 0)), sceneId: typeof x.sceneId === 'string' ? x.sceneId : null }))
						.filter((x) => x.start > 0 && x.end >= x.start)
						.slice(-200),
				}
			: {}),
		...(typeof raw.author === 'string' ? { author: raw.author } : {}),
		...(typeof raw.genre === 'string' ? { genre: raw.genre } : {}),
		...(typeof raw.series === 'string' ? { series: raw.series } : {}),
		...(typeof raw.tagline === 'string' ? { tagline: raw.tagline } : {}),
		...(isObj(raw.compile) ? { compile: Object.fromEntries(Object.entries(raw.compile).filter(([k, v]) => k !== '__proto__' && (typeof v === 'string' || typeof v === 'boolean'))) as Record<string, string | boolean> } : {}),
		wordTarget: positiveOrNull(raw.wordTarget),
		archivedAt: nullableNum(raw.archivedAt),
		order: num(raw.order, 0),
		createdAt: num(raw.createdAt, now),
		updatedAt: num(raw.updatedAt, now),
		rev: num(raw.rev, 0),
	};
	return { record, upgraded };
}

export function hydrateManuscriptItem(input: unknown): { record: ManuscriptItem; upgraded: boolean } | null {
	if (!isObj(input) || typeof input.id !== 'string' || !input.id || typeof input.projectId !== 'string' || !input.projectId) return null;
	if (!MANUSCRIPT_KINDS.includes(input.kind as ManuscriptKind)) return null;
	const fromV = versionOf(input);
	const { raw, upgraded } = runSteps({ ...input }, [], RECORD_VERSIONS.manuscriptItem);
	const now = Date.now();
	const kind = raw.kind as ManuscriptKind;
	const record: ManuscriptItem = {
		...(raw as object),
		v: Math.max(RECORD_VERSIONS.manuscriptItem, fromV),
		id: raw.id as string,
		projectId: raw.projectId as string,
		kind,
		parentId: strOrNull(raw.parentId),
		order: num(raw.order, 0),
		title: str(raw.title).trim() || (kind === 'scene' ? 'Untitled scene' : kind === 'chapter' ? 'Untitled chapter' : 'Untitled part'),
		synopsis: str(raw.synopsis),
		color: color(raw.color),
		collapsed: raw.collapsed === true,
		notePath: kind === 'scene' ? strOrNull(raw.notePath) : null,
		status: str(raw.status),
		pov: strOrNull(raw.pov),
		cast: [...new Set(strArr(raw.cast).filter(Boolean))],
		location: strOrNull(raw.location),
		date: chronoOrNull(raw.date),
		time: timeOrNull(raw.time),
		threads: [...new Set(strArr(raw.threads).filter(Boolean))],
		wordTarget: positiveOrNull(raw.wordTarget),
		purpose: str(raw.purpose),
		notes: str(raw.notes),
		trashedAt: nullableNum(raw.trashedAt),
		createdAt: num(raw.createdAt, now),
		updatedAt: num(raw.updatedAt, now),
		rev: num(raw.rev, 0),
	};
	return { record, upgraded };
}

// ── Native note templates (0.17) ───────────────────────────────────────────────

export function hydrateNoteTemplate(input: unknown): { record: NoteTemplate; upgraded: boolean } | null {
	if (!isObj(input) || typeof input.id !== 'string' || !input.id) return null;
	const fromV = typeof input.v === 'number' && Number.isFinite(input.v) ? input.v : 1;
	const { raw, upgraded } = runSteps({ ...input }, [], RECORD_VERSIONS.noteTemplate);
	const now = Date.now();
	return {
		record: {
			...(raw as object),
			v: Math.max(RECORD_VERSIONS.noteTemplate, fromV),
			id: raw.id as string,
			name: str(raw.name).trim() || 'My note template',
			icon: str(raw.icon) || 'file-text',
			description: str(raw.description),
			builtIn: false,
			sections: normalizeSections(raw.sections),
			appearance: normalizeAppearance(raw.appearance),
			createdAt: num(raw.createdAt, now),
			updatedAt: num(raw.updatedAt, now),
			rev: num(raw.rev, 0),
		},
		upgraded,
	};
}
