import { Menu, Notice, setIcon } from 'obsidian';
import type { WorldsmithContext } from '../../../../app/context';
import type { EntityRecord, EntitySchema, TaskPriority, TaskTemplate } from '../../../../core/types';
import { RECORD_VERSIONS } from '../../../../app/constants';
import type { WorldSession } from '../../../../services/WorldSession';
import type { Route } from '../../../../state/route';
import { button, chip, cx, icon } from '../../../components/dom';
import { renderEntityCard } from '../../../components/entityCard';
import { showsValue } from '../../../../services/FieldValues';
import { confirmModal, IconPickerModal, promptModal } from '../../../components/modals';
import { applyEdit, colorSwatches, formRow, inlineText, studioCard, toggle, typePicker, undoNotice } from './common';
import { defaultLayoutFor } from '../../../../layouts/defaults';
import { sameLayout } from '../../../../layouts/presets';
import { exportTypePack } from '../../../../services/transfer/typePack';
import { dateStamp, exportsFolder, writeNewFile } from '../../../transfer/files';

// ── Display ───────────────────────────────────────────────────────────────────

/**
 * Which fields appear under the name (subtitle) and on database cards, with a live
 * preview rendered by the real card component.
 */
export function renderDisplayTab(el: HTMLElement, ws: WorldsmithContext, s: WorldSession, schema: EntitySchema): void {
	const E = s.schemaEdits;
	const root = el.createDiv({ cls: 'ws-display-tab' });
	const left = root.createDiv({ cls: 'ws-display-tab__controls' });
	const right = root.createDiv({ cls: 'ws-display-tab__preview' });
	const sample = sampleEntity(s, schema);
	const one = schema.singular.toLowerCase();
	const valueOf = (id: string): string => {
		const f = schema.fields.find((x) => x.id === id);
		return f && sample.real ? ws.fieldTypes.toText(f, s.values.get(sample.entity, f)) : '';
	};

	const pickable = schema.fields.filter((f) => showsValue(ws.fieldTypes.for(f)) && ws.fieldTypes.for(f).category !== 'media');
	const picker = (o: { title: string; glyph: string; blurb: string; ids: string[]; empty: string; reads: (ids: string[]) => string; save: (next: string[]) => void }) => {
		const { aside, body } = studioCard(left, o.title, o.glyph, o.blurb, 'ws-display-card');
		const { ids, save } = o;
		aside.createSpan({ cls: 'ws-tset__count', text: ids.length ? `${ids.length} field${ids.length === 1 ? '' : 's'}` : 'None' });
		const chips = body.createDiv({ cls: 'ws-chips ws-pick-chips' });
		ids.forEach((id, i) => {
			const f = schema.fields.find((x) => x.id === id);
			if (!f) return;
			const c = chip(chips, {
				label: f.label,
				icon: ws.fieldTypes.for(f).icon,
				onRemove: () => save(ids.filter((x) => x !== id)),
			});
			c.setAttr('draggable', 'true');
			c.addEventListener('dragstart', (e) => e.dataTransfer?.setData('text/plain', String(i)));
			c.addEventListener('dragover', (e) => e.preventDefault());
			c.addEventListener('drop', (e) => {
				e.preventDefault();
				const from = Number(e.dataTransfer?.getData('text/plain'));
				if (Number.isNaN(from) || from === i) return;
				const next = [...ids];
				const [m] = next.splice(from, 1);
				if (m) next.splice(i, 0, m);
				save(next);
			});
			c.addEventListener('contextmenu', (evt) => {
				evt.preventDefault();
				const menu = new Menu();
				menu.addItem((it) => it.setTitle('Move earlier').setIcon('arrow-left').setDisabled(i === 0).onClick(() => { const n = [...ids]; n.splice(i - 1, 0, ...n.splice(i, 1)); save(n); }));
				menu.addItem((it) => it.setTitle('Move later').setIcon('arrow-right').setDisabled(i === ids.length - 1).onClick(() => { const n = [...ids]; n.splice(i + 1, 0, ...n.splice(i, 1)); save(n); }));
				menu.addItem((it) => it.setTitle('Remove').setIcon('x').onClick(() => save(ids.filter((x) => x !== id))));
				menu.showAtMouseEvent(evt);
			});
		});
		const add = chips.createEl('button', { cls: 'ws-chip-add', attr: { type: 'button' } });
		icon(add, 'plus');
		add.createSpan({ text: 'Add field' });
		add.addEventListener('click', () => {
			const menu = new Menu();
			const available = pickable.filter((f) => !ids.includes(f.id));
			if (!available.length) menu.addItem((it) => it.setTitle('Every field is already shown').setIsLabel(true));
			for (const f of available) menu.addItem((it) => it.setTitle(f.label).setIcon(ws.fieldTypes.for(f).icon).onClick(() => save([...ids, f.id])));
			const r = add.getBoundingClientRect();
			menu.showAtPosition({ x: r.left, y: r.bottom + 4 });
		});
		// What it reads like on a real entry, in words.
		const reads = body.createDiv({ cls: 'ws-display-card__reads' });
		icon(reads, 'quote');
		const line = ids.length ? o.reads(ids) : '';
		reads.createSpan({ cls: 'ws-display-card__reads-label', text: sample.real ? `For ${sample.entity.name}:` : 'Example:' });
		reads.createSpan({ cls: cx('ws-display-card__reads-text', !line && 'is-empty'), text: line || (ids.length ? `${sample.real ? 'Nothing filled in yet' : 'Shows once entries have these filled in'}` : o.empty) });
		body.createDiv({ cls: 'ws-display-card__tip', text: 'Drag to reorder, or right-click a field to move it.' });
	};
	picker({
		title: 'Under the name',
		glyph: 'text-quote',
		blurb: `The short line beneath a ${one}’s name on its page, on cards and in search.`,
		ids: schema.display.subtitleFields,
		empty: 'Nothing: just the name.',
		reads: (ids) => ids.map(valueOf).filter(Boolean).join(' • '),
		save: (next) => applyEdit(() => E.setDisplay(schema.id, { subtitleFields: next })),
	});
	picker({
		title: 'On cards and in tables',
		glyph: 'id-card',
		blurb: 'Short facts listed on database cards, and the first columns of a new table view.',
		ids: schema.display.cardFields,
		empty: 'No facts: cards show the picture, name and progress.',
		reads: (ids) =>
			ids
				.filter((id) => !schema.display.subtitleFields.includes(id))
				.map((id) => {
					const v = valueOf(id);
					return v ? `${schema.fields.find((f) => f.id === id)?.label}: ${v}` : '';
				})
				.filter(Boolean)
				.join(' · '),
		save: (next) => applyEdit(() => E.setDisplay(schema.id, { cardFields: next })),
	});

	const pv = studioCard(right, 'Preview', 'eye', sample.real ? `${sample.entity.name}, your most recently edited ${one}.` : `No ${schema.plural.toLowerCase()} yet, so this is a placeholder.`, 'ws-display-preview');
	const cards = pv.body.createDiv({ cls: 'ws-cards ws-cards--preview' });
	renderEntityCard(cards, { app: ws.app, session: s, fieldTypes: ws.fieldTypes, schema, entity: sample.entity, cardImage: ws.settings.appearance.cardImage });
}

