import type { EntityRecord, EntitySchema, GraphDoc, RelationEdge, RelationType } from '../core/types';
import type { WorldSession } from './WorldSession';

/**
 * The relationship graph (0.11): which entries to draw and how they're joined, plus a
 * small force layout (Barnes–Hut repulsion, springs along connections, a pull to the
 * middle). Pure data, so the page, the widget and the tests share it.
 */

export interface GraphNode {
	id: string;
	entity: EntityRecord;
	schema: EntitySchema;
	/** Connections drawn to it. */
	degree: number;
}

export interface GraphEdge {
	id: string;
	from: string;
	to: string;
	/** Relationship kind id, or `__parent` for "inside of". */
	kind: string;
	type: RelationType | null;
	secret: boolean;
	status: RelationEdge['status'];
	strength: number | null;
	/** How many edges join this pair (0-based index among them), to bend parallels apart. */
	lane: number;
	lanes: number;
}

export interface GraphData {
	nodes: GraphNode[];
	edges: GraphEdge[];
	/** Entries left out because the drawing would get too big. */
	capped: number;
	/** Kinds and types present (for legends and filters), with counts. */
	kinds: Map<string, number>;
	types: Map<string, number>;
}

export const GRAPH_MAX_NODES = 1200;

export type GraphFilter = Pick<GraphDoc, 'types' | 'kinds' | 'tags' | 'focusId' | 'depth' | 'hideIsolated' | 'showSecret' | 'showParents'>;

export function graphData(s: WorldSession, f: GraphFilter): GraphData {
	const typeSet = new Set(f.types);
	const kindSet = new Set(f.kinds);
	const tagSet = new Set(f.tags.map((t) => t.toLowerCase()));
	const schemas = new Map(s.schemas.list().map((t) => [t.id, t]));
	const ok = (e: EntityRecord | undefined): e is EntityRecord =>
		!!e && !e.trashedAt && !e.archivedAt && schemas.has(e.typeId) && (!typeSet.size || typeSet.has(e.typeId)) && (!tagSet.size || e.tags.some((t) => tagSet.has(t.toLowerCase())));

	// Every candidate connection between two entries that pass the filters.
	const raw: Array<Omit<GraphEdge, 'lane' | 'lanes'>> = [];
	for (const e of s.relations.allEdges()) {
		if (e.from === e.to) continue;
		if (kindSet.size && !kindSet.has(e.type)) continue;
		if (e.secret && !f.showSecret) continue;
		if (!ok(s.entities.get(e.from)) || !ok(s.entities.get(e.to))) continue;
		raw.push({ id: e.id, from: e.from, to: e.to, kind: e.type, type: s.relations.type(e.type) ?? null, secret: e.secret, status: e.status, strength: e.strength });
	}
	if (f.showParents) {
		for (const e of s.entities.values()) {
			if (!e.parentId || !ok(e)) continue;
			if (!ok(s.entities.get(e.parentId))) continue;
			raw.push({ id: `p:${e.id}`, from: e.id, to: e.parentId, kind: '__parent', type: null, secret: false, status: null, strength: null });
		}
	}

	// Which entries: everything that passes, or what's near the focus.
	let ids: Set<string>;
	const focus = f.focusId ? s.entities.get(f.focusId) : undefined;
	if (focus && ok(focus)) {
		const adj = new Map<string, string[]>();
		for (const e of raw) {
			(adj.get(e.from) ?? adj.set(e.from, []).get(e.from)!).push(e.to);
			(adj.get(e.to) ?? adj.set(e.to, []).get(e.to)!).push(e.from);
		}
		ids = new Set([focus.id]);
		let ring = [focus.id];
		for (let d = 0; d < f.depth && ring.length; d++) {
			const next: string[] = [];
			for (const id of ring) for (const n of adj.get(id) ?? []) if (!ids.has(n)) {
				ids.add(n);
				next.push(n);
			}
			ring = next;
		}
	} else {
		ids = new Set();
		for (const e of s.entities.values()) if (ok(e)) ids.add(e.id);
		if (f.hideIsolated) {
			const linked = new Set<string>();
			for (const e of raw) {
			linked.add(e.from);
			linked.add(e.to);
		}
			for (const id of [...ids]) if (!linked.has(id)) ids.delete(id);
		}
	}

	const degree = new Map<string, number>();
	let edges = raw.filter((e) => ids.has(e.from) && ids.has(e.to));
	for (const e of edges) {
		degree.set(e.from, (degree.get(e.from) ?? 0) + 1);
		degree.set(e.to, (degree.get(e.to) ?? 0) + 1);
	}
	// Too many to draw: keep the best-connected (and the focus).
	let capped = 0;
	if (ids.size > GRAPH_MAX_NODES) {
		const ranked = [...ids].sort((a, b) => (b === f.focusId ? 1 : 0) - (a === f.focusId ? 1 : 0) || (degree.get(b) ?? 0) - (degree.get(a) ?? 0));
		const keep = new Set(ranked.slice(0, GRAPH_MAX_NODES));
		capped = ids.size - keep.size;
		ids = keep;
		edges = edges.filter((e) => ids.has(e.from) && ids.has(e.to));
		degree.clear();
		for (const e of edges) {
			degree.set(e.from, (degree.get(e.from) ?? 0) + 1);
			degree.set(e.to, (degree.get(e.to) ?? 0) + 1);
		}
	}
	const nodes: GraphNode[] = [...ids]
		.map((id) => s.entities.get(id)!)
		.sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))
		.map((entity) => ({ id: entity.id, entity, schema: schemas.get(entity.typeId)!, degree: degree.get(entity.id) ?? 0 }));

	// Parallel connections between the same two entries bend apart.
	const pairs = new Map<string, number>();
	const pairKey = (e: { from: string; to: string }) => (e.from < e.to ? `${e.from}|${e.to}` : `${e.to}|${e.from}`);
	for (const e of edges) pairs.set(pairKey(e), (pairs.get(pairKey(e)) ?? 0) + 1);
	const seen = new Map<string, number>();
	const out: GraphEdge[] = edges.map((e) => {
		const k = pairKey(e);
		const lane = seen.get(k) ?? 0;
		seen.set(k, lane + 1);
		return { ...e, lane, lanes: pairs.get(k)! };
	});
	const kinds = new Map<string, number>();
	for (const e of out) kinds.set(e.kind, (kinds.get(e.kind) ?? 0) + 1);
	const types = new Map<string, number>();
	for (const n of nodes) types.set(n.schema.id, (types.get(n.schema.id) ?? 0) + 1);
	return { nodes, edges: out, capped, kinds, types };
}

