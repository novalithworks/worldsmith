import type { EntityRecord, FieldDefinition } from '../../core/types';
import { selectOptions } from '../../fields/types/logic';
import type { WorldSession } from '../WorldSession';

/**
 * How a value is written in a spreadsheet cell (Milestone 9) — shared by the exporter and
 * the importer, which compares a cell with this text to leave unchanged values alone.
 */

/**
 * Several items in one cell, separated by “; ”. A single item that contains a comma gets a
 * trailing “;” so it isn't split at the comma on the way back in.
 */
export function joinList(items: string[]): string {
	const clean = items.map((x) => x.trim()).filter(Boolean);
	if (clean.length === 1 && /[,\n]/.test(clean[0]!)) return `${clean[0]};`;
	return clean.join('; ');
}

const NUMBER = /^-?\d+(\.\d+)?$/;

/** Cells starting with = + - @ would run as formulas in Excel: an apostrophe keeps them text. */
export function guardFormula(v: string): string {
	return /^[=+\-@\t\r]/.test(v) && !NUMBER.test(v) ? `'${v}` : v;
}

/** The reverse of `guardFormula` when reading a cell. */
export function unguardFormula(v: string): string {
	return /^'[=+\-@\t\r]/.test(v) ? v.slice(1) : v;
}

/** A field's value as cell text (before formula guarding). */
export function cellText(s: WorldSession, e: EntityRecord, f: FieldDefinition): string {
	if (f.type === 'relation') {
		return joinList(
			s.relations
				.linked(e.id, f)
				.filter((l) => !s.entities.get(l.id)?.trashedAt)
				.map((l) => l.name),
		);
	}
	if (f.type === 'parent') return e.parentId ? (s.entities.get(e.parentId)?.name ?? '') : '';
	const v = s.values.get(e, f);
	if (f.type === 'list' || f.type === 'tags') return joinList(Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
	if (f.type === 'multiselect') {
		const opts = selectOptions(f);
		return joinList((Array.isArray(v) ? v : []).map((id) => opts.find((o) => o.id === id)?.label ?? String(id)));
	}
	if (f.type === 'boolean') return v === true ? 'Yes' : v === false ? 'No' : '';
	if ((f.type === 'number' || f.type === 'percent' || f.type === 'rating' || f.type === 'progress') && typeof v === 'number') return String(v);
	if (f.type === 'image' || f.type === 'file') return (v as { path?: string } | null)?.path ?? '';
	return s.values.text(e, f);
}

/** Same text, ignoring spacing differences a spreadsheet app may introduce. */
export function sameCell(a: string, b: string): boolean {
	const n = (x: string) => x.replace(/\r\n/g, '\n').replace(/[ \t]+/g, ' ').replace(/;\s*$/, '').trim();
	return n(a) === n(b);
}
