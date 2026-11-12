import type { EntityRecord, EntitySchema, FieldDefinition } from '../../core/types';
import type { FieldTypeRegistry } from '../../fields/FieldTypeRegistry';
import type { WorldSession } from '../WorldSession';
import { toCsv } from './csv';
import { cellText, guardFormula, joinList } from './cells';
import { importableFields } from './csvImport';

/**
 * Spreadsheet export (Milestone 9). Columns use the field labels and values are written the
 * way the importer reads them back (lists and links separated by “; ”), so a file can be
 * edited in a spreadsheet and imported again to update the same entries.
 */

export interface CsvColumn {
	header: string;
	value(e: EntityRecord): string;
}

export function csvColumns(s: WorldSession, fieldTypes: FieldTypeRegistry, schema: EntitySchema, fieldIds?: string[] | null): CsvColumn[] {
	const builtins: CsvColumn[] = [
		{ header: 'Name', value: (e) => e.name },
		{ header: 'Also known as', value: (e) => joinList(e.aliases) },
		{ header: 'Tags', value: (e) => joinList(e.tags) },
		{ header: 'Status', value: (e) => s.world.statuses.find((x) => x.id === e.status)?.label ?? e.status },
		{ header: 'Summary (description)', value: (e) => e.description },
	];
	const all = importableFields(schema, fieldTypes).filter((f) => !f.hidden);
	const fields = fieldIds ? fieldIds.map((id) => all.find((f) => f.id === id)).filter((f): f is FieldDefinition => !!f) : all;
	const labelCount = new Map<string, number>();
	for (const f of fields) labelCount.set(f.label.toLowerCase(), (labelCount.get(f.label.toLowerCase()) ?? 0) + 1);
	// A label that reads like another field's id (“Family” vs the field with id “family”).
	const ids = new Set(all.map((f) => f.id.toLowerCase()));
	return [
		...builtins,
		...fields.map((f) => ({
			// Two fields with one label would be indistinguishable on the way back in.
			// (or from a built-in column): those columns say which field they are, “Label (id)”.
			header: (labelCount.get(f.label.toLowerCase()) ?? 0) > 1 || builtins.some((b) => b.header.toLowerCase() === f.label.toLowerCase()) || (ids.has(f.label.toLowerCase()) && f.id.toLowerCase() !== f.label.toLowerCase()) ? `${f.label} (${f.id})` : f.label,
			value: (e: EntityRecord) => cellText(s, e, f),
		})),
	];
}

export function exportCsv(s: WorldSession, fieldTypes: FieldTypeRegistry, schema: EntitySchema, entries: EntityRecord[], fieldIds?: string[] | null): string {
	const cols = csvColumns(s, fieldTypes, schema, fieldIds);
	return toCsv(
		cols.map((c) => c.header),
		entries.map((e) => cols.map((c) => guardFormula(c.value(e)))),
	);
}