/** Dot radius: bigger for entries with more connections. */
export function nodeRadius(degree: number, byLinks: boolean): number {
	return byLinks ? Math.min(34, 11 + Math.sqrt(degree) * 4.2) : 14;
}

// ── Force layout ─────────────────────────────────────────────────────────────────

export interface SimNode {
	id: string;
	x: number;
	y: number;
	vx: number;
	vy: number;
	r: number;
	/** Pinned by hand (or being dragged): doesn't move. */
	fixed: boolean;
}

interface Quad {
	x0: number;
	y0: number;
	size: number;
	mass: number;
	cx: number;
	cy: number;
	node: SimNode | null;
	kids: Array<Quad | null> | null;
}

function quad(x0: number, y0: number, size: number): Quad {
	return { x0, y0, size, mass: 0, cx: 0, cy: 0, node: null, kids: null };
}

function insert(q: Quad, n: SimNode, depth = 0): void {
	if (!q.mass && !q.kids && !q.node) {
		q.node = n;
		q.mass = 1;
		q.cx = n.x;
		q.cy = n.y;
		return;
	}
	q.cx = (q.cx * q.mass + n.x) / (q.mass + 1);
	q.cy = (q.cy * q.mass + n.y) / (q.mass + 1);
	q.mass += 1;
	if (depth > 40) return; // the same spot: stop splitting
	if (!q.kids) {
		q.kids = [null, null, null, null];
		const old = q.node;
		q.node = null;
		if (old) put(q, old, depth);
	}
	put(q, n, depth);
}

function put(q: Quad, n: SimNode, depth: number): void {
	const h = q.size / 2;
	const i = (n.x >= q.x0 + h ? 1 : 0) + (n.y >= q.y0 + h ? 2 : 0);
	let k = q.kids![i];
	if (!k) k = q.kids![i] = quad(q.x0 + (i & 1 ? h : 0), q.y0 + (i & 2 ? h : 0), h);
	insert(k, n, depth + 1);
}

export interface SimOptions {
	/** 0.5–2. */
	spacing: number;
}

/**
 * A force simulation in the spirit of d3-force, small enough to keep in the plugin.
 * `tick(alpha)` moves every free node one step; alpha cools from 1 towards 0.
 */
export class ForceSim {
	readonly nodes: SimNode[];
	private index = new Map<string, SimNode>();
	private links: Array<{ a: SimNode; b: SimNode; len: number }> = [];
	alpha = 1;

	constructor(nodes: SimNode[], links: Array<{ from: string; to: string }>, private readonly o: SimOptions) {
		this.nodes = nodes;
		for (const n of nodes) this.index.set(n.id, n);
		const L = 90 * o.spacing;
		for (const l of links) {
			const a = this.index.get(l.from);
			const b = this.index.get(l.to);
			if (a && b && a !== b) this.links.push({ a, b, len: L + a.r + b.r });
		}
	}

	node(id: string): SimNode | undefined {
		return this.index.get(id);
	}

	/** Spread nodes that have no position on a sunflower spiral (stable, no randomness). */
	static seed(ids: string[], known: (id: string) => [number, number] | undefined, spacing: number): Array<[number, number]> {
		let i = 0;
		return ids.map((id) => {
			const k = known(id);
			if (k) return k;
			const r = 26 * spacing * Math.sqrt(++i);
			const t = i * 2.399963;
			return [Math.cos(t) * r, Math.sin(t) * r];
		});
	}

