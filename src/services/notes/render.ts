import type { EntityRecord, EntitySchema, FieldDefinition, LinkedEntry, NoteSection, NoteTemplate, World } from '../../core/types';
import type { FieldTypeRegistry } from '../../fields/FieldTypeRegistry';
import { fieldContent, fieldText, quoteContent, unquote } from './format';
import { canon, fieldHome, listProp, longFields, normalizeProperty, statusLabel, tagToNote, toProperty } from './properties';
import type { PlanInput, PropSpec, RegionSpec } from './sync';
import { tplClass } from './appearanceCss';

/**
 * What a native note should contain for an entry (0.17), pure. Produces the specs the
 * reconciler compares with the note: front-matter keys, properties and regions in the
 * template's order. Everything written is ordinary Markdown (callouts, tables, wikilinks,
 * embeds), so the note reads well with Worldsmith switched off.
 */

export interface NoteConnection {
	/** Heading as seen from this entry ("Mentor", "Students"). */
	label: string;
	otherId: string;
	otherName: string;
	status: string | null;
	secret: boolean;
	since: string;
	note: string;
}

export interface RenderContext {
	world: World;
	schema: EntitySchema;
	template: NoteTemplate;
	/** The entry chose its own template (written as `worldsmith-template`). */
	templateOverride: boolean;
	fieldTypes: FieldTypeRegistry;
	/** Property key per short field. */
	keys: Map<string, string>;
	/** The value of any field (stored or derived). */
	value(entity: EntityRecord, field: FieldDefinition): unknown;
	/** Wikilink target of an entry's note (path without `.md`), or null when it has none. */
	linkTarget(entityId: string): string | null;
	connections(entity: EntityRecord): NoteConnection[];
	children(entity: EntityRecord): Array<{ id: string; name: string }>;
	/** Text of a number of scenes etc. for the footer (optional). */
	footerExtra?: string;
}

export const SUMMARY_REGION = 'ws-summary';
export const HEADER_NOTE = '— kept up to date by Worldsmith; write anywhere outside these markers';

/** Escape text for a Markdown table cell (pipes, line breaks). */
export function cell(text: string): string {
	return text.replace(/\r?\n+/g, ' ').replace(/\|/g, '\\|').trim();
}

/** A wikilink to the entry's note, or its name as plain text when it has no note. */
export function entryLink(ctx: RenderContext, id: string, name: string): string {
	const target = ctx.linkTarget(id);
	const label = name.replace(/[[\]|]/g, ' ').trim() || 'Untitled';
	if (!target) return label;
	return target === label ? `[[${label}]]` : `[[${target}|${label}]]`;
}

function embed(path: string, alt?: string): string {
	if (/^(https?:|app:|file:)/i.test(path)) return `![${alt ?? ''}](${path})`;
	return `![[${path}${alt ? '|' + alt : ''}]]`;
}

/** A field's value as Markdown text (links for linked entries). */
export function valueText(ctx: RenderContext, entity: EntityRecord, field: FieldDefinition): string {
	const v = ctx.value(entity, field);
	if (field.type === 'relation' || field.type === 'parent' || field.type === 'children') {
		const list = Array.isArray(v) ? (v as LinkedEntry[]) : [];
		return list.map((l) => entryLink(ctx, l.id, l.name)).join(', ');
	}
	if (ctx.fieldTypes.isEmpty(field, v)) return '';
	return ctx.fieldTypes.toText(field, v);
}

const SHOWN_IN_FACTS = (f: FieldDefinition) => !f.hidden && f.type !== 'image' && f.type !== 'file' && f.type !== 'gallery' && f.type !== 'formula' && fieldHome(f) !== 'section';

function factFields(ctx: RenderContext, entity: EntityRecord, sec: NoteSection, exclude: Set<string>, limit: number): FieldDefinition[] {
	const all = ctx.schema.fields;
	if (sec.fields?.length) return sec.fields.map((id) => all.find((f) => f.id === id)).filter((f): f is FieldDefinition => !!f && SHOWN_IN_FACTS(f));
	return all.filter((f) => SHOWN_IN_FACTS(f) && !exclude.has(f.id) && valueText(ctx, entity, f)).slice(0, limit);
}