function sampleEntity(s: WorldSession, schema: EntitySchema): { entity: EntityRecord; real: boolean } {
	const real = s.index
		.ofType(schema.id)
		.sort((a, b) => b.updatedAt - a.updatedAt)[0];
	if (real) return { entity: real, real: true };
	const now = Date.now();
	return {
		real: false,
		entity: {
			v: RECORD_VERSIONS.entity,
			id: '__preview',
			worldId: s.worldId,
			typeId: schema.id,
			name: `Example ${schema.singular.toLowerCase()}`,
			aliases: [],
			tags: [],
			description: '',
			status: s.world.defaultStatus,
			values: {},
			media: { gallery: [] },
			parentId: null,
			sortOrder: 0,
			flags: {},
			linkedNote: null,
			moreNotes: [],
			createdAt: now,
			updatedAt: now,
			rev: 0,
			archivedAt: null,
			trashedAt: null,
		},
	};
}

// ── Checklist ─────────────────────────────────────────────────────────────────

const PRIORITIES: Array<{ id: TaskPriority; label: string }> = [
	{ id: 0, label: 'No priority' },
	{ id: 1, label: 'Low' },
	{ id: 2, label: 'Medium' },
	{ id: 3, label: 'High' },
	{ id: 4, label: 'Urgent' },
];

