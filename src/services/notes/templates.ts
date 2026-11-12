import type { EntitySchema, LayoutDoc, BlockInstance, NoteAppearance, NoteSection, NoteTemplate } from '../../core/types';

/**
 * Native note templates (0.17), pure. The six built-ins are virtual and read-only (people
 * customise a copy). Every template adapts to any type: sections that name no fields pick
 * them from the type, so a custom type gets a sensible note without setup.
 */

export const NOTE_TEMPLATE_VERSION = 1;

export const DEFAULT_APPEARANCE: NoteAppearance = {
	style: 'dossier',
	accent: 'bronze',
	titleFont: 'codex',
	portrait: 'right',
	density: 'detailed',
	headings: 'ornament',
	hideProperties: true,
};

const s = (id: string, kind: NoteSection['kind'], extra: Partial<NoteSection> = {}): NoteSection => ({ id, kind, ...extra });

const DOSSIER: NoteSection[] = [
	s('banner', 'banner'),
	s('title', 'title'),
	s('infocard', 'infocard'),
	s('summary', 'summary'),
	s('body', 'schemaSections'),
	s('connections', 'connections', { title: 'Connections' }),
	s('footer', 'footer'),
];

function builtIn(id: string, name: string, icon: string, description: string, sections: NoteSection[], appearance: Partial<NoteAppearance>): NoteTemplate {
	return { v: NOTE_TEMPLATE_VERSION, id, name, icon, description, builtIn: true, sections, appearance: { ...DEFAULT_APPEARANCE, ...appearance }, createdAt: 0, updatedAt: 0, rev: 0 };
}

export const BUILTIN_NOTE_TEMPLATES: NoteTemplate[] = [
	builtIn('character-dossier', 'Character Dossier', 'user-round', 'A portrait card beside the name, the facts at a glance, the long writing and every connection.', DOSSIER, {}),
	builtIn(
		'location-atlas',
		'Location Atlas',
		'map',
		'A wide banner, the place’s card with its map, then geography, history and who is here.',
		[s('banner', 'banner'), s('title', 'title'), s('infocard', 'infocard'), s('summary', 'summary'), s('body', 'schemaSections'), s('connections', 'connections', { title: 'Who and what is here' }), s('children', 'children', { title: 'Places within' }), s('footer', 'footer')],
		{ style: 'atlas', accent: 'verdigris' },
	),
	builtIn(
		'historical-chronicle',
		'Historical Chronicle',
		'scroll-text',
		'A centred title and epigraph, a short “at a glance” panel, then the account.',
		[s('banner', 'banner'), s('title', 'title'), s('summary', 'summary'), s('facts', 'facts', { title: 'At a glance' }), s('body', 'schemaSections'), s('connections', 'connections', { title: 'Participants and places' }), s('footer', 'footer')],
		{ style: 'chronicle', portrait: 'none' },
	),
	builtIn(
		'creature-bestiary',
		'Creature Bestiary',
		'paw-print',
		'A field-guide page: the creature’s card, its nature and habits, and what it is known to.',
		[s('banner', 'banner'), s('title', 'title'), s('infocard', 'infocard'), s('summary', 'summary'), s('body', 'schemaSections'), s('connections', 'connections', { title: 'Lore and related' }), s('footer', 'footer')],
		{ style: 'fieldguide', accent: 'crimson' },
	),
	builtIn(
		'faction-dossier',
		'Faction Dossier',
		'shield',
		'The sigil card, leadership and members, goals, alliances and rivalries.',
		[s('banner', 'banner'), s('title', 'title'), s('infocard', 'infocard'), s('summary', 'summary'), s('connections', 'connections', { title: 'Leadership, members and rivals' }), s('body', 'schemaSections'), s('children', 'children', { title: 'Within this' }), s('footer', 'footer')],
		{ accent: 'crimson' },
	),
	builtIn(
		'custom-entity',
		'Custom Entity',
		'shapes',
		'Adapts to any type: one fact group per section of the type, long text as sections, then connections.',
		[s('banner', 'banner'), s('title', 'title'), s('infocard', 'infocard'), s('summary', 'summary'), s('body', 'schemaSections'), s('connections', 'connections', { title: 'Connections' }), s('children', 'children', { title: 'Within this' }), s('footer', 'footer')],
		{},
	),
];