function fold(sec: NoteSection): string {
	return sec.fold === 'open' ? '+' : sec.fold === 'closed' ? '-' : '';
}

function factsCallout(ctx: RenderContext, entity: EntityRecord, title: string, fields: FieldDefinition[], foldMark: string): string {
	const items = fields.map((f) => ({ f, t: valueText(ctx, entity, f) })).filter((x) => x.t);
	if (!items.length) return '';
	return [`> [!ws-facts]${foldMark} ${title}`, ...items.map(({ f, t }) => `> - **${f.label}**<br>${t.replace(/\r?\n+/g, ' ')}`)].join('\n');
}

/** The regions of the note, in order. */
export function regionSpecs(entity: EntityRecord, ctx: RenderContext): RegionSpec[] {
	const out: RegionSpec[] = [];
	const { schema } = ctx;
	const placedLong = new Set<string>();
	for (const sec of ctx.template.sections) if (sec.kind === 'field' && sec.fields?.[0]) placedLong.add(sec.fields[0]);
	// Fields already shown in a card or a facts panel aren't repeated further down.
	const infocardFields = new Set<string>();
	const linksShown = ctx.template.sections.some((x) => x.kind === 'connections' && !x.hidden);
	const isLink = (f: FieldDefinition) => f.type === 'relation' || f.type === 'children';
	const view = (sec: NoteSection | { id: string }, label: string, content: string, extra: Partial<RegionSpec> = {}) =>
		out.push({ id: sec.id, kind: 'view', label, ws: content, build: (t) => t, read: (c) => c, ...extra });
	const field = (f: FieldDefinition, level = 2, optional = false) => {
		placedLong.add(f.id);
		// The heading Worldsmith wrote last time is still its own after a rename in Type Studio.
		const written = entity.nativeNote?.base[`h:${f.id}`];
		const labels = written !== undefined && written !== f.label ? [f.label, written] : [f.label];
		out.push({
			id: f.id,
			kind: 'field',
			label: f.label,
			ws: typeof entity.values[f.id] === 'string' ? (entity.values[f.id] as string) : '',
			build: (t) => fieldContent(f.label, t, level),
			read: (c) => fieldText(c, { level, labels }),
			optional,
			heading: f.label,
		});
	};
	for (const sec of ctx.template.sections) {
		if (sec.hidden) continue;
		switch (sec.kind) {
			case 'banner': {
				const b = entity.media.banner?.path;
				view(sec, 'Banner', b ? embed(b, 'ws-banner') : '');
				break;
			}
			case 'infocard': {
				const portrait = ctx.template.appearance.portrait !== 'none' ? entity.media.portrait?.path : undefined;
				const fields = factFields(ctx, entity, sec, new Set(), 8);
				for (const f of fields) infocardFields.add(f.id);
				const rows = fields.map((f) => ({ f, t: valueText(ctx, entity, f) })).filter((x) => x.t);
				if (!portrait && !rows.length) {
					view(sec, 'Info card', '');
					break;
				}
				// The metadata says the first line is the portrait (native-note.css lays it out without :has).
				const lines = [`> [!ws-infobox${portrait ? '|portrait' : ''}] ${entity.name}`];
				if (portrait) lines.push(`> ${embed(portrait)}`, '>');
				const cap = entity.media.portrait?.caption?.trim();
				if (portrait && cap) lines.push(`> ${cap.replace(/\r?\n+/g, ' ')}`, '>');
				if (rows.length) lines.push('> | | |', '> |---|---|', ...rows.map(({ f, t }) => `> | ${cell(f.label)} | ${cell(t)} |`));
				view(sec, 'Info card', lines.join('\n'));
				break;
			}
			case 'title': {
				const kicker = [schema.singular, statusLabel(ctx.world, entity.status)].filter(Boolean).join(' · ');
				// Classed spans, so native-note.css styles the kicker and aliases by class, not position.
				const lines = [`<span class="ws-kicker">${htmlText(kicker)}</span>`, '', `# ${entity.name}`];
				if (entity.aliases.length) lines.push('', `<span class="ws-aliases">${htmlText(entity.aliases.join(' · '))}</span>`);
				view(sec, 'Title', lines.join('\n'), { note: HEADER_NOTE });
				break;
			}
			case 'summary':
				// A blank line ends the quote before the end marker (so editing shows it as a quote only).
				out.push({ id: SUMMARY_REGION, kind: 'field', label: 'Summary', ws: entity.description ?? '', build: (t) => (t.trim() ? `${quoteContent(t)}\n` : ''), read: unquote });
				break;
			case 'facts': {
				const fields = sec.fields?.length ? factFields(ctx, entity, sec, infocardFields, 12) : factFields(ctx, entity, sec, new Set([...infocardFields, ...ctx.schema.fields.filter((f) => linksShown && isLink(f)).map((f) => f.id)]), 12);
				for (const f of fields) infocardFields.add(f.id);
				view(sec, sec.title || 'Facts', factsCallout(ctx, entity, sec.title || 'At a glance', fields, fold(sec)));
				break;
			}
			case 'schemaSections': {
				const sections = schema.sections.length ? schema.sections : [{ id: 'fields', label: 'Details', fieldIds: schema.fields.map((f) => f.id) }];
				const inSection = new Set(sections.flatMap((x) => x.fieldIds));
				const groups = [...sections.map((x) => ({ id: x.id, label: x.label, ids: x.fieldIds, collapsed: (x as { collapsed?: boolean }).collapsed })), { id: 'other', label: 'Other details', ids: schema.fields.filter((f) => !inSection.has(f.id)).map((f) => f.id), collapsed: false }];
				for (const g of groups) {
					const fields = g.ids.map((id) => schema.fields.find((f) => f.id === id)).filter((f): f is FieldDefinition => !!f);
					const facts = fields.filter((f) => SHOWN_IN_FACTS(f) && !infocardFields.has(f.id) && !(linksShown && isLink(f)));
					const content = factsCallout(ctx, entity, g.label, facts, g.collapsed ? '-' : '');
					const rid = `${sec.id}-${g.id}`.toLowerCase().replace(/[^a-z0-9_-]+/g, '-');
					if (content || out.some((r) => r.id === rid)) view({ id: rid }, g.label, content, { optional: true });
					// Empty long fields get their section once they have text.
					for (const f of fields) if (fieldHome(f) === 'section' && !placedLong.has(f.id) && !f.hidden) field(f, 2, true);
				}
				break;
			}
			case 'field': {
				const f = schema.fields.find((x) => x.id === sec.fields?.[0]);
				if (f && fieldHome(f) === 'section') {
					placedLong.delete(f.id);
					field(f);
				}
				break;
			}
			case 'heading':
				view(sec, sec.title || 'Heading', `## ${sec.title || 'Section'}`);
				break;
			case 'separator':
				view(sec, 'Separator', '***');
				break;
			case 'connections': {
				const conns = ctx.connections(entity);
				const title = sec.title || 'Connections';
				if (!conns.length) {
					view(sec, title, '');
					break;
				}
				const groups = new Map<string, NoteConnection[]>();
				for (const c of conns) groups.set(c.label, [...(groups.get(c.label) ?? []), c]);
				const word = (c: NoteConnection) => [c.status && c.status !== 'active' && c.status !== 'unknown' ? c.status : '', c.secret ? 'secret' : ''].filter(Boolean).join(', ');
				const lines = [`> [!ws-links]${fold(sec)} ${title}`];
				for (const [label, list] of groups) lines.push(`> - **${label}** ${list.map((c) => entryLink(ctx, c.otherId, c.otherName) + (word(c) ? ` *${word(c)}*` : '')).join(', ')}`);
				if (sec.table) {
					lines.push('', `> [!ws-links|table]+ All ${conns.length} connections (table)`, '> | Kind | With | Status | Since | Note |', '> |---|---|---|---|---|');
					for (const c of conns) lines.push(`> | ${cell(c.label)} | ${cell(entryLink(ctx, c.otherId, c.otherName))} | ${cell(c.status ?? '')} | ${cell(c.since)} | ${cell(c.note)} |`);
				}
				view(sec, title, lines.join('\n'));
				break;
			}
			case 'children': {
				const kids = ctx.children(entity);
				const title = sec.title || 'Within this';
				view(sec, title, kids.length ? [`> [!ws-links]${fold(sec)} ${title}`, ...kids.map((k) => `> - ${entryLink(ctx, k.id, k.name)}`)].join('\n') : '');
				break;
			}
			case 'gallery': {
				const imgs = entity.media.gallery.map((g) => g.path).filter(Boolean);
				view(sec, sec.title || 'Gallery', imgs.length ? [`> [!ws-gallery]${fold(sec)} ${sec.title || 'Gallery'}`, `> ${imgs.map((p) => embed(p, '200')).join(' ')}`].join('\n') : '');
				break;
			}
			case 'footer':
				// Long text fields placed nowhere still get a section (only when they have text).
				for (const f of longFields(schema)) if (!placedLong.has(f.id) && !f.hidden) field(f, 2, true);
				view(sec, 'Footer', `[Open in Worldsmith](obsidian://worldsmith?world=${encodeURIComponent(ctx.world.id)}&entry=${encodeURIComponent(entity.id)})${ctx.footerExtra ? ' · ' + ctx.footerExtra : ''}`, { atEnd: true });
				break;
		}
	}
	if (!ctx.template.sections.some((x) => x.kind === 'footer')) for (const f of longFields(schema)) if (!placedLong.has(f.id) && !f.hidden) field(f, 2, true);
	return out;
}

