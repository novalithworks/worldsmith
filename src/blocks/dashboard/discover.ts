import { Keymap, setTooltip } from 'obsidian';
import { orphansOf, type EntityRecord, type FieldDefinition } from '../../core/types';
import { relativeTime } from '../../core/util/strings';
import { vaultImage } from '../../fields/ui/media';
import { blockActions } from '../../layouts/renderer/LayoutRenderer';
import { daySeed, shuffled, typeChoices } from '../../services/entryQuery';
import { ROUTES } from '../../state/route';
import { avatar } from '../../ui/components/avatar';
import { button, cx, emptyState, icon, nameRegion } from '../../ui/components/dom';
import { subtitleFor } from '../../ui/components/entityCard';
import type { BlockDefinition, BlockRenderContext } from '../BlockRegistry';
import { linkToEntity } from '../util';
import { num, watchWorld } from './common';

const live = (e: EntityRecord | undefined): e is EntityRecord => !!e && !e.trashedAt && !e.archivedAt;

/** A stable per-day number for a key (FNV-1a), so a pick doesn't move when the pool does. */
function dayHash(key: string, offset = 0): number {
	let h = 2166136261 ^ (daySeed() + offset * 7919);
	for (let i = 0; i < key.length; i++) {
		h ^= key.charCodeAt(i);
		h = Math.imul(h, 16777619);
	}
	return h >>> 0;
}

/**
 * Today's pick for a widget: the item whose key hashes lowest today (stable as other items
 * come and go), remembered for the day so editing the pick itself doesn't swap it out.
 * `offset` = how many times "show another" was pressed.
 */
const todaysPicks = new Map<string, string>();
function pickOfTheDay<T>(widgetId: string, items: T[], key: (t: T) => string, offset: number, resolve: (k: string) => T | undefined): T | undefined {
	if (!items.length) return undefined;
	const slot = `${widgetId}:${daySeed()}:${offset}`;
	const remembered = todaysPicks.get(slot);
	const kept = remembered ? resolve(remembered) : undefined;
	if (kept) return kept;
	const ranked = [...items].sort((a, b) => dayHash(key(a), offset) - dayHash(key(b), offset));
	const pick = ranked[0]!;
	todaysPicks.set(slot, key(pick));
	return pick;
}

const typesField = (s: BlockRenderContext['session'], label = 'Only these types'): FieldDefinition => ({
	id: 'types',
	type: 'multiselect',
	label,
	placeholder: 'Every type',
	width: 'full',
	config: { options: typeChoices(s, false) },
});

const typesOf = (ctx: BlockRenderContext): string[] => (Array.isArray(ctx.config.types) ? (ctx.config.types as unknown[]).filter((x): x is string => typeof x === 'string') : []);

