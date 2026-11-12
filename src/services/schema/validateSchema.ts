import type { EntitySchema } from '../../core/types';
import type { FieldTypeRegistry } from '../../fields/FieldTypeRegistry';

export interface SchemaIssue {
	severity: 'error' | 'warning';
	message: string;
	fieldId?: string;
	sectionId?: string;
}

export const FIELD_ID_RE = /^[a-zA-Z][\w]*$/;

/**
 * Structural checks run after every schema edit. Errors block the edit (the studio
 * can never save a broken type); warnings are shown but allowed.
 */
export function validateSchema(schema: EntitySchema, fieldTypes?: FieldTypeRegistry): SchemaIssue[] {
	const issues: SchemaIssue[] = [];
	if (!schema.singular.trim()) issues.push({ severity: 'error', message: 'The type needs a name.' });
	if (!schema.plural.trim()) issues.push({ severity: 'error', message: 'The type needs a plural name.' });

	const ids = new Set<string>();
	for (const f of schema.fields) {
		if (!FIELD_ID_RE.test(f.id)) issues.push({ severity: 'error', fieldId: f.id, message: `“${f.id}” is not a valid field id.` });
		if (ids.has(f.id)) issues.push({ severity: 'error', fieldId: f.id, message: `Two fields share the id “${f.id}”.` });
		ids.add(f.id);
		if (!f.label.trim()) issues.push({ severity: 'error', fieldId: f.id, message: 'Every field needs a name.' });
		if (fieldTypes && !fieldTypes.has(f.type)) {
			issues.push({ severity: 'warning', fieldId: f.id, message: `“${f.label}” uses a field kind that isn’t installed (${f.type}).` });
		}
		if (f.type === 'number' && typeof f.config?.min === 'number' && typeof f.config?.max === 'number' && f.config.min > f.config.max) {
			issues.push({ severity: 'error', fieldId: f.id, message: `“${f.label}”: minimum is larger than maximum.` });
		}
		if ((f.type === 'select' || f.type === 'multiselect') && Array.isArray(f.config?.options)) {
			const optIds = new Set<string>();
			for (const o of f.config.options as Array<{ id: string; label: string }>) {
				if (optIds.has(o.id)) issues.push({ severity: 'error', fieldId: f.id, message: `“${f.label}” has duplicate choices.` });
				optIds.add(o.id);
				if (!o.label?.trim()) issues.push({ severity: 'error', fieldId: f.id, message: `“${f.label}” has a choice without a name.` });
			}
		}
	}

	const sectionIds = new Set<string>();
	const placed = new Set<string>();
	for (const s of schema.sections) {
		if (sectionIds.has(s.id)) issues.push({ severity: 'error', sectionId: s.id, message: `Two sections share the id “${s.id}”.` });
		sectionIds.add(s.id);
		if (!s.label.trim()) issues.push({ severity: 'error', sectionId: s.id, message: 'Every section needs a name.' });
		for (const fid of s.fieldIds) {
			if (!ids.has(fid)) issues.push({ severity: 'error', sectionId: s.id, message: `Section “${s.label}” lists a missing field (${fid}).` });
			if (placed.has(fid)) issues.push({ severity: 'error', fieldId: fid, message: `Field “${fid}” appears in two sections.` });
			placed.add(fid);
		}
	}

	for (const id of [...schema.display.subtitleFields, ...schema.display.cardFields]) {
		if (!ids.has(id)) issues.push({ severity: 'error', fieldId: id, message: `Display settings reference a missing field (${id}).` });
	}
	const taskIds = new Set<string>();
	for (const t of schema.defaultTasks) {
		if (taskIds.has(t.id)) issues.push({ severity: 'error', message: `Two checklist items share the id “${t.id}”.` });
		taskIds.add(t.id);
		if (!t.title.trim()) issues.push({ severity: 'error', message: 'Every checklist item needs a title.' });
	}
	return issues;
}

export class SchemaValidationError extends Error {
	constructor(readonly issues: SchemaIssue[]) {
		super(issues.map((i) => i.message).join(' '));
		this.name = 'SchemaValidationError';
	}
}