	tick(): void {
		const a = this.alpha;
		const ns = this.nodes;
		if (!ns.length) return;
		// Repulsion (Barnes–Hut).
		let x0 = Infinity;
		let y0 = Infinity;
		let x1 = -Infinity;
		let y1 = -Infinity;
		for (const n of ns) {
			if (n.x < x0) x0 = n.x;
			if (n.y < y0) y0 = n.y;
			if (n.x > x1) x1 = n.x;
			if (n.y > y1) y1 = n.y;
		}
		const size = Math.max(x1 - x0, y1 - y0, 1) + 1;
		const root = quad(x0, y0, size);
		for (const n of ns) insert(root, n);
		const strength = -380 * this.o.spacing * this.o.spacing;
		const theta2 = 0.81;
		for (const n of ns) {
			if (n.fixed) continue;
			const stack: Quad[] = [root];
			while (stack.length) {
				const q = stack.pop()!;
				if (!q.mass) continue;
				const dx = q.cx - n.x;
				const dy = q.cy - n.y;
				let d2 = dx * dx + dy * dy;
				if (q.node === n && !q.kids) continue;
				if (q.kids && (q.size * q.size) / Math.max(d2, 1e-6) > theta2) {
					for (const k of q.kids) if (k) stack.push(k);
					continue;
				}
				if (d2 < 1) d2 = 1;
				const w = (strength * q.mass * a) / d2;
				n.vx += dx * w;
				n.vy += dy * w;
			}
		}
		// Springs along connections.
		for (const l of this.links) {
			const dx = l.b.x - l.a.x || 0.01;
			const dy = l.b.y - l.a.y || 0.01;
			const d = Math.sqrt(dx * dx + dy * dy);
			const f = ((d - l.len) / d) * 0.12 * a;
			const fx = dx * f;
			const fy = dy * f;
			if (!l.b.fixed) {
				l.b.vx -= fx;
				l.b.vy -= fy;
			}
			if (!l.a.fixed) {
				l.a.vx += fx;
				l.a.vy += fy;
			}
		}
		// A gentle pull to the middle keeps islands from drifting off.
		for (const n of ns) {
			if (n.fixed) continue;
			n.vx -= n.x * 0.012 * a;
			n.vy -= n.y * 0.012 * a;
		}
		// Move, with friction.
		for (const n of ns) {
			if (n.fixed) {
				n.vx = n.vy = 0;
				continue;
			}
			n.vx *= 0.6;
			n.vy *= 0.6;
			const v = Math.hypot(n.vx, n.vy);
			if (v > 60) {
				n.vx = (n.vx / v) * 60;
				n.vy = (n.vy / v) * 60;
			}
			n.x += n.vx;
			n.y += n.vy;
		}
		// Keep dots from sitting on each other (neighbours on a coarse grid).
		const cell = 80;
		const grid = new Map<string, SimNode[]>();
		for (const n of ns) {
			const k = `${Math.floor(n.x / cell)},${Math.floor(n.y / cell)}`;
			(grid.get(k) ?? grid.set(k, []).get(k)!).push(n);
		}
		for (const n of ns) {
			const gx = Math.floor(n.x / cell);
			const gy = Math.floor(n.y / cell);
			for (let i = -1; i <= 1; i++)
				for (let j = -1; j <= 1; j++) {
					for (const m of grid.get(`${gx + i},${gy + j}`) ?? []) {
						if (m === n || m.id < n.id) continue;
						const dx = m.x - n.x || 0.01;
						const dy = m.y - n.y || 0.01;
						const min = n.r + m.r + 8;
						const d = Math.sqrt(dx * dx + dy * dy);
						if (d >= min) continue;
						const push = ((min - d) / d) * 0.5;
						if (!n.fixed) {
							n.x -= dx * push;
							n.y -= dy * push;
						}
						if (!m.fixed) {
							m.x += dx * push;
							m.y += dy * push;
						}
					}
				}
		}
		this.alpha *= 0.975;
	}

	run(ticks: number): void {
		for (let i = 0; i < ticks && this.alpha > 0.002; i++) this.tick();
	}
}

const KIND_PALETTE = ['blue', 'purple', 'cyan', 'yellow', 'orange', 'pink', 'green', 'red'] as const;
const KIND_DEFAULTS: Record<string, string> = { 'parent-of': 'green', marriage: 'pink', romance: 'red', rivalry: 'orange', mentorship: 'blue', 'member-of': 'purple', 'species-of': 'cyan', alliance: 'yellow' };

/** A kind's own colour, or a steady one picked from its id so every kind reads apart. */
export function kindColor(kind: string, type: RelationType | null | undefined): string {
	if (type?.color) return type.color;
	if (KIND_DEFAULTS[kind]) return KIND_DEFAULTS[kind];
	let h = 0;
	for (let i = 0; i < kind.length; i++) h = (h * 31 + kind.charCodeAt(i)) >>> 0;
	return KIND_PALETTE[h % KIND_PALETTE.length]!;
}
