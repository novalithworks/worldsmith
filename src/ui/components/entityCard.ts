import { setIcon, type App } from 'obsidian';
import type { EntityRecord, EntitySchema, FieldDefinition } from '../../core/types';
import type { FieldTypeRegistry } from '../../fields/FieldTypeRegistry';
import { vaultImage } from '../../fields/ui/media';
import type { WorldSession } from '../../services/WorldSession';
import { avatar } from './avatar';
import { showsValue, type FieldValues } from '../../services/FieldValues';
import { cx } from './dom';

/** Card fields of a schema that can be displayed (links and rollups included). */
export function cardFieldsOf(schema: EntitySchema, fieldTypes: FieldTypeRegistry): FieldDefinition[] {
	return schema.display.cardFields
		.map((id) => schema.fields.find((f) => f.id === id))
		.filter((f): f is FieldDefinition => !!f && showsValue(fieldTypes.for(f)));
}

/**
 * The database card. Shared by the database page and Type Studio's live preview, so the
 * preview is exactly what you'll get.
 */
export function renderEntityCard(
	container: HTMLElement,
	o: {
		app: App;
		session: WorldSession;
		fieldTypes: FieldTypeRegistry;
		schema: EntitySchema;
		entity: EntityRecord;
		cardImage: 'portrait' | 'banner' | 'none';
		/** Facts to show (a saved view's choice); default = the type's card fields. */
		fields?: FieldDefinition[];
	},
): HTMLElement {
	const { app, session: s, schema, entity: e, fieldTypes } = o;
	const card = container.createDiv({ cls: cx('ws-card', schema.color ? `ws-tint--${schema.color}` : '', o.cardImage === 'none' && 'ws-card--no-image') });
	const useBanner = o.cardImage === 'banner' && e.media.banner;
	if (o.cardImage !== 'none') {
		const media = card.createDiv({ cls: cx('ws-card__media', useBanner ? 'ws-card__media--banner' : '') });
		if (useBanner && e.media.banner) vaultImage(media, app, e.media.banner, 'ws-card__banner');
		else avatar(media, app, e, schema, { shape: 'arch', size: 'lg' });
	}
	if (e.flags.favorite) {
		const star = card.createSpan({ cls: 'ws-card__fav', attr: { 'aria-label': 'Favorite' } });
		setIcon(star, 'star');
	}
	const body = card.createDiv({ cls: 'ws-card__body' });
	body.createDiv({ cls: 'ws-card__name', text: e.name });
	const sub = subtitleFor(e, schema, fieldTypes, s.values);
	if (sub) body.createDiv({ cls: 'ws-card__subtitle', text: sub });
	const facts = body.createDiv({ cls: 'ws-card__facts' });
	for (const f of o.fields ?? cardFieldsOf(schema, fieldTypes)) {
		if (schema.display.subtitleFields.includes(f.id)) continue;
		const text = fieldTypes.toText(f, s.values.get(e, f));
		if (!text) continue;
		const row = facts.createDiv({ cls: 'ws-card__fact' });
		row.createSpan({ cls: 'ws-card__fact-label', text: f.label });
		row.createSpan({ cls: 'ws-card__fact-value', text });
	}
	const foot = card.createDiv({ cls: 'ws-card__foot' });
	const status = s.world.statuses.find((x) => x.id === e.status);
	const dot = foot.createSpan({ cls: ['ws-card__status', `ws-tint--${status?.color ?? 'gray'}`] });
	dot.createSpan({ cls: 'ws-status__dot' });
	dot.createSpan({ text: status?.label ?? '' });
	const c = s.entityService.progress(e);
	const prog = foot.createDiv({ cls: 'ws-card__progress', attr: { 'aria-label': `${Math.round(c.ratio * 100)}% developed` } });
	const barEl = prog.createDiv({ cls: 'ws-bar ws-bar--thin' });
	barEl.createDiv({ cls: 'ws-bar__fill' }).style.width = `${Math.round(c.ratio * 100)}%`;
	prog.createSpan({ text: `${Math.round(c.ratio * 100)}%` });
	return card;
}

/** Subtitle using a given schema (lets previews use an unsaved/alternate schema). */
export function subtitleFor(e: EntityRecord, schema: EntitySchema, fieldTypes: FieldTypeRegistry, values?: FieldValues): string {
	return schema.display.subtitleFields
		.map((id) => schema.fields.find((f) => f.id === id))
		.filter((f): f is FieldDefinition => !!f)
		.map((f) => fieldTypes.toText(f, values ? values.get(e, f) : e.values[f.id]))
		.filter(Boolean)
		.join(' • ');
}