const BY_TYPE: Array<[RegExp, string]> = [
	[/^(character|person|people|npc|hero|villain)/i, 'character-dossier'],
	[/^(location|place|city|region|realm|planet|landmark|settlement)/i, 'location-atlas'],
	[/^(event|era|age|battle|war|history)/i, 'historical-chronicle'],
	[/^(creature|species|monster|beast|race|animal)/i, 'creature-bestiary'],
	[/^(faction|nation|religion|culture|organi[sz]ation|guild|house|order|kingdom|empire)/i, 'faction-dossier'],
];

/** The built-in that fits a type: by its id, then by its name; Custom Entity otherwise. */
export function defaultTemplateFor(schema: Pick<EntitySchema, 'id' | 'singular'> & { origin?: EntitySchema['origin'] }): string {
	const keys = [schema.origin?.templateId, schema.id, schema.singular].filter((x): x is string => !!x);
	for (const k of keys) for (const [re, id] of BY_TYPE) if (re.test(k)) return id;
	return 'custom-entity';
}

export function builtInTemplate(id: string): NoteTemplate | undefined {
	return BUILTIN_NOTE_TEMPLATES.find((t) => t.id === id);
}

/** Section ids are region ids in notes: letters, digits, dash and underscore. */
export function sectionId(base: string, taken: Set<string>): string {
	const clean = base.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'section';
	let id = clean;
	for (let n = 2; taken.has(id) || RESERVED_REGION_IDS.has(id); n++) id = `${clean}-${n}`;
	return id;
}

/** Region ids Worldsmith uses for itself. */
export const RESERVED_REGION_IDS = new Set(['ws-summary']);

/** A clean copy of a template's sections (unique ids, known kinds). */
export function normalizeSections(sections: unknown): NoteSection[] {
	if (!Array.isArray(sections)) return [];
	const kinds = new Set(['banner', 'infocard', 'title', 'summary', 'facts', 'schemaSections', 'field', 'connections', 'children', 'gallery', 'separator', 'heading', 'footer']);
	const taken = new Set<string>();
	const out: NoteSection[] = [];
	for (const raw of sections) {
		if (!raw || typeof raw !== 'object') continue;
		const r = raw as Record<string, unknown>;
		if (typeof r.kind !== 'string' || !kinds.has(r.kind)) continue;
		const id = sectionId(typeof r.id === 'string' ? r.id : r.kind, taken);
		taken.add(id);
		const sec: NoteSection = { id, kind: r.kind as NoteSection['kind'] };
		if (typeof r.title === 'string') sec.title = r.title;
		if (Array.isArray(r.fields)) sec.fields = r.fields.filter((f): f is string => typeof f === 'string');
		if (r.fold === 'open' || r.fold === 'closed' || r.fold === 'none') sec.fold = r.fold;
		if (r.hidden === true) sec.hidden = true;
		if (r.table === true) sec.table = true;
		out.push(sec);
	}
	return out;
}

export function normalizeAppearance(raw: unknown): NoteAppearance {
	const a = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
	const pick = <T extends string>(v: unknown, opts: readonly T[], d: T): T => (opts.includes(v as T) ? (v as T) : d);
	return {
		style: pick(a.style, ['dossier', 'chronicle', 'fieldguide', 'atlas', 'plain'] as const, DEFAULT_APPEARANCE.style),
		accent: pick(a.accent, ['bronze', 'crimson', 'verdigris', 'violet', 'azure', 'theme'] as const, DEFAULT_APPEARANCE.accent),
		titleFont: pick(a.titleFont, ['codex', 'theme'] as const, DEFAULT_APPEARANCE.titleFont),
		portrait: pick(a.portrait, ['right', 'left', 'none'] as const, DEFAULT_APPEARANCE.portrait),
		density: pick(a.density, ['detailed', 'compact'] as const, DEFAULT_APPEARANCE.density),
		headings: pick(a.headings, ['ornament', 'rule', 'plain'] as const, DEFAULT_APPEARANCE.headings),
		hideProperties: a.hideProperties === undefined ? DEFAULT_APPEARANCE.hideProperties : a.hideProperties === true,
	};
}

