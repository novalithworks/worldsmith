import { Registry } from '../core/registry/Registry';
import type { FieldDefinition } from '../core/types';
import type { FieldTypeDefinition } from './FieldType';

/**
 * Registry of field types plus convenience helpers that tolerate unknown types
 * (e.g. a world created with an extension that is no longer installed): unknown
 * fields degrade to plain JSON text instead of crashing.
 */
export class FieldTypeRegistry extends Registry<FieldTypeDefinition> {
	constructor() {
		super('FieldTypeRegistry');
	}

	for(field: FieldDefinition): FieldTypeDefinition {
		return this.get(field.type) ?? UNKNOWN_FIELD_TYPE;
	}

	isEmpty(field: FieldDefinition, value: unknown): boolean {
		return this.for(field).isEmpty(value);
	}

	toText(field: FieldDefinition, value: unknown): string {
		if (value === undefined || value === null) return '';
		try {
			return this.for(field).toText(value, field);
		} catch {
			return '';
		}
	}
}

export const UNKNOWN_FIELD_TYPE: FieldTypeDefinition = {
	id: '__unknown',
	label: 'Unknown',
	icon: 'help-circle',
	category: 'other',
	defaultValue: () => null,
	isEmpty: (v) => v === null || v === undefined || v === '',
	validate: () => null,
	coerce: (v) => ({ ok: true, value: v }),
	toText: (v) => (typeof v === 'string' ? v : JSON.stringify(v)),
};
