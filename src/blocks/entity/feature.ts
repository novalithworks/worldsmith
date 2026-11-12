import { setTooltip } from 'obsidian';
import type { EntityRecord, EntitySchema, FieldDefinition, ImageRef } from '../../core/types';
import { vaultImage } from '../../fields/ui/media';
import { cx, emptyState, icon } from '../../ui/components/dom';
import { Lightbox } from '../../ui/media/Lightbox';
import { EntityMediaActions } from '../../ui/media/entityMedia';
import type { BlockDefinition, BlockRenderContext } from '../BlockRegistry';
import { currentEntity, watchEntity } from '../util';
import { revealField } from './properties';

type Scope = { schema?: EntitySchema } | undefined;

const TEXT_KINDS = ['text', 'longtext', 'richtext'];
const NUMERIC_KINDS = ['number', 'percent', 'rating'];
const DISPLAY_AS_CHIPS = ['select', 'multiselect', 'tags', 'relation', 'parent', 'children', 'color'];

const fieldsOf = (scope: Scope, kinds?: string[]) =>
	(scope?.schema?.fields ?? []).filter((f) => !f.hidden && (!kinds || kinds.includes(f.type))).map((f) => ({ id: f.id, label: f.label }));

const strList = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

/** Fields of the schema, in the order given by `ids`, skipping ones that no longer exist. */
function pickFields(schema: EntitySchema, ids: string[]): FieldDefinition[] {
	return ids.map((id) => schema.fields.find((f) => f.id === id)).filter((f): f is FieldDefinition => !!f && !f.hidden);
}

/** Re-render on edits to the entry and on connection changes (linked fields). */
function watchAll(ctx: BlockRenderContext, paint: () => void): void {
	watchEntity(ctx, () => paint());
	const id = ctx.entity?.id;
	const touches = ({ edge }: { edge: { from: string; to: string } }) => edge.from === id || edge.to === id;
	for (const ev of ['edge:created', 'edge:deleted', 'edge:updated'] as const) {
		const d = ctx.session.events.on(ev, (p) => touches(p) && paint());
		ctx.component.register(() => d.dispose());
	}
}

/** Show a field's value: chips for choice/link kinds, plain text otherwise. */
function showValue(ctx: BlockRenderContext, el: HTMLElement, e: EntityRecord, f: FieldDefinition): boolean {
	const v = ctx.session.values.get(e, f);
	if (ctx.ws.fieldTypes.isEmpty(f, v)) return false;
	const ui = ctx.ws.fieldTypes.for(f).ui;
	if (ui && DISPLAY_AS_CHIPS.includes(f.type)) ui.renderDisplay(el, v, { app: ctx.app, field: f, entity: e, component: ctx.component });
	else el.setText(ctx.ws.fieldTypes.toText(f, v));
	return true;
}

// ── Key facts ──────────────────────────────────────────────────────────────────

export const keyFactsBlock: BlockDefinition = {
	id: 'key-facts',
	name: 'Key facts',
	icon: 'gallery-horizontal-end',
	category: 'Showcase',
	description: 'Up to six fields you choose, shown large — the entry at a glance.',
	hint: 'Chosen fields, shown large',
	surfaces: ['entity'],
	frame: 'plain',
	defaultSize: { w: 12, h: 1 },
	defaultConfig: { fields: null },
	configFields: (_s, scope) => [{ id: 'fields', type: 'multiselect', label: 'Fields (up to six)', width: 'full', config: { options: fieldsOf(scope) } }],
	render(ctx) {
		const schema = ctx.schema;
		if (!schema) return;
		const root = ctx.el.createDiv({ cls: 'ws-facts' });
		const paint = () => {
			root.empty();
			const e = currentEntity(ctx);
			if (!e) return;
			const chosen = Array.isArray(ctx.config.fields) ? strList(ctx.config.fields) : schema.display.cardFields;
			const fields = pickFields(schema, chosen).slice(0, 6);
			if (!fields.length) {
				emptyState(root, { icon: 'gallery-horizontal-end', title: 'Choose the fields to show here', body: 'Open this widget’s settings in Customize.', compact: true });
				return;
			}
			root.style.setProperty('--ws-facts', String(fields.length));
			for (const f of fields) {
				const tile = root.createDiv({ cls: cx('ws-fact', schema.color && `ws-tint--${schema.color}`), attr: { 'data-field': f.id, tabindex: '0', role: 'button' } });
				tile.createDiv({ cls: 'ws-fact__label', text: f.label });
				const val = tile.createDiv({ cls: 'ws-fact__value' });
				if (!showValue(ctx, val, e, f)) {
					tile.addClass('is-empty');
					val.setText('—');
				}
				setTooltip(tile, `Edit ${f.label}`, { delay: 600 });
				const go = () => revealField(ctx.el, f.id);
				tile.addEventListener('click', (ev) => {
					if ((ev.target as HTMLElement).closest('a, button')) return;
					go();
				});
				tile.addEventListener('keydown', (ev) => ev.key === 'Enter' && go());
			}
		};
		paint();
		watchAll(ctx, paint);
	},
};

