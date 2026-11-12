import type { BlockInstance } from '../../core/types';

/**
 * Converts grid placements into a guillotine tree of rows (side-by-side columns) and
 * stacks (vertical sequences). Rendering the tree with flexbox gives content-sized blocks
 * with no gaps — a tall properties block beside a short progress block doesn't stretch it
 * or leave holes — while the stored model stays a plain x/y/w/h grid for the editor.
 *
 * Partition rules (recursive):
 *   1. If the blocks split into ≥2 column ranges that no block crosses → `row`.
 *   2. Otherwise cut horizontally. Take the *largest* top strip that is still a single
 *      block or column-splittable, so related side-by-side blocks stay grouped as columns
 *      (portrait above progress in one column, identity above personality in the next).
 *   3. Arrangements that can't be cut (pinwheels) fall back to a CSS-grid `grid` node.
 */
export type LayoutNode =
	| { kind: 'block'; block: BlockInstance }
	| { kind: 'row'; columns: Array<{ span: number; node: LayoutNode | null }> }
	| { kind: 'stack'; children: LayoutNode[] }
	| { kind: 'grid'; blocks: BlockInstance[]; x0: number; span: number };

export function buildLayoutTree(blocks: BlockInstance[], x0 = 0, x1 = 12): LayoutNode | null {
	const visible = blocks.filter((b) => !b.hidden);
	if (visible.length === 0) return null;
	return partition(visible, x0, x1);
}

function partition(blocks: BlockInstance[], x0: number, x1: number): LayoutNode {
	if (blocks.length === 1) {
		const only = blocks[0] as BlockInstance;
		const left = Math.max(0, only.x - x0);
		const right = Math.max(0, x1 - (only.x + only.w));
		if (left === 0 && right === 0) return { kind: 'block', block: only };
		// A lone narrow block keeps its width; spacers fill the rest.
		const columns: Array<{ span: number; node: LayoutNode | null }> = [];
		if (left) columns.push({ span: left, node: null });
		columns.push({ span: Math.min(only.w, x1 - x0), node: { kind: 'block', block: only } });
		if (right) columns.push({ span: right, node: null });
		return { kind: 'row', columns };
	}

	const cols = columnSplit(blocks, x0, x1);
	if (cols) {
		return {
			kind: 'row',
			columns: cols.map((c) => ({
				span: c.x1 - c.x0,
				node: c.blocks.length ? partition(c.blocks, c.x0, c.x1) : null,
			})),
		};
	}

	const cuts = rowCuts(blocks);
	if (cuts.length === 0) {
		return { kind: 'grid', blocks: [...blocks].sort(byPos), x0, span: x1 - x0 };
	}

	let best = cuts[0] as number;
	for (const c of cuts) {
		const top = blocks.filter((b) => b.y < c);
		if (top.length === 1 || columnSplit(top, x0, x1)) best = c;
		else break;
	}
	const top = blocks.filter((b) => b.y < best);
	const rest = blocks.filter((b) => b.y >= best);
	const children: LayoutNode[] = [];
	for (const part of [partition(top, x0, x1), partition(rest, x0, x1)]) {
		if (part.kind === 'stack') children.push(...part.children);
		else children.push(part);
	}
	return { kind: 'stack', children };
}

/** Column ranges (including empty spacers) such that no block crosses a boundary. */
function columnSplit(blocks: BlockInstance[], x0: number, x1: number) {
	const boundaries = new Set<number>();
	for (const b of blocks) {
		boundaries.add(Math.max(x0, b.x));
		boundaries.add(Math.min(x1, b.x + b.w));
	}
	const valid = [...boundaries]
		.filter((x) => x > x0 && x < x1)
		.filter((x) => !blocks.some((b) => b.x < x && x < b.x + b.w))
		.sort((a, b) => a - b);
	if (valid.length === 0) return null;
	const edges = [x0, ...valid, x1];
	const cols: Array<{ x0: number; x1: number; blocks: BlockInstance[] }> = [];
	for (let i = 0; i < edges.length - 1; i++) {
		const a = edges[i] as number;
		const z = edges[i + 1] as number;
		cols.push({ x0: a, x1: z, blocks: blocks.filter((b) => b.x >= a && b.x + b.w <= z) });
	}
	// Merge adjacent empty spacers.
	const merged: typeof cols = [];
	for (const c of cols) {
		const last = merged[merged.length - 1];
		if (last && !last.blocks.length && !c.blocks.length) last.x1 = c.x1;
		else merged.push(c);
	}
	return merged.filter((c) => c.blocks.length).length >= 2 || merged.some((c) => !c.blocks.length) ? merged : null;
}

/** y positions (between min and max) that no block spans across. */
function rowCuts(blocks: BlockInstance[]): number[] {
	const minY = Math.min(...blocks.map((b) => b.y));
	const ys = new Set<number>();
	for (const b of blocks) ys.add(b.y + b.h);
	const maxY = Math.max(...blocks.map((b) => b.y + b.h));
	return [...ys]
		.filter((y) => y > minY && y < maxY)
		.filter((y) => !blocks.some((b) => b.y < y && y < b.y + b.h))
		.sort((a, b) => a - b);
}

function byPos(a: BlockInstance, b: BlockInstance): number {
	return a.y - b.y || a.x - b.x;
}

/** Reading order used for single-column (narrow) rendering and accessibility. */
export function readingOrder(node: LayoutNode | null): BlockInstance[] {
	if (!node) return [];
	switch (node.kind) {
		case 'block':
			return [node.block];
		case 'stack':
			return node.children.flatMap(readingOrder);
		case 'row':
			return node.columns.flatMap((c) => readingOrder(c.node));
		case 'grid':
			return node.blocks;
	}
}
