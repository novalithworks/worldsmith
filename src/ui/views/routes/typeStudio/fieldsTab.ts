import { openPropertyPicker } from '../../../components/propertyPicker';
import { Menu, setIcon, setTooltip } from 'obsidian';
import type { WorldsmithContext } from '../../../../app/context';
import type { EntitySchema, FieldDefinition, SectionDefinition } from '../../../../core/types';
import type { WorldSession } from '../../../../services/WorldSession';
import { button, cx, emptyState, icon } from '../../../components/dom';
import { confirmModal, IconPickerModal, promptModal } from '../../../components/modals';
import { AddFieldModal } from './AddFieldModal';
import { applyEdit, confirmDeleteField, inlineText, studioCard, undoNotice } from './common';
import { FieldSettingsModal } from './FieldSettingsModal';
import { otherSideLabel, setupLinkField } from './linkSettings';
import { relationConfig } from '../../../../services/RelationService';

const UNSECTIONED = '__unsectioned';

/** “20 fields · 4 count toward progress”, for a section's header. */
function sectionBlurb(fields: FieldDefinition[]): string {
	const parts = [`${fields.length} field${fields.length === 1 ? '' : 's'}`];
	const counts = fields.filter((f) => f.recommended).length;
	if (counts) parts.push(`${counts} count${counts === 1 ? 's' : ''} toward progress`);
	const hidden = fields.filter((f) => f.hidden).length;
	if (hidden) parts.push(`${hidden} hidden`);
	return parts.join(' · ');
}

/**
 * The structure editor: sections as cards, fields as rows.
 *
 * Reordering works three ways so it never depends on a mouse: drag and drop (desktop),
 * Alt+↑/↓ on a focused row, and the row menu (Move up / down / to section).
 */