// ── Quote ──────────────────────────────────────────────────────────────────────

export const quoteBlock: BlockDefinition = {
	id: 'quote',
	name: 'Quote',
	icon: 'quote',
	category: 'Showcase',
	description: 'One text field shown as a pull quote — a motto, a creed, a famous line.',
	hint: 'A text field as a pull quote',
	surfaces: ['entity'],
	frame: 'plain',
	defaultSize: { w: 8, h: 1 },
	defaultConfig: { field: null, attribution: true },
	configFields: (_s, scope) => [
		{ id: 'field', type: 'select', label: 'Field', config: { options: fieldsOf(scope, TEXT_KINDS) } },
		{ id: 'attribution', type: 'boolean', label: 'Show who it’s from' },
	],
	render(ctx) {
		const schema = ctx.schema;
		if (!schema) return;
		const root = ctx.el.createDiv({ cls: cx('ws-quote', schema.color && `ws-tint--${schema.color}`) });
		const paint = () => {
			root.empty();
			const e = currentEntity(ctx);
			if (!e) return;
			const wanted = typeof ctx.config.field === 'string' ? schema.fields.find((f) => f.id === ctx.config.field) : undefined;
			const f = wanted ?? schema.fields.find((x) => TEXT_KINDS.includes(x.type) && x.type !== 'text' && !ctx.ws.fieldTypes.isEmpty(x, e.values[x.id]));
			const text = f ? ctx.ws.fieldTypes.toText(f, ctx.session.values.get(e, f)).trim() : '';
			icon(root, 'quote', 'ws-quote__mark');
			const body = root.createDiv({ cls: cx('ws-quote__text', !text && 'is-empty') });
			if (text) body.setText(text);
			else {
				body.setText(f ? `Nothing in “${f.label}” yet.` : 'Choose a text field in this widget’s settings.');
				if (f) {
					const fid = f.id;
					body.addClass('is-link');
					body.addEventListener('click', () => revealField(ctx.el, fid));
				}
			}
			if (text && ctx.config.attribution !== false) root.createDiv({ cls: 'ws-quote__by', text: `— ${e.name}` });
		};
		paint();
		watchAll(ctx, paint);
	},
};

// ── Stat block ─────────────────────────────────────────────────────────────────