/** Properties: aliases, tags, status, then one per short field (schema order). */
export function propSpecs(entity: EntityRecord, ctx: RenderContext): PropSpec[] {
	const out: PropSpec[] = [];
	const listCanon = (strip: boolean) => (raw: unknown) => canon(listProp(raw, strip));
	const listShow = (raw: unknown) => listProp(raw).join(', ');
	const aliases = entity.aliases.filter(Boolean);
	out.push({ id: 'p:__aliases', key: 'aliases', label: 'Aliases', ws: aliases, wsCanon: canon(aliases), canon: listCanon(false), show: listShow, wsShow: aliases.join(', ') });
	const tags = entity.tags.map(tagToNote).filter(Boolean);
	out.push({ id: 'p:__tags', key: 'tags', label: 'Tags', ws: tags, wsCanon: canon(tags), canon: listCanon(true), show: listShow, wsShow: tags.join(', ') });
	const st = statusLabel(ctx.world, entity.status);
	const strCanon = (raw: unknown) => canon(raw === null || raw === undefined ? null : Array.isArray(raw) ? raw.join(', ') : String(raw).trim());
	out.push({ id: 'p:__status', key: 'Status', label: 'Status', ws: st, wsCanon: canon(st), canon: strCanon, show: (r) => (r == null ? '' : String(r)), wsShow: st });
	for (const f of ctx.schema.fields) {
		const key = ctx.keys.get(f.id);
		if (!key) continue;
		const ws = toProperty(f, entity.values[f.id], ctx.fieldTypes);
		out.push({
			id: `p:${f.id}`,
			key,
			label: f.label,
			ws,
			wsCanon: canon(ws),
			canon: (raw) => canon(normalizeProperty(f, raw)),
			show: (raw) => {
				const n = normalizeProperty(f, raw);
				return Array.isArray(n) ? n.join(', ') : n == null ? '' : String(n);
			},
			wsShow: Array.isArray(ws) ? ws.join(', ') : ws == null ? '' : String(ws),
			bareDate: f.type === 'date',
		});
	}
	return out;
}

/** The note's identity keys. `cssclasses` keeps the person's own classes. */
export function fixedKeys(entity: EntityRecord, ctx: RenderContext): PlanInput['fixed'] {
	const tpl = tplClass(ctx.template.id);
	return [
		{ key: 'worldsmith-id', value: entity.id },
		{ key: 'worldsmith-world', value: ctx.world.id },
		{ key: 'worldsmith-type', value: entity.typeId },
		{ key: 'worldsmith-template', value: ctx.templateOverride ? ctx.template.id : undefined },
		{
			key: 'cssclasses',
			value: (raw: unknown) => {
				const mine = listProp(raw).filter((c) => c !== 'ws-note' && !c.startsWith('ws-tpl-'));
				return ['ws-note', tpl, ...mine];
			},
		},
	];
}

/** Text for inside an HTML element in a note: &, < and > escaped. */
function htmlText(t: string): string {
	return t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
