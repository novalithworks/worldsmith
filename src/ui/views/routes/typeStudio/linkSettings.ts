import { Notice } from 'obsidian';
import type { WorldsmithContext } from '../../../../app/context';
import type { EntitySchema, FieldDefinition, RelationType } from '../../../../core/types';
import { LINK_KINDS, ROLLUP_AGGREGATES, rollupConfig } from '../../../../services/FieldValues';
import { relationConfig } from '../../../../services/RelationService';
import type { WorldSession } from '../../../../services/WorldSession';
import { ROUTES } from '../../../../state/route';
import { button, cx } from '../../../components/dom';
import { confirmModal, promptModal } from '../../../components/modals';
import { applyEdit, formRow, inlineText, segmented, typePicker } from './common';

/**
 * Settings for link kinds in the field settings dialog: what a relation field links to
 * and through which relationship, and what a rollup summarises.
 */

/** Give a fresh relation/rollup field a working configuration. */
export function setupLinkField(s: WorldSession, typeId: string, fieldId: string): void {
	const schema = s.schemas.get(typeId);
	const f = schema?.fields.find((x) => x.id === fieldId);
	if (!schema || !f) return;
	if (f.type === 'relation' && !relationConfig(f).relationType) {
		const type = s.relations.createType({ label: f.label, forwardLabel: f.label, reverseLabel: `${f.label} of`, sourceTypes: [typeId] });
		applyEdit(() => s.schemaEdits.updateFieldConfig(typeId, fieldId, { relationType: type.id, direction: 'forward', targetTypes: [] }));
	}
	if (f.type === 'rollup' && !rollupConfig(f).relationField) {
		const via = schema.fields.find((x) => LINK_KINDS.has(x.type));
		applyEdit(() => s.schemaEdits.updateFieldConfig(typeId, fieldId, { relationField: via?.id ?? null, aggregate: 'count' }));
	}
}

/** Label the linked entries are listed under, on the other entry's page. */
export function otherSideLabel(type: RelationType | undefined, direction: 'forward' | 'reverse'): string {
	if (!type) return '';
	if (type.symmetric) return type.forwardLabel;
	return direction === 'forward' ? type.reverseLabel : type.forwardLabel;
}

/** A settings row: label and hint on the left, the control on the right. */
function row(parent: HTMLElement, label: string, hint?: string): HTMLElement {
	const c = formRow(parent, label, hint);
	c.addClass('ws-fm__control');
	return c;
}

export function renderRelationSettings(
	group: HTMLElement,
	ws: WorldsmithContext,
	s: WorldSession,
	schema: EntitySchema,
	f: FieldDefinition,
	close: () => void,
): void {
	const E = s.schemaEdits;
	const R = s.relations;
	const cfg = relationConfig(f);
	const type = R.type(cfg.relationType);
	const save = (patch: Record<string, unknown>) => applyEdit(() => E.updateFieldConfig(schema.id, f.id, patch));

	// Links to
	typePicker(
		row(group, 'Links to', 'Which kinds of entries can be picked. Empty = any.'),
		s,
		cfg.targetTypes,
		(next) => save({ targetTypes: next.length ? next : [] }),
		'Any kind of entry',
	);

	// How many
	segmented(
		row(group, 'How many', 'One link, or a list of them.'),
		[
			{ id: 'one', label: 'One' },
			{ id: 'many', label: 'Many' },
		],
		cfg.max === 1 ? 'one' : 'many',
		(v) => save({ max: v === 'one' ? 1 : null }),
		'How many links',
	);

	// Relationship
	const relSlot = row(group, 'Relationship', 'The kind of connection this field makes. Fields on both entries share it.');
	const sel = relSlot.createEl('select', { cls: 'ws-input dropdown ws-fm__select', attr: { 'aria-label': 'Relationship' } });
	const byCat = new Map<string, RelationType[]>();
	for (const t of R.types()) {
		const list = byCat.get(t.category) ?? [];
		list.push(t);
		byCat.set(t.category, list);
	}
	if (!type) sel.createEl('option', { text: 'Choose…', value: '' });
	for (const [cat, list] of byCat) {
		const og = sel.createEl('optgroup', { attr: { label: cat } });
		for (const t of list) og.createEl('option', { text: t.symmetric ? t.label : `${t.label} (${t.forwardLabel} / ${t.reverseLabel})`, value: t.id });
	}
	sel.createEl('option', { text: 'New relationship…', value: '__new' });
	sel.value = type?.id ?? '';
	sel.addEventListener('change', () => void (async () => {
		const v = sel.value;
		if (v === '__new') {
			const name = await promptModal(ws.app, { title: 'New relationship', label: 'Name', placeholder: 'e.g. Oath of fealty', confirmLabel: 'Create' });
			if (!name?.trim()) {
				sel.value = type?.id ?? '';
				return;
			}
			const t = R.createType({ label: name.trim(), forwardLabel: f.label, reverseLabel: `${f.label} of`, sourceTypes: [schema.id], targetTypes: cfg.targetTypes });
			await switchTo(t.id);
			return;
		}
		await switchTo(v);
	})());
	const switchTo = async (typeId: string) => {
		if (typeId === cfg.relationType) return;
		const linked = s.entities.all().filter((e) => e.typeId === schema.id).reduce((n, e) => n + R.fieldViews(e.id, f).length, 0);
		if (linked) {
			const ok = await confirmModal(ws.app, {
				title: `Switch “${f.label}” to another relationship?`,
				body: `${linked} existing link${linked === 1 ? '' : 's'} stay as they are and keep showing under Connections — they just won’t appear in this field.`,
				confirmLabel: 'Switch',
			});
			if (!ok) {
				sel.value = type?.id ?? '';
				return;
			}
		}
		save({ relationType: typeId, direction: 'forward' });
	};

	if (!type) return;

	// Which side
	if (!type.symmetric) {
		segmented(
			row(group, 'This field lists', `Both sides of “${type.label}”. Pick which one this field shows.`),
			[
				{ id: 'forward', label: type.forwardLabel },
				{ id: 'reverse', label: type.reverseLabel },
			],
			cfg.direction,
			(v) => save({ direction: v }),
			'Direction',
		);
	}

	// How it appears on the other side (shared relationship label)
	const other = otherSideLabel(type, cfg.direction);
	const otherSlot = row(group, 'On the linked entry', 'Where this connection appears on the other entry. Shared by every field using this relationship.');
	inlineText(otherSlot, other, {
		cls: 'ws-fm__inline-input',
		ariaLabel: 'Label on the linked entry',
		onCommit: (v) => {
			const label = v.trim();
			if (!label) return;
			try {
				if (type.symmetric) R.updateType(type.id, { forwardLabel: label });
				else if (cfg.direction === 'forward') R.updateType(type.id, { reverseLabel: label });
				else R.updateType(type.id, { forwardLabel: label });
			} catch (e) {
				new Notice(e instanceof Error ? e.message : String(e));
			}
		},
	});

	const links = row(group, 'The relationship itself', 'Its name, both labels and which types it connects.');
	button(links, {
		label: `Edit “${type.label}”`,
		icon: 'link-2',
		variant: 'quiet',
		size: 'sm',
		onClick: () => {
			close();
			void ws.open(ROUTES.relationships(type.id));
		},
	});
}