/** The development checklist each new entry of this type will start with. */
export function renderChecklistTab(el: HTMLElement, s: WorldSession, schema: EntitySchema): void {
	const E = s.schemaEdits;
	const root = el.createDiv({ cls: 'ws-checklist-tab' });
	const one = schema.singular.toLowerCase();
	const many = schema.plural.toLowerCase();
	const tasks = schema.defaultTasks;
	const save = (next: TaskTemplate[]) => applyEdit(() => E.setDefaultTasks(schema.id, next));

	const main = studioCard(root, 'Starting checklist', 'list-checks', `Every new ${one} starts with these. Drag to reorder; click a priority or Optional to change it.`, 'ws-checklist-card');
	const optional = tasks.filter((t) => t.optional).length;
	main.aside.createSpan({ cls: 'ws-tset__count', text: tasks.length ? `${tasks.length} item${tasks.length === 1 ? '' : 's'}${optional ? ` · ${optional} optional` : ''}` : 'Empty' });
	const list = main.body.createDiv({ cls: 'ws-task-rows' });
	if (!tasks.length) list.createDiv({ cls: 'ws-task-rows__empty', text: `No items yet. Add the things you like to work out for every ${one}, like “Define core motivation”.` });
	let dragFrom = -1;
	tasks.forEach((t, i) => {
		const row = list.createDiv({ cls: cx('ws-task-row', t.optional && 'is-optional'), attr: { draggable: 'true' } });
		const handle = row.createSpan({ cls: 'ws-drag-handle', attr: { 'aria-hidden': 'true' } });
		setIcon(handle, 'grip-vertical');
		const box = row.createSpan({ cls: 'ws-task-row__box' });
		setIcon(box, 'square');
		inlineText(row, t.title, {
			cls: 'ws-task-row__title',
			ariaLabel: 'Checklist item',
			onCommit: (v) => {
				if (v.trim()) save(tasks.map((x, j) => (j === i ? { ...x, title: v.trim() } : x)));
			},
		});
		inlineText(row, t.category ?? '', {
			cls: 'ws-task-row__cat',
			placeholder: 'Category',
			ariaLabel: 'Category',
			onCommit: (v) => save(tasks.map((x, j) => (j === i ? withOptional({ ...x }, 'category', v.trim()) : x))),
		});
		const pr = row.createEl('button', { cls: cx('ws-task-row__prio', `is-p${t.priority ?? 0}`), attr: { type: 'button', 'aria-label': 'Priority' } });
		pr.setText(PRIORITIES.find((p) => p.id === (t.priority ?? 0))?.label ?? '');
		pr.addEventListener('click', (evt) => {
			const menu = new Menu();
			for (const p of PRIORITIES) menu.addItem((it) => it.setTitle(p.label).setChecked((t.priority ?? 0) === p.id).onClick(() => save(tasks.map((x, j) => (j === i ? withOptional({ ...x }, 'priority', p.id || undefined) : x)))));
			menu.showAtMouseEvent(evt);
		});
		const opt = row.createEl('button', { cls: cx('ws-task-row__opt', t.optional && 'is-on'), attr: { type: 'button', 'aria-pressed': String(!!t.optional) }, text: 'Optional' });
		opt.addEventListener('click', () => save(tasks.map((x, j) => (j === i ? withOptional({ ...x }, 'optional', !t.optional || undefined) : x))));
		const del = row.createEl('button', { cls: 'ws-mini-btn', attr: { type: 'button', 'aria-label': `Remove ${t.title}` } });
		setIcon(del, 'x');
		del.addEventListener('click', () => save(tasks.filter((_, j) => j !== i)));
		row.addEventListener('dragstart', () => (dragFrom = i));
		row.addEventListener('dragover', (e) => {
			e.preventDefault();
			row.addClass('is-drop-target');
		});
		row.addEventListener('dragleave', () => row.removeClass('is-drop-target'));
		row.addEventListener('drop', (e) => {
			e.preventDefault();
			row.removeClass('is-drop-target');
			if (dragFrom < 0 || dragFrom === i) return;
			const next = [...tasks];
			const [m] = next.splice(dragFrom, 1);
			if (m) next.splice(i, 0, m);
			save(next);
		});
	});
	const add = main.body.createDiv({ cls: 'ws-task-row ws-task-row--add' });
	const plus = add.createSpan({ cls: 'ws-task-row__box' });
	setIcon(plus, 'plus');
	const input = add.createEl('input', { cls: 'ws-inline ws-task-row__title', attr: { type: 'text', placeholder: 'Add a checklist item and press Enter', 'aria-label': 'New checklist item' } });
	input.addEventListener('keydown', (e) => {
		if (e.key !== 'Enter' || !input.value.trim()) return;
		e.preventDefault();
		const t = E.newTaskTemplate(schema.id, input.value.trim());
		if (save([...tasks, t])) window.setTimeout(() => (el.ownerDocument.querySelector('.ws-task-row--add input'))?.focus(), 0);
	});

	// Entries that already exist keep their own checklists; this is how they catch up.
	const have = s.index.ofType(schema.id).length;
	const ex = studioCard(root, `${schema.plural} you already have`, 'users', `Changes here never touch an existing ${one}’s checklist, so nothing you ticked is lost.`, 'ws-checklist-existing');
	const missing = s.tasks.missingTemplateCount(schema.id);
	const row = formRow(
		ex.body,
		!have ? `No ${many} yet` : missing ? `${missing} ${missing === 1 ? `${one} is` : `${many} are`} missing items` : `Every ${one} is up to date`,
		!have ? 'New ones will start with this checklist.' : missing ? 'Adds only the items they don’t have yet.' : `All ${have} have every item on this list.`,
	);
	button(row, {
		label: 'Add to existing entries',
		icon: 'list-plus',
		variant: missing ? 'default' : 'ghost',
		size: 'sm',
		disabled: !missing,
		onClick: () => {
			const n = s.tasks.syncTemplates(schema.id);
			new Notice(`Added ${n} task${n === 1 ? '' : 's'} to existing ${many}.`);
			el.empty();
			renderChecklistTab(el, s, schema);
		},
	});
}