export const statBlockBlock: BlockDefinition = {
	id: 'stat-block',
	name: 'Stat block',
	icon: 'bar-chart-horizontal',
	category: 'Showcase',
	description: 'Number, percentage and rating fields as labelled bars — strength, loyalty, danger…',
	hint: 'Numbers as labelled bars',
	surfaces: ['entity'],
	frame: 'card',
	defaultSize: { w: 4, h: 1 },
	defaultConfig: { fields: null, max: 10, showEmpty: true },
	configFields: (_s, scope) => [
		{ id: 'fields', type: 'multiselect', label: 'Fields', width: 'full', config: { options: fieldsOf(scope, NUMERIC_KINDS) } },
		{ id: 'max', type: 'number', label: 'Bar maximum for plain numbers', description: 'Used when a number field has no maximum of its own.', config: { min: 1 } },
		{ id: 'showEmpty', type: 'boolean', label: 'Show empty stats' },
	],
	title: () => 'Stats',
	render(ctx) {
		const schema = ctx.schema;
		if (!schema) return;
		const root = ctx.el.createDiv({ cls: cx('ws-statblock', schema.color && `ws-tint--${schema.color}`) });
		const paint = () => {
			root.empty();
			const e = currentEntity(ctx);
			if (!e) return;
			const chosen = Array.isArray(ctx.config.fields) ? strList(ctx.config.fields) : schema.fields.filter((f) => NUMERIC_KINDS.includes(f.type) && f.type !== 'number').map((f) => f.id);
			const fields = pickFields(schema, chosen).filter((f) => NUMERIC_KINDS.includes(f.type));
			if (!fields.length) {
				emptyState(root, {
					icon: 'bar-chart-horizontal',
					title: 'No stats yet',
					body: `Add Number, Percentage or Rating fields to ${schema.plural} in Type Studio, then pick them in this widget’s settings.`,
					compact: true,
				});
				return;
			}
			let shown = 0;
			for (const f of fields) {
				const raw = e.values[f.id];
				const v = typeof raw === 'number' && Number.isFinite(raw) ? raw : null;
				if (v === null && ctx.config.showEmpty === false) continue;
				const fmax = typeof f.config?.max === 'number' ? (f.config.max) : null;
				const fmin = typeof f.config?.min === 'number' ? (f.config.min) : 0;
				const max = f.type === 'percent' ? 100 : f.type === 'rating' ? (fmax ?? 5) : (fmax ?? (typeof ctx.config.max === 'number' && ctx.config.max > 0 ? ctx.config.max : 10));
				const min = f.type === 'number' ? Math.min(fmin, 0) : 0;
				const ratio = v === null ? 0 : Math.max(0, Math.min(1, (v - min) / Math.max(1e-9, max - min)));
				const row = root.createDiv({ cls: cx('ws-stat-row', v === null && 'is-empty'), attr: { 'data-field': f.id, role: 'button', tabindex: '0' } });
				row.createDiv({ cls: 'ws-stat-row__label', text: f.label });
				const bar = row.createDiv({ cls: 'ws-stat-row__bar', attr: { role: 'meter', 'aria-valuemin': String(min), 'aria-valuemax': String(max), 'aria-valuenow': String(v ?? min), 'aria-label': f.label } });
				bar.createDiv({ cls: 'ws-stat-row__fill' }).style.width = `${ratio * 100}%`;
				const unit = typeof f.config?.unit === 'string' && f.config.unit ? ` ${f.config.unit}` : '';
				row.createDiv({ cls: 'ws-stat-row__value', text: v === null ? '—' : f.type === 'percent' ? `${v}%` : f.type === 'rating' ? `${v}/${max}` : `${v}${unit}` });
				const go = () => revealField(ctx.el, f.id);
				row.addEventListener('click', go);
				row.addEventListener('keydown', (ev) => ev.key === 'Enter' && go());
				shown++;
			}
			if (!shown) emptyState(root, { icon: 'bar-chart-horizontal', title: 'No values yet', compact: true });
		};
		paint();
		watchAll(ctx, paint);
	},
};

// ── Image spotlight ────────────────────────────────────────────────────────────

// The named sources, or a gallery image's id (any other string).
	type ImageSource = 'auto' | 'portrait' | 'banner' | 'gallery' | (string & Record<never, never>);

