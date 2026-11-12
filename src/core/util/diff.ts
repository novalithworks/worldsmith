/**
 * Line diff (WS6, 0.25): what changed between two texts, line by line, for comparing a scene
 * with a snapshot. Longest-common-subsequence on lines, with the common start and end trimmed
 * first so typical edits stay fast. Pure.
 */

export type DiffOp = { kind: 'same'; a: string; b: string } | { kind: 'removed'; a: string } | { kind: 'added'; b: string };

/** Lines beyond this (after trimming the common start and end) aren't compared line by line. */
export const DIFF_MAX = 4000;

export function diffLines(oldText: string, newText: string): DiffOp[] | null {
	const a = oldText.replace(/\r\n?/g, '\n').split('\n');
	const b = newText.replace(/\r\n?/g, '\n').split('\n');
	let start = 0;
	while (start < a.length && start < b.length && a[start] === b[start]) start++;
	let endA = a.length;
	let endB = b.length;
	while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
		endA--;
		endB--;
	}
	const midA = a.slice(start, endA);
	const midB = b.slice(start, endB);
	if (midA.length * midB.length > DIFF_MAX * DIFF_MAX / 4 || midA.length > DIFF_MAX || midB.length > DIFF_MAX) return null;
	// LCS table over the middle (rows: midA, cols: midB), filled from the end.
	const n = midA.length;
	const m = midB.length;
	const w = m + 1;
	const t = new Uint32Array((n + 1) * w);
	for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) t[i * w + j] = midA[i] === midB[j] ? t[(i + 1) * w + j + 1]! + 1 : Math.max(t[(i + 1) * w + j]!, t[i * w + j + 1]!);
	const out: DiffOp[] = [];
	for (let i = 0; i < start; i++) out.push({ kind: 'same', a: a[i]!, b: b[i]! });
	let i = 0;
	let j = 0;
	while (i < n && j < m) {
		if (midA[i] === midB[j]) {
			out.push({ kind: 'same', a: midA[i]!, b: midB[j]! });
			i++;
			j++;
		} else if (t[(i + 1) * w + j]! >= t[i * w + j + 1]!) out.push({ kind: 'removed', a: midA[i++]! });
		else out.push({ kind: 'added', b: midB[j++]! });
	}
	while (i < n) out.push({ kind: 'removed', a: midA[i++]! });
	while (j < m) out.push({ kind: 'added', b: midB[j++]! });
	for (let k = endA; k < a.length; k++) out.push({ kind: 'same', a: a[k]!, b: b[k - endA + endB]! });
	return out;
}

/** Counts of lines removed and added. */
export function diffStats(ops: DiffOp[]): { removed: number; added: number } {
	let removed = 0;
	let added = 0;
	for (const o of ops) {
		if (o.kind === 'removed') removed++;
		else if (o.kind === 'added') added++;
	}
	return { removed, added };
}
