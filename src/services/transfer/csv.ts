/**
 * CSV reading and writing (Milestone 9). Reads what spreadsheets actually produce: a byte
 * order mark, quoted cells with commas, quotes ("") and line breaks inside, Windows or Unix
 * line endings, and comma, semicolon or tab separators (detected from the first line).
 */

export interface CsvTable {
	headers: string[];
	rows: string[][];
	delimiter: ',' | ';' | '\t';
	/** Something about the file the user should know (e.g. a quote that never closes). */
	warning?: string;
}

/** Which separator the first line uses most (outside quotes). */
export function detectDelimiter(text: string): ',' | ';' | '\t' {
	const counts: Record<string, number> = { ',': 0, ';': 0, '\t': 0 };
	let quoted = false;
	// Start of the current cell: a quote only opens a quoted cell there (so `5"10` is text).
	let atStart = true;
	for (let i = 0; i < text.length; i++) {
		const c = text[i]!;
		if (quoted) {
			if (c === '"') {
				if (text[i + 1] === '"') i++;
				else quoted = false;
			}
			continue;
		}
		if (c === '"' && atStart) {
			quoted = true;
			continue;
		}
		if (c === '\n' || c === '\r') break;
		if (c in counts) {
			counts[c]!++;
			atStart = true;
		} else if (c !== ' ') atStart = false;
	}
	if (counts['\t']! > counts[',']! && counts['\t']! >= counts[';']!) return '\t';
	if (counts[';']! > counts[',']!) return ';';
	return ',';
}

/** Every record as a list of cells. */
export function parseCsvRows(input: string, delimiter?: ',' | ';' | '\t'): string[][] {
	return readCsv(input, delimiter).rows;
}

function readCsv(input: string, delimiter?: ',' | ';' | '\t'): { rows: string[][]; unterminated: boolean } {
	const text = input.replace(/^\uFEFF/, '');
	const d = delimiter ?? detectDelimiter(text);
	const rows: string[][] = [];
	let row: string[] = [];
	let cell = '';
	let quoted = false;
	let i = 0;
	while (i < text.length) {
		const c = text[i]!;
		if (quoted) {
			if (c === '"') {
				if (text[i + 1] === '"') {
					cell += '"';
					i += 2;
					continue;
				}
				quoted = false;
				i++;
				continue;
			}
			cell += c;
			i++;
			continue;
		}
		if (c === '"' && cell.trim() === '') {
			// A quoted cell (spaces before the opening quote are dropped, as spreadsheets do).
			quoted = true;
			cell = '';
			i++;
		} else if (c === d) {
			row.push(cell);
			cell = '';
			i++;
		} else if (c === '\r' || c === '\n') {
			row.push(cell);
			rows.push(row);
			row = [];
			cell = '';
			i += c === '\r' && text[i + 1] === '\n' ? 2 : 1;
		} else {
			cell += c;
			i++;
		}
	}
	if (cell !== '' || row.length) {
		row.push(cell);
		rows.push(row);
	}
	// Drop blank lines (a trailing newline, empty spreadsheet rows).
	return { rows: rows.filter((r) => r.some((x) => x.trim() !== '')), unterminated: quoted };
}

/** First record = column headers; the rest, padded to the same width. */
export function parseCsv(input: string): CsvTable {
	const text = input.replace(/^\uFEFF/, '');
	const delimiter = detectDelimiter(text);
	const { rows: all, unterminated } = readCsv(text, delimiter);
	const rawHeaders = all[0] ?? [];
	let width = rawHeaders.length;
	for (const r of all) if (r.length > width) width = r.length;
	// Blank or repeated headers get a name, so every column can be mapped.
	const seen = new Map<string, number>();
	const headers = Array.from({ length: width }, (_, i) => {
		const base = (rawHeaders[i] ?? '').trim() || `Column ${i + 1}`;
		const n = (seen.get(base.toLowerCase()) ?? 0) + 1;
		seen.set(base.toLowerCase(), n);
		return n > 1 ? `${base} (${n})` : base;
	});
	const rows = all.slice(1).map((r) => Array.from({ length: width }, (_, i) => r[i] ?? ''));
	const table: CsvTable = { headers, rows, delimiter };
	if (unterminated) table.warning = 'A quote mark in the file is never closed, so the last rows may have run together. Check the file in your spreadsheet app.';
	return table;
}

function cellText(v: string): string {
	return /[",\r\n;\t]/.test(v) || /^\s|\s$/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/** A CSV document (comma separated, CRLF lines, with a BOM so spreadsheet apps read UTF-8). */
export function toCsv(headers: string[], rows: string[][]): string {
	const lines = [headers, ...rows].map((r) => r.map((c) => cellText(c ?? '')).join(','));
	return `\uFEFF${lines.join('\r\n')}\r\n`;
}
