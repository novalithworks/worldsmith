import { Menu } from 'obsidian';
import type { WorldsmithContext } from '../app/context';
import type { EntitySchema, FieldDefinition } from '../core/types';
import type { WorldSession } from '../services/WorldSession';
import { ROUTES, type Route } from '../state/route';
import { applyEdit, confirmDeleteField, undoNotice } from './views/routes/typeStudio/common';
import { FieldSettingsModal } from './views/routes/typeStudio/FieldSettingsModal';

/**
 * Schema actions reachable outside Type Studio (entity pages, database headers).
 * They go through the same SchemaEditService, so validation, unused-data handling and
 * undo behave identically everywhere.
 */

export { openAddField } from './views/routes/typeStudio/fieldsTab';
export { confirmDeleteField };

/** Context menu for a field label on an entity page. */
export function entityFieldMenu(
	ws: WorldsmithContext,
	s: WorldSession,
	schema: EntitySchema,
	field: FieldDefinition,
	opts: { entityId: string; navigate: (r: Route) => void },
): Menu {
	const E = s.schemaEdits;
	const typeId = schema.id;
	const section = schema.sections.find((x) => x.fieldIds.includes(field.id));
	const menu = new Menu();
	menu.addItem((i) => i.setTitle('Edit field…').setIcon('settings-2').onClick(() => new FieldSettingsModal(ws, s, typeId, field.id).open()));
	menu.addItem((i) =>
		i
			.setTitle('Open in Type Studio')
			.setIcon('shapes')
			.onClick(() => opts.navigate(ROUTES.typeStudio(typeId, { tab: 'fields', section: section?.id }))),
	);
	const e = s.entities.get(opts.entityId);
	if (e && !ws.fieldTypes.isEmpty(field, e.values[field.id]) && !ws.fieldTypes.for(field).computed) {
		menu.addSeparator();
		menu.addItem((i) => i.setTitle('Clear value').setIcon('eraser').onClick(() => s.entityService.setFieldValue(opts.entityId, field.id, undefined)));
	}
	menu.addSeparator();
	menu.addItem((i) =>
		i
			.setTitle(field.advanced ? 'Show in main area' : 'Tuck under “More fields”')
			.setIcon('list-collapse')
			.onClick(() => {
				if (applyEdit(() => E.updateField(typeId, field.id, { advanced: !field.advanced }))) {
					undoNotice(s, field.advanced ? `“${field.label}” is back in the main area.` : `“${field.label}” moved under More fields.`);
				}
			}),
	);
	menu.addItem((i) =>
		i
			.setTitle(`Hide on every ${schema.singular.toLowerCase()}`)
			.setIcon('eye-off')
			.onClick(() => {
				if (applyEdit(() => E.updateField(typeId, field.id, { hidden: true }))) {
					undoNotice(s, `“${field.label}” hidden. Its values are kept; show it again in Type Studio.`);
				}
			}),
	);
	menu.addSeparator();
	menu.addItem((i) => i.setTitle('Delete field…').setIcon('trash-2').setWarning(true).onClick(() => void confirmDeleteField(ws, s, typeId, field)));
	return menu;
}