export function renderFieldsTab(el: HTMLElement, ws: WorldsmithContext, s: WorldSession, schema: EntitySchema, focusSection?: string): void {
	const E = s.schemaEdits;
	const kindSummary = (f: FieldDefinition) => kindSummaryFor(ws, s, f);
	const typeId = schema.id;
	const root = el.createDiv({ cls: 'ws-structure' });
	// Overview: what a type is made of, at a glance, with the two ways to grow it.
	const ov = studioCard(root, 'Fields & sections', 'list', `Everything a ${schema.singular.toLowerCase()} can hold, grouped into sections. Drag rows to reorder, or select one and press Alt+↑/↓.`, 'ws-structure__overview');
	button(ov.aside, { label: 'Add field', icon: 'plus', variant: 'ghost', size: 'sm', onClick: () => openAddField(ws, s, schema, schema.sections[schema.sections.length - 1]?.id ?? null) });
	button(ov.aside, { label: 'Add section', icon: 'folder-plus', variant: 'ghost', size: 'sm', onClick: () => void newSection() });
	const stats = ov.body.createDiv({ cls: 'ws-structure__stats' });
	const stat = (n: number, label: string, glyph: string) => {
		const st = stats.createDiv({ cls: 'ws-structure__stat' });
		icon(st, glyph);
		st.createSpan({ cls: 'ws-structure__stat-n', text: String(n) });
		st.createSpan({ cls: 'ws-structure__stat-label', text: label });
	};
	stat(schema.fields.length, schema.fields.length === 1 ? 'field' : 'fields', 'list');
	stat(schema.sections.length, schema.sections.length === 1 ? 'section' : 'sections', 'folder');
	stat(schema.fields.filter((f) => f.recommended).length, 'count toward progress', 'gauge');
	const req = schema.fields.filter((f) => f.required).length;
	if (req) stat(req, 'required', 'asterisk');
	const adv = schema.fields.filter((f) => f.advanced).length;
	if (adv) stat(adv, 'under “More fields”', 'chevrons-down');

	const sectioned = new Set(schema.sections.flatMap((x) => x.fieldIds));
	const unsectioned = schema.fields.filter((f) => !sectioned.has(f.id));
	const blocks: Array<{ section: SectionDefinition | null; fields: FieldDefinition[] }> = schema.sections.map((sec) => ({
		section: sec,
		fields: sec.fieldIds.map((id) => schema.fields.find((f) => f.id === id)).filter((f): f is FieldDefinition => !!f),
	}));
	if (unsectioned.length) blocks.push({ section: null, fields: unsectioned });

	// Drag state shared by every row and section in this render.
	let drag: { kind: 'field'; fieldId: string } | { kind: 'section'; sectionId: string } | null = null;

	const moveFieldTo = (fieldId: string, targetSection: string | null, index: number) => {
		const fromSection = schema.sections.find((x) => x.fieldIds.includes(fieldId))?.id ?? null;
		let idx = index;
		if (fromSection === targetSection) {
			const list = targetSection ? schema.sections.find((x) => x.id === targetSection)!.fieldIds : unsectioned.map((f) => f.id);
			const from = list.indexOf(fieldId);
			if (from >= 0 && from < idx) idx--;
			if (from === idx) return;
		}
		applyEdit(() => E.moveField(typeId, fieldId, targetSection, idx));
	};

	blocks.forEach((block, bi) => {
		const sec = block.section;
		const secId = sec?.id ?? UNSECTIONED;
		const card = root.createDiv({ cls: cx('ws-sec-card', !sec && 'is-unsectioned', sec?.advanced && 'is-advanced'), attr: { 'data-section': secId } });
		if (focusSection && focusSection === sec?.id) card.addClass('is-focus');

		// ── section header
		const head = card.createDiv({ cls: 'ws-sec-card__head' });
		if (sec) {
			const handle = head.createSpan({ cls: 'ws-drag-handle', attr: { draggable: 'true', 'aria-hidden': 'true' } });
			setIcon(handle, 'grip-vertical');
			handle.addEventListener('dragstart', (e) => {
				drag = { kind: 'section', sectionId: sec.id };
				e.dataTransfer?.setData('text/plain', sec.id);
				e.dataTransfer?.setDragImage(card, 20, 20);
				card.addClass('is-dragging');
			});
			handle.addEventListener('dragend', () => {
				card.removeClass('is-dragging');
				drag = null;
			});
			const iconBtn = head.createEl('button', { cls: 'ws-sec-card__icon', attr: { type: 'button', 'aria-label': 'Section icon' } });
			setIcon(iconBtn, sec.icon || 'folder');
			setTooltip(iconBtn, 'Change icon');
			iconBtn.addEventListener('click', () => new IconPickerModal(ws.app, (id) => applyEdit(() => E.updateSection(typeId, sec.id, { icon: id }))).open());
			const titles = head.createDiv({ cls: 'ws-sec-card__titles' });
			inlineText(titles, sec.label, {
				cls: 'ws-sec-card__title',
				ariaLabel: 'Section name',
				onCommit: (v) => applyEdit(() => E.updateSection(typeId, sec.id, { label: v })),
			});
			titles.createDiv({ cls: 'ws-sec-card__blurb', text: sectionBlurb(block.fields) });
			const badges = head.createDiv({ cls: 'ws-sec-card__badges' });
			if (sec.collapsed) badges.createSpan({ cls: 'ws-badge', text: 'Starts collapsed' });
			if (sec.advanced) badges.createSpan({ cls: 'ws-badge', text: 'Advanced' });
		} else {
			const ic = head.createSpan({ cls: 'ws-sec-card__icon is-static' });
			setIcon(ic, 'more-horizontal');
			const titles = head.createDiv({ cls: 'ws-sec-card__titles' });
			titles.createDiv({ cls: 'ws-sec-card__title is-static', text: 'Other' });
			titles.createDiv({ cls: 'ws-sec-card__blurb', text: `Not in any section · ${sectionBlurb(block.fields)}` });
		}
		if (sec) {
			button(head, {
				icon: 'more-horizontal',
				variant: 'quiet',
				size: 'sm',
				tooltip: 'Section options',
				onClick: (evt) => sectionMenu(evt, sec, bi),
			});
		}

		// Section reorder drop zone (whole card).
		if (sec) {
			card.addEventListener('dragover', (e) => {
				if (drag?.kind !== 'section') return;
				e.preventDefault();
				const r = card.getBoundingClientRect();
				const after = e.clientY > r.top + r.height / 2;
				card.toggleClass('is-drop-before', !after);
				card.toggleClass('is-drop-after', after);
			});
			card.addEventListener('dragleave', () => card.removeClass('is-drop-before', 'is-drop-after'));
			card.addEventListener('drop', (e) => {
				if (drag?.kind !== 'section') return;
				e.preventDefault();
				const after = card.hasClass('is-drop-after');
				card.removeClass('is-drop-before', 'is-drop-after');
				const from = schema.sections.findIndex((x) => x.id === (drag as { sectionId: string }).sectionId);
				let to = bi + (after ? 1 : 0);
				if (from < to) to--;
				if (from !== to) applyEdit(() => E.moveSection(typeId, (drag as { sectionId: string }).sectionId, to));
			});
		}

		// ── field rows
		const list = card.createDiv({ cls: 'ws-field-rows', attr: { role: 'list' } });
		block.fields.forEach((f, fi) => {
			const kind = ws.fieldTypes.for(f);
			const row = list.createDiv({ cls: cx('ws-frow-item', f.hidden && 'is-hidden-field'), attr: { role: 'listitem', tabindex: '0', draggable: 'true', 'data-field': f.id } });
			const handle = row.createSpan({ cls: 'ws-drag-handle', attr: { 'aria-hidden': 'true' } });
			setIcon(handle, 'grip-vertical');
			const ki = row.createSpan({ cls: 'ws-frow-item__kind' });
			setIcon(ki, kind.icon);
			setTooltip(ki, kind.label);
			inlineText(row, f.label, {
				cls: 'ws-frow-item__label',
				ariaLabel: 'Field name',
				onCommit: (v) => applyEdit(() => E.updateField(typeId, f.id, { label: v })),
			});
			const meta = row.createDiv({ cls: 'ws-frow-item__meta' });
			meta.createSpan({ cls: 'ws-frow-item__kindname', text: kindSummary(f) });
			if (f.required) meta.createSpan({ cls: 'ws-badge ws-badge--req', text: 'Required' });
			if (f.recommended) meta.createSpan({ cls: 'ws-badge', text: 'Counts' });
			if (f.advanced) meta.createSpan({ cls: 'ws-badge', text: 'More fields' });
			if (f.hidden) meta.createSpan({ cls: 'ws-badge', text: 'Hidden' });
			if (kind.studioNote) meta.createSpan({ cls: 'ws-badge ws-badge--soon', text: 'Soon' });
			const actions = row.createDiv({ cls: 'ws-frow-item__actions' });
			button(actions, { icon: 'settings-2', variant: 'quiet', size: 'sm', tooltip: 'Field settings', onClick: () => new FieldSettingsModal(ws, s, typeId, f.id).open() });
			button(actions, { icon: 'more-horizontal', variant: 'quiet', size: 'sm', tooltip: 'More', onClick: (evt) => fieldMenu(evt, f, sec?.id ?? null, fi, block.fields.length) });

			row.addEventListener('dblclick', (e) => {
				if ((e.target as HTMLElement).closest('input')) return;
				new FieldSettingsModal(ws, s, typeId, f.id).open();
			});
			row.addEventListener('keydown', (e) => {
				if (e.target !== row) return;
				if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
					e.preventDefault();
					const to = fi + (e.key === 'ArrowUp' ? -1 : 2);
					if (to < 0 || to > block.fields.length) return;
					moveFieldTo(f.id, sec?.id ?? null, to);
					refocus(f.id);
				} else if (e.key === 'Enter') {
					e.preventDefault();
					new FieldSettingsModal(ws, s, typeId, f.id).open();
				} else if (e.key === 'Delete' || e.key === 'Backspace') {
					e.preventDefault();
					void deleteField(f);
				}
			});
			row.addEventListener('dragstart', (e) => {
				if ((e.target as HTMLElement).closest('input')) {
					e.preventDefault();
					return;
				}
				drag = { kind: 'field', fieldId: f.id };
				e.dataTransfer?.setData('text/plain', f.id);
				row.addClass('is-dragging');
				e.stopPropagation();
			});
			row.addEventListener('dragend', () => {
				row.removeClass('is-dragging');
				drag = null;
			});
			row.addEventListener('dragover', (e) => {
				if (drag?.kind !== 'field') return;
				e.preventDefault();
				e.stopPropagation();
				const r = row.getBoundingClientRect();
				const after = e.clientY > r.top + r.height / 2;
				row.toggleClass('is-drop-before', !after);
				row.toggleClass('is-drop-after', after);
			});
			row.addEventListener('dragleave', () => row.removeClass('is-drop-before', 'is-drop-after'));
			row.addEventListener('drop', (e) => {
				if (drag?.kind !== 'field') return;
				e.preventDefault();
				e.stopPropagation();
				const after = row.hasClass('is-drop-after');
				row.removeClass('is-drop-before', 'is-drop-after');
				moveFieldTo(drag.fieldId, sec?.id ?? null, fi + (after ? 1 : 0));
			});
		});

		if (!block.fields.length) {
			const empty = list.createDiv({ cls: 'ws-field-rows__empty', text: 'No fields yet. Drop a field here or add one.' });
			void empty;
		}
		// Dropping on an empty area of the list appends to this section.
		list.addEventListener('dragover', (e) => {
			if (drag?.kind !== 'field') return;
			e.preventDefault();
			list.addClass('is-drop-zone');
		});
		list.addEventListener('dragleave', () => list.removeClass('is-drop-zone'));
		list.addEventListener('drop', (e) => {
			if (drag?.kind !== 'field') return;
			e.preventDefault();
			list.removeClass('is-drop-zone');
			moveFieldTo(drag.fieldId, sec?.id ?? null, block.fields.length);
		});

		const foot = card.createDiv({ cls: 'ws-sec-card__foot' });
		button(foot, {
			label: 'Add field',
			icon: 'plus',
			variant: 'quiet',
			size: 'sm',
			onClick: () => openAddField(ws, s, schema, sec?.id ?? null),
		});
	});

	if (!blocks.length) {
		emptyState(root, { icon: 'list-plus', title: 'No fields yet', body: 'Start with a section, then add fields to it.', compact: true });
	}

	const addSec = root.createDiv({ cls: 'ws-structure__add' });
	icon(addSec, 'folder-plus');
	addSec.createSpan({ cls: 'ws-structure__add-text', text: 'Need somewhere new for fields? Combat, Magic, Secrets…' });
	button(addSec, { label: 'Add section', icon: 'plus', variant: 'ghost', size: 'sm', onClick: () => void newSection() });

	async function newSection() {
		const name = await promptModal(ws.app, { title: 'New section', label: 'Section name', placeholder: 'e.g. Combat', confirmLabel: 'Add section' });
		if (name?.trim()) applyEdit(() => E.addSection(typeId, name.trim()));
	}

	if (focusSection) {
		window.setTimeout(() => root.querySelector(`[data-section="${focusSection}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
	}

	// ── menus ───────────────────────────────────────────────────────────────

	function refocus(fieldId: string) {
		window.setTimeout(() => (el.ownerDocument.querySelector(`.ws-frow-item[data-field="${fieldId}"]`))?.focus(), 30);
	}

	function fieldMenu(evt: MouseEvent, f: FieldDefinition, secId: string | null, index: number, count: number) {
		const menu = new Menu();
		menu.addItem((i) => i.setTitle('Field settings…').setIcon('settings-2').onClick(() => new FieldSettingsModal(ws, s, typeId, f.id).open()));
		menu.addSeparator();
		menu.addItem((i) => i.setTitle('Move up').setIcon('arrow-up').setDisabled(index === 0).onClick(() => moveFieldTo(f.id, secId, index - 1)));
		menu.addItem((i) => i.setTitle('Move down').setIcon('arrow-down').setDisabled(index >= count - 1).onClick(() => moveFieldTo(f.id, secId, index + 2)));
		for (const target of schema.sections.filter((x) => x.id !== secId)) {
			menu.addItem((i) => i.setTitle(`Move to “${target.label}”`).setIcon('corner-down-right').onClick(() => applyEdit(() => E.moveField(typeId, f.id, target.id))));
		}
		if (secId) menu.addItem((i) => i.setTitle('Remove from section').setIcon('corner-left-up').onClick(() => applyEdit(() => E.moveField(typeId, f.id, null))));
		menu.addSeparator();
		menu.addItem((i) =>
			i
				.setTitle(f.advanced ? 'Show in main area' : 'Tuck under “More fields”')
				.setIcon('list-collapse')
				.onClick(() => applyEdit(() => E.updateField(typeId, f.id, { advanced: !f.advanced }))),
		);
		menu.addItem((i) => i.setTitle(f.hidden ? 'Show field' : 'Hide field').setIcon(f.hidden ? 'eye' : 'eye-off').onClick(() => applyEdit(() => E.updateField(typeId, f.id, { hidden: !f.hidden }))));
		menu.addSeparator();
		const others = s.schemas.list().filter((t) => t.id !== typeId);
		if (others.length)
			menu.addItem((i) =>
				i
					.setTitle('Copy to another type…')
					.setIcon('copy-plus')
					.onClick(() => {
						const anchor = (evt.target as HTMLElement | null)?.closest<HTMLElement>('.ws-frow-item') ?? el;
						openPropertyPicker(anchor, {
							title: `Copy “${f.label}” to`,
							placeholder: 'Find a type…',
							items: others.map((t) => ({ id: t.id, label: t.plural, icon: t.icon })),
							onPick: (to) => {
								if (!to) return;
								const made = applyEdit(() => E.copyFieldTo(typeId, f.id, to));
								if (made) undoNotice(s, `Copied “${f.label}” to ${s.schemas.get(to)?.plural ?? 'the other type'}.`);
							},
						});
					}),
			);
		menu.addItem((i) => i.setTitle('Delete field…').setIcon('trash-2').setWarning(true).onClick(() => void deleteField(f)));
		menu.showAtMouseEvent(evt);
	}

	async function deleteField(f: FieldDefinition) {
		await confirmDeleteField(ws, s, typeId, f);
	}

	function sectionMenu(evt: MouseEvent, sec: SectionDefinition, index: number) {
		const menu = new Menu();
		menu.addItem((i) => i.setTitle('Add field here').setIcon('plus').onClick(() => openAddField(ws, s, schema, sec.id)));
		menu.addItem((i) => i.setTitle('Change icon…').setIcon('smile').onClick(() => new IconPickerModal(ws.app, (id) => applyEdit(() => E.updateSection(typeId, sec.id, { icon: id }))).open()));
		menu.addSeparator();
		menu.addItem((i) => i.setTitle('Move up').setIcon('arrow-up').setDisabled(index === 0).onClick(() => applyEdit(() => E.moveSection(typeId, sec.id, index - 1))));
		menu.addItem((i) =>
			i
				.setTitle('Move down')
				.setIcon('arrow-down')
				.setDisabled(index >= schema.sections.length - 1)
				.onClick(() => applyEdit(() => E.moveSection(typeId, sec.id, index + 1))),
		);
		menu.addSeparator();
		menu.addItem((i) => i.setTitle('Starts collapsed').setChecked(!!sec.collapsed).onClick(() => applyEdit(() => E.updateSection(typeId, sec.id, { collapsed: !sec.collapsed }))));
		menu.addSeparator();
		menu.addItem((i) =>
			i.setTitle('Delete section…').setIcon('trash-2').setWarning(true).onClick(async () => {
				const others = schema.sections.filter((x) => x.id !== sec.id);
				const n = sec.fieldIds.length;
				if (n === 0) {
					if (applyEdit(() => E.deleteSection(typeId, sec.id))) undoNotice(s, `Deleted section “${sec.label}”.`);
					return;
				}
				const target = others[0];
				const ok = await confirmModal(ws.app, {
					title: `Delete the “${sec.label}” section?`,
					body: `Its ${n} field${n === 1 ? '' : 's'} ${n === 1 ? 'is' : 'are'} kept${target ? ` and move${n === 1 ? 's' : ''} to “${target.label}”` : ' under Other'}. No data changes.`,
					confirmLabel: 'Delete section',
				});
				if (ok && applyEdit(() => E.deleteSection(typeId, sec.id, target?.id ?? null))) undoNotice(s, `Deleted section “${sec.label}”.`);
			}),
		);
		menu.showAtMouseEvent(evt);
	}
}

/** "Relation → Species", "Rollup", "Short text"… */
function kindSummaryFor(ws: WorldsmithContext, s: WorldSession, f: FieldDefinition): string {
	const kind = ws.fieldTypes.for(f);
	if (f.type !== 'relation') return kind.label;
	const cfg = relationConfig(f);
	const targets = cfg.targetTypes.map((id) => s.schemas.get(id)?.plural ?? id);
	const t = s.relations.type(cfg.relationType);
	const to = targets.length ? targets.slice(0, 2).join(', ') + (targets.length > 2 ? '…' : '') : 'any entry';
	return t ? `Links to ${to} · appears as ${otherSideLabel(t, cfg.direction)}` : 'Link · not set up';
}

export function openAddField(ws: WorldsmithContext, s: WorldSession, schema: EntitySchema, sectionId: string | null): void {
	new AddFieldModal(ws.app, schema, ws.fieldTypes, sectionId, (input) => {
		const created = applyEdit(() => s.schemaEdits.addField(schema.id, input));
		if (created) {
			// Open its settings right away for kinds that need configuring.
			const kind = ws.fieldTypes.get(created.type);
			if (created.type === 'relation' || created.type === 'rollup') setupLinkField(s, schema.id, created.id);
			if (kind?.hasOptions || kind?.configFields?.length || created.type === 'relation' || created.type === 'rollup') {
				window.setTimeout(() => new FieldSettingsModal(ws, s, schema.id, created.id).open(), 50);
			}
		}
		return created;
	}).open();
}

export { icon };