function withOptional<T extends object, K extends keyof T>(obj: T, key: K, value: T[K] | undefined | ''): T {
	if (value === undefined || value === '' || value === null) delete obj[key];
	else obj[key] = value;
	return obj;
}

// ── Settings ──────────────────────────────────────────────────────────────────

export function renderTypeSettingsTab(el: HTMLElement, ws: WorldsmithContext, s: WorldSession, schema: EntitySchema, navigate: (r: Route) => void): void {
	const E = s.schemaEdits;
	const root = el.createDiv({ cls: 'ws-type-settings' });
	const meta = (patch: Parameters<typeof E.updateTypeMeta>[1]) => applyEdit(() => E.updateTypeMeta(schema.id, patch));

	/** A settings card: an icon, a title and a line about what it holds, then its rows. */
	const card = (title: string, glyph: string, blurb: string, cls = ''): HTMLElement => studioCard(root, title, glyph, blurb, cls).body;

	const names = card('Name & look', 'type', 'How this type is called and how it looks across your world.');
	inlineText(formRow(names, 'Singular', `Used for one entry — “New ${schema.singular.toLowerCase()}”`), schema.singular, { cls: 'ws-input-like', ariaLabel: 'Singular name', onCommit: (v) => meta({ singular: v }) });
	inlineText(formRow(names, 'Plural', 'Used for the database and sidebar'), schema.plural, { cls: 'ws-input-like', ariaLabel: 'Plural name', onCommit: (v) => meta({ plural: v }) });
	inlineText(formRow(names, 'Description', 'Shown at the top of the database'), schema.description, {
		cls: 'ws-input-like',
		multiline: true,
		ariaLabel: 'Description',
		onCommit: (v) => meta({ description: v.trim() }),
	});
	const iconCtl = formRow(names, 'Icon', 'Shown in the sidebar, on cards and chips');
	const iconBtn = iconCtl.createEl('button', { cls: cx('ws-icon-pick ws-tset__icon', schema.color && `ws-tint--${schema.color}`), attr: { type: 'button', 'aria-label': 'Change icon' } });
	setIcon(iconBtn, schema.icon);
	iconBtn.addEventListener('click', () => new IconPickerModal(ws.app, (id) => meta({ icon: id })).open());
	button(iconCtl, { label: 'Change…', variant: 'quiet', size: 'sm', onClick: () => new IconPickerModal(ws.app, (id) => meta({ icon: id })).open() });
	colorSwatches(formRow(names, 'Color', 'Tints the icon and accents'), schema.color, (c) => meta({ color: c }));

	const place = card('Sidebar & nesting', 'panel-left', 'Where the type is listed, and whether its entries can sit inside others.');
	const groupSel = formRow(place, 'Sidebar group', 'The section it’s listed under').createEl('select', { cls: 'ws-input dropdown ws-tset__select' });
	for (const g of s.world.sidebar.groups) groupSel.createEl('option', { text: g.label, value: g.id });
	groupSel.value = s.world.sidebar.groups.find((g) => g.items.some((i) => i.kind === 'type' && i.typeId === schema.id))?.id ?? schema.group;
	groupSel.addEventListener('change', () => meta({ group: groupSel.value }));
	toggle(formRow(place, 'Can be placed inside other entries', 'e.g. a city inside a nation'), schema.hierarchy.allowParent, (v) => applyEdit(() => E.setHierarchy(schema.id, { allowParent: v })), 'Allow nesting');
	if (schema.hierarchy.allowParent) {
		typePicker(formRow(place, 'Allowed parents', 'Leave empty to allow any type'), s, schema.hierarchy.parentTypes, (next) => applyEdit(() => E.setHierarchy(schema.id, { parentTypes: next })));
	}
	typePicker(formRow(place, 'Suggested nested types', 'Offered first when adding a nested entry'), s, schema.hierarchy.childTypes, (next) => applyEdit(() => E.setHierarchy(schema.id, { childTypes: next })));

	const danger = card('Manage type', 'settings-2', 'Copy it, share it with another world, or put it away.', 'ws-danger-zone');
	const row = danger.createDiv({ cls: 'ws-danger-zone__row' });
	button(row, {
		label: 'Duplicate…',
		icon: 'copy',
		variant: 'ghost',
		onClick: () => void (async () => {
			const name = await promptModal(ws.app, { title: `Duplicate ${schema.singular}`, label: 'New type name (singular)', value: `${schema.singular} copy`, confirmLabel: 'Duplicate' });
			if (!name?.trim()) return;
			const copy = applyEdit(() => E.duplicateType(schema.id, name.trim()));
			if (!copy) return;
			// The copy gets the same page layout (its own default could differ: it's a custom type).
			const layout = s.layouts.typeLayout(schema).blocks;
			if (!sameLayout(layout, defaultLayoutFor(copy))) s.layouts.save({ kind: 'type', typeId: copy.id }, layout);
			navigate({ name: 'type-studio', params: { typeId: copy.id } });
		})(),
	});
	button(row, {
		label: 'Export type…',
		icon: 'file-output',
		variant: 'ghost',
		cls: 'ws-ts__export',
		tooltip: 'Save this type (fields, sections, cards, checklist and layout) as a file to use in another world',
		onClick: () => void (async () => {
			try {
				const path = await writeNewFile(ws.app, exportsFolder(ws), `${schema.plural} type ${dateStamp()}`, 'json', JSON.stringify(exportTypePack(s, [schema.id]), null, '\t'));
				new Notice(`${schema.plural} exported to ${path}`);
			} catch (e) {
				new Notice(`Export failed: ${e instanceof Error ? e.message : String(e)}`);
			}
		})(),
	});
	button(row, {
		label: schema.archived ? 'Restore type' : 'Archive type',
		icon: 'archive',
		variant: 'ghost',
		tooltip: schema.archived ? 'Show it in the sidebar again' : 'Hide it from the sidebar; entries are kept',
		onClick: () => {
			if (applyEdit(() => E.setArchived(schema.id, !schema.archived))) undoNotice(s, schema.archived ? `${schema.plural} restored.` : `${schema.plural} archived.`);
		},
	});
	const count = E.countEntities(schema.id);
	button(row, {
		label: 'Delete type…',
		icon: 'trash-2',
		variant: 'danger',
		disabled: count > 0,
		tooltip: count > 0 ? `Has ${count} entr${count === 1 ? 'y' : 'ies'} (including trash). Archive it, or delete the entries first.` : undefined,
		onClick: () => void (async () => {
			const ok = await confirmModal(ws.app, { title: `Delete the ${schema.plural} type?`, body: 'It has no entries, so nothing else is affected. You can undo right after.', confirmLabel: 'Delete type', danger: true });
			if (!ok) return;
			if (applyEdit(() => E.deleteType(schema.id)) !== undefined) {
				undoNotice(s, `Deleted ${schema.plural}.`);
				navigate({ name: 'type-studio' });
			}
		})(),
	});
	if (count > 0) danger.createDiv({ cls: 'ws-fm__hint ws-tset__note', text: `Delete is available once ${schema.plural.toLowerCase()} has no entries (it has ${count}, counting trash). Archiving keeps every entry.` });
}