function plainText(md: string): string {
	return md
		.replace(/!\[\[[^\]]*\]\]/g, '')
		.replace(/\[\[([^\]|]*\|)?([^\]]*)\]\]/g, '$2')
		.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
		.replace(/[*_`#>~]/g, '')
		.replace(/\s+/g, ' ')
		.trim();
}

// ── Spotlight ──────────────────────────────────────────────────────────────────

export const spotlightBlock: BlockDefinition = {
	id: 'spotlight',
	name: 'Spotlight',
	icon: 'sparkles',
	category: 'Discovery',
	description: 'A different entry every day — a nudge to revisit something you haven’t touched in a while.',
	hint: 'A new entry every day',
	surfaces: ['dashboard'],
	frame: 'card',
	defaultSize: { w: 5, h: 1 },
	defaultConfig: { types: [], prefer: 'forgotten' },
	configFields: (s) => [
		typesField(s),
		{ id: 'prefer', type: 'select', label: 'Prefer', config: { options: [{ id: 'forgotten', label: 'Entries not edited in a while' }, { id: 'any', label: 'Any entry' }, { id: 'images', label: 'Entries with an image' }] } },
	],
	title: () => 'Spotlight',
	render(ctx) {
		const s = ctx.session;
		const root = ctx.el.createDiv({ cls: 'ws-spotlight' });
		let offset = 0;
		const actions = blockActions(ctx.el);
		if (actions)
			button(actions, {
				icon: 'shuffle',
				variant: 'quiet',
				size: 'sm',
				tooltip: 'Show another',
				cls: 'ws-spotlight__shuffle',
				onClick: () => {
					offset++;
					paint();
				},
			});
		const paint = () => {
			root.empty();
			const types = typesOf(ctx);
			let pool = s.entities.all().filter((e) => live(e) && s.schemas.get(e.typeId) && (!types.length || types.includes(e.typeId)));
			if (ctx.config.prefer === 'images') {
				const withImg = pool.filter((e) => e.media.portrait || e.media.banner || e.media.gallery.length);
				if (withImg.length) pool = withImg;
			} else if (ctx.config.prefer !== 'any') {
				// The least recently edited half, so the spotlight finds forgotten corners.
				const sorted = [...pool].sort((a, b) => a.updatedAt - b.updatedAt);
				if (sorted.length > 4) pool = sorted.slice(0, Math.ceil(sorted.length / 2));
			}
			if (!pool.length) {
				emptyState(root, { icon: 'sparkles', title: 'Nothing to spotlight yet', body: 'Create a few entries and one shows up here every day.', compact: true });
				return;
			}
			// Remembered picks only need to still exist (not be "forgotten"): opening and
			// editing today's spotlight shouldn't make it jump to another entry.
			const all = s.entities.all().filter((x) => live(x) && s.schemas.get(x.typeId) && (!types.length || types.includes(x.typeId)));
			const e = pickOfTheDay(ctx.instance.id, pool, (x) => x.id, offset, (id) => all.find((x) => x.id === id)) ?? pool[0]!;
			const schema = s.schemas.get(e.typeId);
			root.className = cx('ws-spotlight', schema?.color && `ws-tint--${schema.color}`).join(' ');
			const card = root.createDiv({ cls: 'ws-spotlight__card' });
			avatar(card, ctx.app, e, schema, { shape: 'arch', size: e.media.portrait ? 'lg' : 'md', cls: 'ws-spotlight__portrait' });
			const t = card.createDiv({ cls: 'ws-spotlight__text' });
			const eyebrow = t.createDiv({ cls: 'ws-spotlight__eyebrow' });
			if (schema) icon(eyebrow, schema.icon);
			eyebrow.createSpan({ text: schema?.singular ?? '' });
			t.createDiv({ cls: 'ws-spotlight__name', text: e.name });
			const sub = schema ? subtitleFor(e, schema, ctx.ws.fieldTypes, s.values) : '';
			if (sub) t.createDiv({ cls: 'ws-spotlight__sub', text: sub });
			const summary = plainText(e.description);
			if (summary) t.createDiv({ cls: 'ws-spotlight__summary', text: summary.length > 180 ? `${summary.slice(0, 177)}…` : summary });
			const p = s.entityService.progress(e);
			const foot = root.createDiv({ cls: 'ws-spotlight__foot' });
			foot.createSpan({ text: `Last edited ${relativeTime(e.updatedAt)} · ${Math.round(p.ratio * 100)}% developed` });
			linkToEntity(ctx, card, e);
		};
		paint();
		watchWorld(ctx, paint, { entities: (k) => k.some((x) => ['name', 'media', 'description', 'trashedAt', 'archivedAt'].includes(x)) });
	},
};

// ── Quote ──────────────────────────────────────────────────────────────────────

const QUOTE_KINDS = new Set(['longtext', 'text', 'richtext']);

export const randomQuoteBlock: BlockDefinition = {
	id: 'random-quote',
	name: 'From the archives',
	icon: 'quote',
	category: 'Discovery',
	description: 'A line from a random entry — a motto, a personality, a legend — set like a quotation.',
	hint: 'A random line from your world',
	surfaces: ['dashboard'],
	frame: 'plain',
	defaultSize: { w: 7, h: 1 },
	defaultConfig: { types: [], source: 'auto' },
	configFields: (s) => [
		typesField(s),
		{
			id: 'source',
			type: 'select',
			label: 'Take the line from',
			config: {
				options: [
					{ id: 'auto', label: 'Mottos, summaries and personalities' },
					{ id: 'description', label: 'Entry summaries' },
				],
			},
		},
	],
	render(ctx) {
		const s = ctx.session;
		const root = ctx.el.createDiv({ cls: 'ws-archive' });
		let offset = 0;
		const candidates = (): Array<{ e: EntityRecord; text: string; label: string }> => {
			const types = typesOf(ctx);
			const out: Array<{ e: EntityRecord; text: string; label: string }> = [];
			for (const e of s.entities.all()) {
				if (!live(e) || (types.length && !types.includes(e.typeId))) continue;
				const schema = s.schemas.get(e.typeId);
				if (!schema) continue;
				if (ctx.config.source !== 'description') {
					for (const f of schema.fields) {
						if (!QUOTE_KINDS.has(f.type) || f.hidden) continue;
						if (!/motto|summary|personality|quote|saying|creed|legend|prophecy|description/i.test(`${f.id} ${f.label}`)) continue;
						const v = e.values[f.id];
						if (typeof v === 'string' && v.trim().length >= 20) out.push({ e, text: v, label: f.label });
					}
				}
				const d = plainText(e.description);
				if (d.length >= 30) out.push({ e, text: d, label: 'Summary' });
			}
			return out;
		};
		const paint = () => {
			root.empty();
			const all = candidates().sort((a, b) => a.e.id.localeCompare(b.e.id) || a.label.localeCompare(b.label));
			if (!all.length) {
				root.addClass('is-empty');
				emptyState(root, { icon: 'quote', title: 'The archives are empty', body: 'Write a summary, motto or personality on any entry and a line shows up here.', compact: true });
				return;
			}
			root.removeClass('is-empty');
			const pick = pickOfTheDay(ctx.instance.id, all, (c) => `${c.e.id}|${c.label}`, offset, (k) => all.find((c) => `${c.e.id}|${c.label}` === k))!;
			const schema = s.schemas.get(pick.e.typeId);
			root.className = cx('ws-archive', schema?.color && `ws-tint--${schema.color}`).join(' ');
			icon(root, 'quote', 'ws-archive__mark');
			// One or two sentences, not a whole paragraph.
			const plain = plainText(pick.text);
			const sentences = plain.match(/[^.!?]+[.!?]+["”’]?/g) ?? [plain];
			let line = '';
			for (const sn of sentences) {
				if ((line + sn).length > 240 && line) break;
				line += sn;
			}
			line = line.trim() || plain.slice(0, 240);
			root.createEl('blockquote', { cls: 'ws-archive__text', text: line });
			const by = root.createDiv({ cls: 'ws-archive__by' });
			avatar(by, ctx.app, pick.e, schema, { size: 'xs' });
			by.createSpan({ cls: 'ws-archive__name', text: pick.e.name });
			by.createSpan({ cls: 'ws-archive__src', text: `${schema?.singular ?? ''} · ${pick.label}` });
			linkToEntity(ctx, by, pick.e);
			const more = root.createEl('button', { cls: 'ws-archive__next clickable-icon', attr: { type: 'button', 'aria-label': 'Another line' } });
			icon(more, 'shuffle');
			setTooltip(more, 'Another line', { delay: 300 });
			more.addEventListener('click', () => {
				offset++;
				paint();
			});
		};
		paint();
		watchWorld(ctx, paint, { entities: (k) => k.includes('values') || k.includes('description') || k.includes('trashedAt') });
	},
};

// ── Image wall ─────────────────────────────────────────────────────────────────

export const imageWallBlock: BlockDefinition = {
	id: 'image-wall',
	name: 'Image wall',
	icon: 'layout-grid',
	category: 'Discovery',
	description: 'A mosaic of your world’s portraits, banners and gallery images.',
	hint: 'A mosaic of your images',
	surfaces: ['dashboard'],
	frame: 'card',
	defaultSize: { w: 12, h: 1 },
	defaultConfig: { types: [], source: 'portraits', limit: 12, order: 'recent' },
	configFields: (s) => [
		typesField(s),
		{ id: 'source', type: 'select', label: 'Images', config: { options: [{ id: 'portraits', label: 'Portraits' }, { id: 'all', label: 'Portraits, banners and galleries' }] } },
		{ id: 'order', type: 'select', label: 'Order', config: { options: [{ id: 'recent', label: 'Recently edited first' }, { id: 'shuffle', label: 'Shuffle daily' }, { id: 'name', label: 'By name' }] } },
		{ id: 'limit', type: 'number', label: 'How many', config: { min: 3, max: 48 } },
	],
	title: (ctx) => (ctx.config.source === 'all' ? 'Image wall' : 'Portraits'),
	render(ctx) {
		const s = ctx.session;
		const root = ctx.el.createDiv({ cls: 'ws-wall' });
		const paint = () => {
			root.empty();
			const types = typesOf(ctx);
			const items: Array<{ e: EntityRecord; path: string; ref: { path: string; focalX?: number; focalY?: number; zoom?: number; fit?: 'cover' | 'contain' } }> = [];
			let ents = s.entities.all().filter((e) => live(e) && (!types.length || types.includes(e.typeId)));
			if (ctx.config.order === 'name') ents = ents.sort((a, b) => a.name.localeCompare(b.name));
			else if (ctx.config.order === 'shuffle') ents = shuffled(ents.sort((a, b) => a.id.localeCompare(b.id)), daySeed());
			else ents = ents.sort((a, b) => b.updatedAt - a.updatedAt);
			for (const e of ents) {
				if (e.media.portrait) items.push({ e, path: e.media.portrait.path, ref: e.media.portrait });
				if (ctx.config.source === 'all') {
					if (e.media.banner) items.push({ e, path: e.media.banner.path, ref: e.media.banner });
					for (const g of e.media.gallery) items.push({ e, path: g.path, ref: g });
				}
			}
			const seen = new Set<string>();
			const unique = items.filter((x) => (seen.has(x.path) ? false : (seen.add(x.path), true)));
			const limit = num(ctx.config.limit, 12, 3, 48);
			const shown = unique.slice(0, limit);
			if (!shown.length) {
				emptyState(root, { icon: 'image', title: 'No images yet', body: 'Give entries a portrait and they gather here.', compact: true });
				return;
			}
			const grid = root.createDiv({ cls: cx('ws-wall__grid', ctx.config.source === 'all' && 'is-mixed') });
			for (const it of shown) {
				const schema = s.schemas.get(it.e.typeId);
				const tile = grid.createDiv({ cls: cx('ws-wall__tile', schema?.color && `ws-tint--${schema.color}`) });
				vaultImage(tile, ctx.app, it.ref, 'ws-wall__img');
				const cap = tile.createDiv({ cls: 'ws-wall__cap' });
				cap.createDiv({ cls: 'ws-wall__name', text: it.e.name });
				cap.createDiv({ cls: 'ws-wall__type', text: schema?.singular ?? '' });
				linkToEntity(ctx, tile, it.e);
			}
			if (unique.length > shown.length) root.createDiv({ cls: 'ws-wall__more', text: `+${unique.length - shown.length} more` });
		};
		paint();
		watchWorld(ctx, paint, { entities: (k) => k.includes('media') || k.includes('name') || k.includes('trashedAt') });
	},
};

// ── Recent connections ─────────────────────────────────────────────────────────

export const recentConnectionsBlock: BlockDefinition = {
	id: 'recent-connections',
	name: 'New connections',
	icon: 'link-2',
	category: 'Activity',
	description: 'The latest links made between entries: who met whom, who joined what.',
	hint: 'Latest links between entries',
	surfaces: ['dashboard'],
	frame: 'card',
	defaultSize: { w: 5, h: 1 },
	defaultConfig: { limit: 6 },
	configFields: [{ id: 'limit', type: 'number', label: 'How many', config: { min: 1, max: 30 } }],
	render(ctx) {
		const s = ctx.session;
		const root = ctx.el.createDiv({ cls: 'ws-newlinks' });
		const paint = () => {
			root.empty();
			const edges = s.relations
				.allEdges()
				.filter((e) => live(s.entities.get(e.from)) && live(s.entities.get(e.to)))
				.sort((a, b) => b.createdAt - a.createdAt)
				.slice(0, num(ctx.config.limit, 6, 1, 30));
			if (!edges.length) {
				emptyState(root, { icon: 'link-2', title: 'No connections yet', body: 'Link entries through fields like Members or Mentors, or from an entry’s Connections.', compact: true });
				return;
			}
			for (const edge of edges) {
				const v = s.relations.view(edge, edge.from);
				const from = s.entities.get(edge.from)!;
				const to = s.entities.get(edge.to)!;
				const row = root.createDiv({ cls: 'ws-newlinks__row', attr: { tabindex: '0', role: 'link' } });
				const a = row.createDiv({ cls: 'ws-newlinks__end' });
				avatar(a, ctx.app, from, s.schemas.get(from.typeId), { size: 'xs' });
				a.createSpan({ cls: 'ws-newlinks__name', text: from.name });
				const mid = row.createDiv({ cls: cx('ws-newlinks__label', edge.secret && 'is-secret') });
				mid.createSpan({ text: (v?.type?.forwardLabel ?? v?.label ?? edge.type).toLowerCase() });
				const b = row.createDiv({ cls: 'ws-newlinks__end' });
				avatar(b, ctx.app, to, s.schemas.get(to.typeId), { size: 'xs' });
				b.createSpan({ cls: 'ws-newlinks__name', text: to.name });
				row.createDiv({ cls: 'ws-newlinks__when', text: relativeTime(edge.createdAt) });
				const open = (evt: MouseEvent | KeyboardEvent) => ctx.navigate(ROUTES.relation(edge.id), Keymap.isModEvent(evt));
				row.addEventListener('click', open);
				row.addEventListener('keydown', (evt) => evt.key === 'Enter' && open(evt));
				setTooltip(row, `${from.name} — ${v?.label ?? edge.type} — ${to.name}${edge.description ? `\n${edge.description}` : ''}`, { delay: 400 });
			}
		};
		paint();
		watchWorld(ctx, paint, { edges: true, entities: (k) => k.includes('name') || k.includes('trashedAt') });
	},
};

// ── Search box ─────────────────────────────────────────────────────────────────

export const searchBoxBlock: BlockDefinition = {
	id: 'search-box',
	name: 'Search box',
	icon: 'search',
	category: 'Overview',
	description: 'Search names, aliases, tags and fields right from the dashboard.',
	hint: 'Search without leaving the page',
	surfaces: ['dashboard'],
	frame: 'plain',
	defaultSize: { w: 12, h: 1 },
	defaultConfig: {},
	singleton: true,
	render(ctx) {
		const s = ctx.session;
		const root = ctx.el.createDiv({ cls: 'ws-searchbox' });
		const field = root.createDiv({ cls: 'ws-searchbox__field' });
		icon(field, 'search', 'ws-searchbox__icon');
		const listId = `ws-searchbox-${ctx.instance.id}`;
		const input = field.createEl('input', {
			cls: 'ws-searchbox__input',
			attr: { type: 'search', placeholder: `Search ${s.world.name}…`, 'aria-label': 'Search your world', role: 'combobox', 'aria-expanded': 'false', 'aria-controls': listId, 'aria-autocomplete': 'list' },
		});
		field.createSpan({ cls: 'ws-searchbox__hint', text: 'Enter for all results' });
		const results = root.createDiv({ cls: 'ws-searchbox__results', attr: { role: 'listbox', id: listId} });
		nameRegion(results, 'Matching entries' );
		let active = -1;
		let hits: EntityRecord[] = [];
		const paint = () => {
			results.empty();
			const q = input.value.trim();
			hits = q ? s.search.search(q, { limit: 6 }).map((h) => h.entity) : [];
			const open = !!hits.length || !!q;
			root.toggleClass('has-results', open);
			input.setAttr('aria-expanded', String(open));
			if (q && !hits.length) results.createDiv({ cls: 'ws-searchbox__none', text: 'Nothing matches.', attr: { role: 'status' } });
			hits.forEach((e, i) => {
				const schema = s.schemas.get(e.typeId);
				const r = results.createDiv({ cls: cx('ws-searchbox__hit', i === active && 'is-active'), attr: { role: 'option', id: `${listId}-${i}`, 'aria-selected': String(i === active) } });
				avatar(r, ctx.app, e, schema, { size: 'xs' });
				r.createSpan({ cls: 'ws-searchbox__name', text: e.name });
				r.createSpan({ cls: 'ws-searchbox__type', text: schema?.singular ?? '' });
				r.addEventListener('mousedown', (evt) => {
					evt.preventDefault();
					ctx.navigate(ROUTES.entity(e.id), Keymap.isModEvent(evt));
				});
			});
			if (active >= 0 && hits[active]) input.setAttr('aria-activedescendant', `${listId}-${active}`);
			else input.removeAttribute('aria-activedescendant');
		};
		input.addEventListener('input', () => {
			active = -1;
			paint();
		});
		input.addEventListener('keydown', (evt) => {
			if (evt.key === 'ArrowDown' || evt.key === 'ArrowUp') {
				evt.preventDefault();
				if (!hits.length) return;
				active = (active + (evt.key === 'ArrowDown' ? 1 : -1) + hits.length) % hits.length;
				paint();
			} else if (evt.key === 'Enter') {
				const pick = hits[active];
				if (pick) ctx.navigate(ROUTES.entity(pick.id), Keymap.isModEvent(evt));
				else if (input.value.trim()) ctx.navigate(ROUTES.search(input.value.trim()), Keymap.isModEvent(evt));
			} else if (evt.key === 'Escape') {
				input.value = '';
				active = -1;
				paint();
			}
		});
		input.addEventListener('blur', () =>
			window.setTimeout(() => {
				root.removeClass('has-results');
				input.setAttr('aria-expanded', 'false');
			}, 150),
		);
		input.addEventListener('focus', () => input.value && paint());
	},
};

// ── Development by type ────────────────────────────────────────────────────────

export const worldProgressBlock: BlockDefinition = {
	id: 'world-progress',
	name: 'Development by type',
	icon: 'gauge',
	category: 'Overview',
	description: 'How developed each kind of entry is on average, from tasks and key fields.',
	hint: 'How far along each type is',
	surfaces: ['dashboard'],
	frame: 'card',
	defaultSize: { w: 5, h: 1 },
	defaultConfig: { types: [], hideEmpty: true },
	configFields: (s) => [typesField(s), { id: 'hideEmpty', type: 'boolean', label: 'Hide types with no entries' }],
	render(ctx) {
		const s = ctx.session;
		const root = ctx.el.createDiv({ cls: 'ws-ptypes' });
		const paint = () => {
			root.empty();
			const types = typesOf(ctx);
			const per = new Map<string, { n: number; sum: number }>();
			for (const e of s.entities.all()) {
				if (!live(e) || (types.length && !types.includes(e.typeId))) continue;
				const p = per.get(e.typeId) ?? { n: 0, sum: 0 };
				p.n++;
				p.sum += s.entityService.progress(e).ratio;
				per.set(e.typeId, p);
			}
			const schemas = s.schemas.list().filter((t) => !t.archived && (!types.length || types.includes(t.id)) && (ctx.config.hideEmpty === false || per.has(t.id)));
			if (!schemas.length) {
				emptyState(root, { icon: 'gauge', title: 'No entries yet', compact: true });
				return;
			}
			let all = 0;
			let n = 0;
			for (const t of schemas) {
				const p = per.get(t.id) ?? { n: 0, sum: 0 };
				all += p.sum;
				n += p.n;
				const pct = p.n ? Math.round((p.sum / p.n) * 100) : 0;
				const r = root.createEl('button', { cls: cx('ws-ptype', `ws-tint--${t.color ?? 'gray'}`), attr: { type: 'button' } });
				icon(r, t.icon, 'ws-ptype__icon');
				r.createSpan({ cls: 'ws-ptype__name', text: t.plural });
				r.createSpan({ cls: 'ws-ptype__num', text: p.n ? `${p.n} · ${pct}%` : 'none yet' });
				const bar = r.createDiv({ cls: 'ws-ptype__bar' });
				bar.createDiv({ cls: 'ws-ptype__fill' }).style.width = `${pct}%`;
				r.addEventListener('click', (ev) => ctx.navigate(ROUTES.database(t.id), Keymap.isModEvent(ev)));
			}
			ctx.setTitle(n ? `Development · ${Math.round((all / n) * 100)}% overall` : 'Development');
		};
		paint();
		watchWorld(ctx, paint, { tasks: true, world: (k) => k.includes('progress') });
	},
};

// ── Needs attention ────────────────────────────────────────────────────────────

type CheckId = 'no-summary' | 'no-portrait' | 'missing-images' | 'unused-data' | 'no-connections' | 'stale';

const CHECKS: Array<{ id: CheckId; label: string; icon: string; hint: string }> = [
	{ id: 'no-summary', label: 'No summary', icon: 'align-left', hint: 'Entries without a short description' },
	{ id: 'no-portrait', label: 'No portrait', icon: 'image-off', hint: 'Characters, creatures and deities without a portrait' },
	{ id: 'missing-images', label: 'Missing images', icon: 'file-x', hint: 'Images that were moved or deleted outside Worldsmith' },
	{ id: 'unused-data', label: 'Unused data', icon: 'archive-restore', hint: 'Values left over from deleted or changed fields' },
	{ id: 'no-connections', label: 'Not connected', icon: 'unlink', hint: 'Entries with no connections to anything' },
	{ id: 'stale', label: 'Untouched for 90 days', icon: 'clock', hint: 'Entries nobody has edited in three months' },
];

const PORTRAIT_TYPES = new Set(['character', 'creature', 'deity', 'species']);

export const worldAttentionBlock: BlockDefinition = {
	id: 'world-attention',
	name: 'Needs attention',
	icon: 'stethoscope',
	category: 'Overview',
	description: 'Gaps worth filling: missing summaries and portraits, broken images, unused data, loose ends.',
	hint: 'Gaps and loose ends',
	surfaces: ['dashboard'],
	frame: 'card',
	defaultSize: { w: 5, h: 1 },
	defaultConfig: { checks: ['no-summary', 'no-portrait', 'missing-images', 'unused-data', 'no-connections'], types: [] },
	configFields: (s) => [{ id: 'checks', type: 'multiselect', label: 'Look for', width: 'full', config: { options: CHECKS.map((c) => ({ id: c.id, label: c.label })) } }, typesField(s)],
	render(ctx) {
		const s = ctx.session;
		const root = ctx.el.createDiv({ cls: 'ws-health' });
		const open = new Set<CheckId>();
		const paint = () => {
			root.empty();
			const types = typesOf(ctx);
			const wanted = Array.isArray(ctx.config.checks) ? (ctx.config.checks as CheckId[]) : CHECKS.map((c) => c.id);
			const ents = s.entities.all().filter((e) => live(e) && s.schemas.get(e.typeId) && (!types.length || types.includes(e.typeId)));
			const missingPaths = wanted.includes('missing-images') ? s.media.missing((p) => ctx.ws.media.exists(p)) : new Map();
			const stale = Date.now() - 90 * 86400000;
			const results: Array<{ check: (typeof CHECKS)[number]; entries: EntityRecord[]; extra?: string }> = [];
			for (const check of CHECKS) {
				if (!wanted.includes(check.id)) continue;
				let list: EntityRecord[] = [];
				let extra: string | undefined;
				if (check.id === 'no-summary') list = ents.filter((e) => !plainText(e.description));
				else if (check.id === 'no-portrait') list = ents.filter((e) => PORTRAIT_TYPES.has(e.typeId) && !e.media.portrait);
				else if (check.id === 'unused-data') list = ents.filter((e) => Object.keys(orphansOf(e.values)).length > 0);
				else if (check.id === 'no-connections') list = ents.filter((e) => s.relations.count(e.id) === 0 && !e.parentId && !s.index.childrenOf(e.id).length);
				else if (check.id === 'stale') list = ents.filter((e) => e.updatedAt < stale);
				else if (check.id === 'missing-images') {
					// Files used by the entries in scope (and the world banner when every type is).
					const inScope = new Set(ents.map((e) => e.id));
					const ids = new Set<string>();
					let files = 0;
					for (const uses of missingPaths.values()) {
						const relevant = (uses as Array<{ entityId?: string }>).filter((u) => (u.entityId ? inScope.has(u.entityId) : !types.length));
						if (!relevant.length) continue;
						files++;
						for (const u of relevant) if (u.entityId) ids.add(u.entityId);
					}
					list = [...ids].map((id) => s.entities.get(id)).filter(live);
					extra = files ? String(files) : undefined;
				}
				results.push({ check, entries: list.sort((a, b) => b.updatedAt - a.updatedAt), extra });
			}
			const issues = results.filter((r) => r.entries.length || r.extra);
			const distinct = new Set(issues.flatMap((r) => r.entries.map((e) => e.id))).size;
			ctx.setTitle(distinct ? `Needs attention · ${distinct} ${distinct === 1 ? 'entry' : 'entries'}` : 'Needs attention');
			if (!issues.length) {
				const ok = root.createDiv({ cls: 'ws-health__ok' });
				icon(ok, 'check-circle-2');
				ok.createSpan({ text: 'Nothing needs attention. Nice.' });
				return;
			}
			for (const r of results) {
				// Missing images count files (what you repair); everything else counts entries.
				const n = r.check.id === 'missing-images' ? Number(r.extra ?? 0) : r.entries.length;
				const row = root.createDiv({ cls: cx('ws-health__row', !n && 'is-clear', open.has(r.check.id) && 'is-open') });
				const head = row.createEl('button', { cls: 'ws-health__head', attr: { type: 'button', 'aria-expanded': String(open.has(r.check.id)) } });
				icon(head, n ? r.check.icon : 'check', 'ws-health__icon');
				head.createSpan({ cls: 'ws-health__label', text: r.check.label });
				head.createSpan({ cls: 'ws-health__count', text: n ? String(n) : '—' });
				setTooltip(head, r.check.id === 'missing-images' && n ? `${r.check.hint} — ${n} file${n === 1 ? '' : 's'}, open the media library to relink them` : r.check.hint, { delay: 500 });
				if (!n) {
					head.disabled = true;
					continue;
				}
				head.addEventListener('click', () => {
					if (r.check.id === 'missing-images') {
						ctx.navigate(ROUTES.media('missing'));
						return;
					}
					if (open.has(r.check.id)) open.delete(r.check.id);
					else open.add(r.check.id);
					paint();
				});
				if (open.has(r.check.id)) {
					const list = row.createDiv({ cls: 'ws-health__list' });
					for (const e of r.entries.slice(0, 8)) {
						const chip = list.createDiv({ cls: 'ws-health__chip' });
						avatar(chip, ctx.app, e, s.schemas.get(e.typeId), { size: 'xs' });
						chip.createSpan({ text: e.name });
						linkToEntity(ctx, chip, e);
					}
					if (n > 8) list.createSpan({ cls: 'ws-health__more', text: `+${n - 8} more` });
				}
			}
		};
		paint();
		watchWorld(ctx, paint, { edges: true });
	},
};
