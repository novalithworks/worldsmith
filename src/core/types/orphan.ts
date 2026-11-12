import type { FieldDefinition } from './field';

/**
 * Values that no longer fit the schema — the field was deleted, or its kind changed and
 * the value couldn't be converted. Kept on the entity under `values._orphaned` so a
 * schema edit never destroys data; the entity page offers restore / discard.
 */
export const ORPHAN_KEY = '_orphaned';

export interface OrphanedValue {
	value: unknown;
	/** Field label at the time it was orphaned. */
	label: string;
	/** Field kind at the time it was orphaned. */
	type: string;
	reason: 'deleted' | 'type-change';
	at: number;
	/** Readable form at orphan time (choice ids resolved to labels, dates formatted…). */
	text?: string;
	/** Kind-neutral form used when restoring (e.g. choice labels instead of ids). */
	portable?: unknown;
	/** The field's definition when it was deleted, so “Restore field” can re-create it exactly. */
	field?: FieldDefinition;
	/** Section the deleted field lived in (null = unsectioned). */
	sectionId?: string | null;
}

/** Orphan keys may carry a `~n` suffix when the same field was orphaned twice. */
export function orphanFieldId(key: string): string {
	return key.split('~')[0] ?? key;
}

export function orphansOf(values: Record<string, unknown>): Record<string, OrphanedValue> {
	const o = values[ORPHAN_KEY];
	return typeof o === 'object' && o !== null && !Array.isArray(o) ? (o as Record<string, OrphanedValue>) : {};
}