export const imageSpotlightBlock: BlockDefinition = {
	id: 'image-spotlight',
	name: 'Image spotlight',
	icon: 'image',
	category: 'Showcase',
	description: 'One image shown large with its caption — a portrait, a gallery picture or a map.',
	hint: 'One image, shown large',
	surfaces: ['entity'],
	frame: 'plain',
	defaultSize: { w: 6, h: 1 },
	defaultConfig: { source: 'auto', index: 1, aspect: 'landscape', caption: true },
	configFields: (_s, scope) => [
		{
			id: 'source',
			type: 'select',
			label: 'Image',
			config: {
				options: [
					{ id: 'auto', label: 'First gallery image, else the portrait' },
					{ id: 'portrait', label: 'Portrait' },
					{ id: 'banner', label: 'Banner' },
					{ id: 'gallery', label: 'Gallery image (by number)' },
					...fieldsOf(scope, ['image', 'gallery']).map((o) => ({ id: `field:${o.id}`, label: `Field: ${o.label}` })),
				],
			},
		},
		{ id: 'index', type: 'number', label: 'Gallery image number', config: { min: 1 } },
		{ id: 'aspect', type: 'select', label: 'Shape', config: { options: [{ id: 'landscape', label: 'Landscape (3:2)' }, { id: 'wide', label: 'Wide (16:9)' }, { id: 'square', label: 'Square' }, { id: 'portrait', label: 'Portrait (3:4)' }, { id: 'original', label: 'Original' }] } },
		{ id: 'caption', type: 'boolean', label: 'Show the caption' },
	],
	render(ctx) {
		const schema = ctx.schema;
		if (!schema || !ctx.entity) return;
		const media = new EntityMediaActions(ctx.ws, ctx.session, ctx.entity.id);
		const aspect = ['landscape', 'wide', 'square', 'portrait', 'original'].includes(ctx.config.aspect as string) ? (ctx.config.aspect as string) : 'landscape';
		const root = ctx.el.createDiv({ cls: cx('ws-spot', `ws-spot--${aspect}`) });
		const resolve = (e: EntityRecord): { ref: ImageRef; all: ImageRef[]; index: number } | null => {
			const src = (typeof ctx.config.source === 'string' ? ctx.config.source : 'auto');
			const gallery = e.media.gallery;
			const n = Math.max(1, Math.round(typeof ctx.config.index === 'number' ? ctx.config.index : 1)) - 1;
			if (src === 'portrait') return e.media.portrait ? { ref: e.media.portrait, all: [e.media.portrait], index: 0 } : null;
			if (src === 'banner') return e.media.banner ? { ref: e.media.banner, all: [e.media.banner], index: 0 } : null;
			if (src === 'gallery') return gallery[n] ? { ref: gallery[n], all: gallery, index: n } : null;
			if (src.startsWith('field:')) {
				const v = e.values[src.slice(6)];
				const list = (Array.isArray(v) ? v : v ? [v] : []).filter((x): x is ImageRef => typeof x === 'object' && x !== null && typeof (x as ImageRef).path === 'string');
				const i = Math.min(n, Math.max(0, list.length - 1));
				return list[i] ? { ref: list[i], all: list, index: i } : null;
			}
			if (gallery[0]) return { ref: gallery[0], all: gallery, index: 0 };
			return e.media.portrait ? { ref: e.media.portrait, all: [e.media.portrait], index: 0 } : null;
		};
		const paint = () => {
			root.empty();
			const e = currentEntity(ctx);
			if (!e) return;
			const r = resolve(e);
			if (!r) {
				const empty = emptyState(root, { icon: 'image-plus', title: 'No image to show yet', body: 'Add a portrait or gallery images, or pick a source in this widget’s settings.', actionLabel: 'Add a portrait', actionIcon: 'image-plus', onAction: () => media.pickPortrait(), compact: true });
				empty.addClass('ws-spot__empty');
				return;
			}
			const frame = root.createEl('button', { cls: 'ws-spot__frame', attr: { type: 'button', 'aria-label': `View ${r.ref.caption || 'image'} full size` } });
			vaultImage(frame, ctx.app, aspect === 'original' ? { path: r.ref.path, caption: r.ref.caption } : r.ref, 'ws-spot__img');
			frame.addEventListener('click', () => new Lightbox(ctx.ws, { items: () => r.all, index: r.index, title: e.name }).open());
			if (ctx.config.caption !== false && r.ref.caption) root.createDiv({ cls: 'ws-spot__caption', text: r.ref.caption });
		};
		paint();
		watchEntity(ctx, () => paint(), (k) => k === 'media' || k.startsWith('values.'));
	},
};

// ── Single field ───────────────────────────────────────────────────────────────