export function renderRollupSettings(group: HTMLElement, ws: WorldsmithContext, s: WorldSession, schema: EntitySchema, f: FieldDefinition): void {
	const E = s.schemaEdits;
	const cfg = rollupConfig(f);
	const save = (patch: Record<string, unknown>) => applyEdit(() => E.updateFieldConfig(schema.id, f.id, patch));
	const linkFields = schema.fields.filter((x) => LINK_KINDS.has(x.type) && x.id !== f.id);

	const viaSlot = row(group, 'Over', 'Which linked entries to summarise.');
	if (!linkFields.length) {
		viaSlot.createDiv({ cls: 'ws-fm__hint ws-fm__warn', text: `Add a relation field to ${schema.plural} first.` });
		return;
	}
	const via = viaSlot.createEl('select', { cls: 'ws-input dropdown ws-fm__select', attr: { 'aria-label': 'Linked entries' } });
	if (!cfg.relationField) via.createEl('option', { text: 'Choose…', value: '' });
	for (const lf of linkFields) via.createEl('option', { text: lf.label, value: lf.id });
	via.value = cfg.relationField ?? '';
	via.addEventListener('change', () => save({ relationField: via.value || null, targetField: null }));

	const agg = row(group, 'Calculate', 'What to work out from them.').createEl('select', { cls: 'ws-input dropdown ws-fm__select', attr: { 'aria-label': 'Calculation' } });
	for (const a of ROLLUP_AGGREGATES) agg.createEl('option', { text: a.label, value: a.id });
	agg.value = cfg.aggregate;
	agg.addEventListener('change', () => save({ aggregate: agg.value }));

	const spec = ROLLUP_AGGREGATES.find((a) => a.id === cfg.aggregate);
	if (!spec || spec.needs === 'none') return;

	// Candidate fields on the linked types.
	const viaField = schema.fields.find((x) => x.id === cfg.relationField);
	let targetTypes: string[] = [];
	if (viaField?.type === 'relation') targetTypes = relationConfig(viaField).targetTypes;
	else if (viaField?.type === 'parent') targetTypes = schema.hierarchy.parentTypes;
	else if (viaField?.type === 'children') targetTypes = schema.hierarchy.childTypes;
	const schemas = (targetTypes.length ? targetTypes.map((id) => s.schemas.get(id)) : s.schemas.list()).filter((x): x is EntitySchema => !!x);
	const fits = (fd: FieldDefinition) => {
		const k = ws.fieldTypes.for(fd);
		if (spec.needs === 'number') return ['number', 'percent', 'rating', 'progress'].includes(fd.type) || (fd.type === 'rollup' && rollupConfig(fd).aggregate !== 'list');
		if (spec.needs === 'date') return fd.type === 'chrono';
		return k.category !== 'media' && fd.type !== 'formula';
	};
	const seen = new Map<string, string>();
	for (const sc of schemas) for (const fd of sc.fields) if (fits(fd) && !seen.has(fd.id)) seen.set(fd.id, schemas.length > 1 ? `${fd.label} (${sc.singular})` : fd.label);
	const of = row(group, 'Of', 'The field on the linked entries it uses.').createEl('select', { cls: 'ws-input dropdown ws-fm__select', attr: { 'aria-label': 'Field to summarise' } });
	if (spec.needs === 'any') of.createEl('option', { text: 'Name', value: '__name' });
	else if (!cfg.targetField) of.createEl('option', { text: 'Choose a field…', value: '' });
	for (const [id, label] of seen) of.createEl('option', { text: label, value: id });
	of.value = cfg.targetField ?? (spec.needs === 'any' ? '__name' : '');
	of.addEventListener('change', () => save({ targetField: of.value || null }));
	if (!seen.size && spec.needs !== 'any') group.createDiv({ cls: cx('ws-fm__hint', 'ws-fm__warn', 'ws-fm__note-row'), text: 'The linked entries have no fields this calculation can use.' });
}