/**
 * Whether two templates differ in what they write into notes (sections), as opposed to
 * how notes look (appearance, name, icon). Only structural changes touch notes.
 */
export function structuralChange(a: Pick<NoteTemplate, 'sections'>, b: Pick<NoteTemplate, 'sections'>): boolean {
	return JSON.stringify(a.sections) !== JSON.stringify(b.sections);
}

/**
 * "Start from my Worldsmith page": a first note template from a type's page layout.
 * Widgets map onto note sections; anything without a note equivalent is left out.
 */
export function sectionsFromLayout(layout: Pick<LayoutDoc, 'blocks'> | { blocks: BlockInstance[] } | null, schema: EntitySchema): NoteSection[] {
	const taken = new Set<string>();
	const out: NoteSection[] = [];
	const add = (kind: NoteSection['kind'], extra: Partial<NoteSection> = {}, idBase: string = kind) => {
		const id = sectionId(idBase, taken);
		taken.add(id);
		out.push({ id, kind, ...extra });
	};
	const blocks = [...(layout?.blocks ?? [])].sort((a, b) => (a.y ?? 0) - (b.y ?? 0) || (a.x ?? 0) - (b.x ?? 0));
	const has = (k: NoteSection['kind']) => out.some((x) => x.kind === k);
	add('banner');
	for (const b of blocks) {
		const cfg = (b.config ?? {});
		switch (b.type) {
			case 'hero':
				if (!has('infocard')) add('infocard');
				if (!has('title')) add('title');
				break;
			case 'quote':
			case 'description':
			case 'summary':
				if (!has('summary')) add('summary');
				break;
			case 'key-facts':
			case 'stat-block': {
				const fields = Array.isArray(cfg.fields) ? (cfg.fields as unknown[]).filter((f): f is string => typeof f === 'string' && schema.fields.some((x) => x.id === f)) : undefined;
				add('facts', { title: typeof cfg.title === 'string' && cfg.title ? cfg.title : 'At a glance', ...(fields?.length ? { fields } : {}) });
				break;
			}
			case 'properties': {
				const wanted = Array.isArray(cfg.sections) ? (cfg.sections as unknown[]).filter((x): x is string => typeof x === 'string') : [];
				const secs = wanted.map((id) => schema.sections.find((x) => x.id === id)).filter((x): x is NonNullable<typeof x> => !!x);
				if (secs.length) for (const sec of secs) add('facts', { title: sec.label, fields: sec.fieldIds }, sec.id);
				else if (!has('schemaSections')) add('schemaSections');
				break;
			}
			case 'sections':
				if (!has('schemaSections')) add('schemaSections');
				break;
			case 'single-field': {
				const f = typeof cfg.field === 'string' ? schema.fields.find((x) => x.id === cfg.field) : undefined;
				if (f && (f.type === 'longtext' || f.type === 'richtext')) add('field', { fields: [f.id], title: f.label }, f.id);
				else if (f) add('facts', { title: f.label, fields: [f.id] }, f.id);
				break;
			}
			case 'heading':
				add('heading', { title: typeof cfg.text === 'string' ? cfg.text : typeof cfg.title === 'string' ? cfg.title : 'Section' });
				break;
			case 'divider':
				add('separator');
				break;
			case 'gallery':
			case 'image-spotlight':
				if (!has('gallery')) add('gallery', { title: 'Gallery' });
				break;
			case 'roster':
			case 'connections':
			case 'links':
			case 'relationship-web':
			case 'connection-map':
				if (!has('connections')) add('connections', { title: 'Connections' });
				break;
			case 'children':
				if (!has('children')) add('children', { title: 'Within this' });
				break;
		}
	}
	if (!has('title')) out.splice(1, 0, { id: sectionId('title', taken), kind: 'title' });
	if (!out.some((x) => x.kind === 'schemaSections' || x.kind === 'field')) add('schemaSections');
	if (!has('connections')) add('connections', { title: 'Connections' });
	add('footer');
	return out;
}