export const singleFieldBlock: BlockDefinition = {
	id: 'single-field',
	name: 'Single field',
	icon: 'text-cursor-input',
	category: 'Showcase',
	description: 'One field in its own card, edited in place — give Appearance or Backstory room to breathe.',
	hint: 'One field in its own card',
	surfaces: ['entity'],
	frame: 'card',
	defaultSize: { w: 8, h: 1 },
	defaultConfig: { field: null },
	configFields: (_s, scope) => [{ id: 'field', type: 'select', label: 'Field', config: { options: fieldsOf(scope) } }],
	title: (ctx) => {
		const f = ctx.schema?.fields.find((x) => x.id === ctx.config.field);
		return f?.label ?? 'Single field';
	},
	render(ctx) {
		const schema = ctx.schema;
		const entity = ctx.entity;
		if (!schema || !entity) return;
		const s = ctx.session;
		const field = schema.fields.find((f) => f.id === ctx.config.field);
		if (!field) {
			emptyState(ctx.el, { icon: 'text-cursor-input', title: 'Choose a field', body: 'Pick which field this card shows in its settings (Customize → gear).', compact: true });
			return;
		}
		const type = ctx.ws.fieldTypes.for(field);
		const root = ctx.el.createDiv({ cls: 'ws-single-field ws-props ws-props--grid', attr: { 'data-field-id': field.id } });
		const row = root.createDiv({ cls: 'ws-prop ws-prop--full', attr: { 'data-field-id': field.id } });
		if (field.description) row.createDiv({ cls: 'ws-fm__hint ws-single-field__desc', text: field.description });
		const valueEl = row.createDiv({ cls: 'ws-prop__value' });
		const msg = row.createDiv({ cls: 'ws-prop__msg' });
		const mark = (e: EntityRecord) => row.toggleClass('is-empty', ctx.ws.fieldTypes.isEmpty(field, s.values.get(e, field)));
		if (!type.ui) {
			valueEl.setText('This field type has no editor.');
			return;
		}
		const handle = type.ui.createEditor(valueEl, {
			app: ctx.app,
			field,
			entity,
			component: ctx.component,
			host: { ws: ctx.ws, session: s, navigate: (r, nl) => ctx.navigate(r, nl) },
			value: s.values.get(entity, field),
			readOnly: type.computed,
			onChange: (v) => {
				const res = s.entityService.setFieldValue(entity.id, field.id, v);
				row.toggleClass('is-invalid', !res.ok);
				msg.setText(res.error ?? res.warning ?? '');
			},
		});
		mark(entity);
		watchEntity(ctx, (e, keys) => {
			if (keys.includes(`values.${field.id}`)) handle.setValue(e.values[field.id]);
			mark(e);
		});
	},
};

// ── Heading & divider ──────────────────────────────────────────────────────────

export const headingBlock: BlockDefinition = {
	id: 'heading',
	name: 'Heading',
	icon: 'heading',
	category: 'Showcase',
	description: 'A title line or a divider that splits a long page into parts.',
	hint: 'A title or divider between parts',
	surfaces: ['entity'],
	frame: 'plain',
	defaultSize: { w: 12, h: 1 },
	defaultConfig: { text: 'New part', subtitle: '', style: 'heading' },
	configFields: [
		{ id: 'text', type: 'text', label: 'Heading', description: '“{name}” is replaced with the entry’s name.' },
		{ id: 'subtitle', type: 'text', label: 'Subtitle' },
		{ id: 'style', type: 'select', label: 'Style', config: { options: [{ id: 'heading', label: 'Heading with a rule' }, { id: 'centered', label: 'Centred heading' }, { id: 'divider', label: 'Divider only' }] } },
	],
	render(ctx) {
		const style = ['heading', 'centered', 'divider'].includes(ctx.config.style as string) ? (ctx.config.style as string) : 'heading';
		const root = ctx.el.createDiv({ cls: cx('ws-heading', `ws-heading--${style}`, ctx.schema?.color && `ws-tint--${ctx.schema.color}`) });
		const paint = () => {
			root.empty();
			const e = currentEntity(ctx);
			const raw = typeof ctx.config.text === 'string' ? ctx.config.text : '';
			const text = raw.replace(/\{name\}/g, e?.name ?? '');
			if (style !== 'divider' && text) {
				const t = root.createDiv({ cls: 'ws-heading__text' });
				t.createEl('h2', { cls: 'ws-heading__title', text });
				const sub = typeof ctx.config.subtitle === 'string' ? ctx.config.subtitle.replace(/\{name\}/g, e?.name ?? '') : '';
				if (sub) t.createDiv({ cls: 'ws-heading__sub', text: sub });
			}
			root.createDiv({ cls: 'ws-heading__rule' });
		};
		paint();
		watchEntity(ctx, paint, (k) => k === 'name');
	},
};

