import type { BlockInstance } from '../../core/types';

/**
 * Pure grid math over BlockInstance placements (12 columns, row units).
 * The M6 drag/resize editor drives these; the renderer never needs them.
 */
export const COLUMNS = 12;

type Placed = Pick<BlockInstance, 'id' | 'x' | 'y' | 'w' | 'h'>;

export function collides(a: Placed, b: Placed): boolean {
	return a.id !== b.id && a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/** Clamp every block into the grid. */
export function normalize<T extends Placed>(blocks: T[], cols = COLUMNS): T[] {
	return blocks.map((b) => {
		const w = Math.max(1, Math.min(cols, Math.round(b.w)));
		const x = Math.max(0, Math.min(cols - w, Math.round(b.x)));
		return { ...b, w, x, y: Math.max(0, Math.round(b.y)), h: Math.max(1, Math.round(b.h)) };
	});
}

/** Vertical gravity: move every block up as far as it can go without overlapping. */
export function compact<T extends Placed>(blocks: T[]): T[] {
	const sorted = [...blocks].sort((a, b) => a.y - b.y || a.x - b.x);
	const placed: T[] = [];
	for (const b of sorted) {
		const next = { ...b };
		while (next.y > 0 && !placed.some((p) => collides({ ...next, y: next.y - 1 }, p))) next.y--;
		while (placed.some((p) => collides(next, p))) next.y++;
		placed.push(next);
	}
	return placed;
}

/** Place a new block in the first free slot scanning rows top-down. */
export function insert<T extends Placed>(blocks: T[], block: T, cols = COLUMNS): T[] {
	const w = Math.min(cols, block.w);
	const maxY = blocks.reduce((m, b) => Math.max(m, b.y + b.h), 0);
	for (let y = 0; y <= maxY; y++) {
		for (let x = 0; x + w <= cols; x++) {
			const candidate = { ...block, x, y, w };
			if (!blocks.some((b) => collides(candidate, b))) return [...blocks, candidate];
		}
	}
	return [...blocks, { ...block, x: 0, y: maxY, w }];
}

/** Move a block, pushing collisions down, then compact. */
export function move<T extends Placed>(blocks: T[], id: string, x: number, y: number, cols = COLUMNS): T[] {
	const target = blocks.find((b) => b.id === id);
	if (!target) return blocks;
	const moved = { ...target, x: Math.max(0, Math.min(cols - target.w, x)), y: Math.max(0, y) };
	const others = blocks.filter((b) => b.id !== id).map((b) => (collides(moved, b) ? { ...b, y: moved.y + moved.h } : b));
	return compact([moved, ...others]);
}

export function resize<T extends Placed>(blocks: T[], id: string, w: number, h: number, cols = COLUMNS): T[] {
	const target = blocks.find((b) => b.id === id);
	if (!target) return blocks;
	const resized = { ...target, w: Math.max(1, Math.min(cols - target.x, w)), h: Math.max(1, h) };
	const others = blocks.filter((b) => b.id !== id).map((b) => (collides(resized, b) ? { ...b, y: resized.y + resized.h } : b));
	return compact([resized, ...others]);
}
