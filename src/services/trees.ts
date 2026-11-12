import type { EntityRecord, TreeDoc } from '../core/types';
import { formatChrono } from '../core/calendar/engine';
import { isChronoDate } from '../core/types/chrono';
import { spanFields } from './timeline';
import type { WorldSession } from './WorldSession';

/**
 * Family trees and hierarchies (0.11), laid out as pure data so the page, the widget and
 * the tests share one algorithm.
 *
 * Coordinates are abstract: `b` runs across a generation (left to right on a downward
 * tree) and `g` is the generation (0 = the root; negative = ancestors). The renderer
 * turns them into pixels for the chosen direction.
 */

export type TreeRole = 'root' | 'ancestor' | 'descendant' | 'partner' | 'sibling' | 'child' | 'type';

export interface TreeNode {
	/** Unique per drawing (a person can appear twice in a tree that loops back). */
	key: string;
	entityId: string | null;
	gen: number;
	/** Centre of the card across the generation. */
	b: number;
	role: TreeRole;
	/** Already shown elsewhere in this tree (cousin marriages, loops). */
	repeat: boolean;
	/** Hierarchy: how many children it has, and whether they're folded away. */
	children?: number;
	folded?: boolean;
	/** Hierarchy without a root entry: the type's name. */
	label?: string;
}

export interface TreeLink {
	kind: 'child' | 'partner';
	/** Partner: the two cards. Child: the parent card(s) and the child card. */
	from: string[];
	to: string;
}

export interface TreeLayout {
	nodes: TreeNode[];
	links: TreeLink[];
	minB: number;
	maxB: number;
	minG: number;
	maxG: number;
}

export interface FamilyLinks {
	parents(id: string): string[];
	children(id: string): string[];
	partners(id: string): string[];
}

const live = (e: EntityRecord | undefined): e is EntityRecord => !!e && !e.trashedAt;

/** Who is whose parent, child and partner, from the relationship kinds a tree reads. */
export function familyLinks(s: WorldSession, doc: Pick<TreeDoc, 'parentKinds' | 'partnerKinds'>): FamilyLinks {
	const parents = new Map<string, Set<string>>();
	const children = new Map<string, Set<string>>();
	const partners = new Map<string, Set<string>>();
	const add = (m: Map<string, Set<string>>, a: string, b: string) => {
		let set = m.get(a);
		if (!set) m.set(a, (set = new Set()));
		set.add(b);
	};
	const pk = new Set(doc.parentKinds);
	const sk = new Set(doc.partnerKinds);
	for (const e of s.relations.allEdges()) {
		if (e.from === e.to || !live(s.entities.get(e.from)) || !live(s.entities.get(e.to))) continue;
		if (pk.has(e.type)) {
			add(children, e.from, e.to);
			add(parents, e.to, e.from);
		} else if (sk.has(e.type)) {
			add(partners, e.from, e.to);
			add(partners, e.to, e.from);
		}
	}
	const byName = (ids: Iterable<string>) =>
		[...ids].sort((a, b) => {
			const ea = s.entities.get(a)!;
			const eb = s.entities.get(b)!;
			return birthKey(s, ea) - birthKey(s, eb) || ea.sortOrder - eb.sortOrder || ea.name.localeCompare(eb.name);
		});
	return {
		parents: (id) => byName(parents.get(id) ?? []),
		children: (id) => byName(children.get(id) ?? []),
		partners: (id) => byName(partners.get(id) ?? []),
	};
}

/** Sort key for children: by birth date when there is one, else as they were made. */
function birthKey(s: WorldSession, e: EntityRecord): number {
	const schema = s.schemas.get(e.typeId);
	if (!schema) return 0;
	const start = spanFields(schema, s.world.timeline).start;
	const v = start ? e.values[start.id] : undefined;
	// Undated children come after the dated ones.
	return isChronoDate(v) ? v.year * 1000 + (v.month ?? 0) * 40 + (v.day ?? 0) : Number.MAX_SAFE_INTEGER;
}

/** "312 – 380" (birth to death, in the world's calendar). Empty when undated. */
export function lifeDates(s: WorldSession, e: EntityRecord): string {
	const schema = s.schemas.get(e.typeId);
	if (!schema) return '';
	const { start, end } = spanFields(schema, s.world.timeline);
	const a = start ? e.values[start.id] : undefined;
	const b = end ? e.values[end.id] : undefined;
	let fa = isChronoDate(a) ? formatChrono({ ...a, precision: a.precision === 'era' ? 'era' : 'year' }, { short: true }) : '';
	let fb = isChronoDate(b) ? formatChrono({ ...b, precision: b.precision === 'era' ? 'era' : 'year' }, { short: true }) : '';
	const bare = (t: string) => t.replace(/^(c\. )?Year /, '$1');
	[fa, fb] = [bare(fa), bare(fb)];
	if (fa && fb) return `${fa} – ${fb}`;
	if (fa) return `b. ${fa}`;
	if (fb) return `d. ${fb}`;
	return '';
}

export interface TreeMetrics {
	/** Card size across a generation. */
	card: number;
	/** Space between cards in a generation. */
	gap: number;
	/** Space between partners. */
	partnerGap: number;
}

/**
 * A family tree around one person: ancestors above (up to `up` generations), the person
 * with partners and (optionally) brothers and sisters, and descendants below.
 */
export function layoutFamily(s: WorldSession, doc: TreeDoc, m: TreeMetrics, links: FamilyLinks = familyLinks(s, doc)): TreeLayout | null {
	const root = doc.rootId ? s.entities.get(doc.rootId) : undefined;
	if (!live(root)) return null;
	const nodes: TreeNode[] = [];
	const out: TreeLink[] = [];
	const placed = new Map<string, string>(); // entityId → node key
	let seq = 0;
	const node = (entityId: string, gen: number, b: number, role: TreeRole): TreeNode => {
		const repeat = placed.has(entityId);
		const n: TreeNode = { key: `n${seq++}`, entityId, gen, b, role, repeat };
		if (!repeat) placed.set(entityId, n.key);
		nodes.push(n);
		return n;
	};

	// ── Descendants: measure, then place. ──
	interface Unit {
		id: string;
		partners: string[];
		kids: Unit[];
		/** Kids already shown elsewhere: drawn as small repeat cards. */
		width: number;
		repeat: boolean;
	}
	const claimed = new Set<string>([root.id]);
	const measure = (id: string, gen: number, repeat: boolean): Unit => {
		const partners = !repeat && doc.show.partners ? links.partners(id).filter((p) => !claimed.has(p)) : [];
		for (const p of partners) claimed.add(p);
		const kidIds = !repeat && gen < doc.down ? [...new Set([...links.children(id), ...partners.flatMap((p) => links.children(p))])] : [];
		const kids: Unit[] = [];
		for (const k of kidIds) {
			const again = claimed.has(k);
			claimed.add(k);
			kids.push(measure(k, gen + 1, again));
		}
		const own = (1 + partners.length) * m.card + partners.length * m.partnerGap;
		const kidsW = kids.reduce((n, k) => n + k.width, 0) + Math.max(0, kids.length - 1) * m.gap;
		return { id, partners, kids, width: Math.max(own, kidsW), repeat };
	};
	const place = (u: Unit, left: number, gen: number, role: TreeRole): TreeNode => {
		const own = (1 + u.partners.length) * m.card + u.partners.length * m.partnerGap;
		let b = left + (u.width - own) / 2 + m.card / 2;
		const me = node(u.id, gen, b, role);
		if (u.repeat) me.repeat = true;
		const couple = [me];
		for (const p of u.partners) {
			b += m.card + m.partnerGap;
			const pn = node(p, gen, b, 'partner');
			out.push({ kind: 'partner', from: [couple[couple.length - 1]!.key], to: pn.key });
			couple.push(pn);
		}
		const kidsW = u.kids.reduce((n, k) => n + k.width, 0) + Math.max(0, u.kids.length - 1) * m.gap;
		let x = left + (u.width - kidsW) / 2;
		for (const k of u.kids) {
			const kn = place(k, x, gen + 1, 'descendant');
			x += k.width + m.gap;
			// From the couple when both are this child's parents, else from the one who is.
			const theirs = new Set(links.parents(k.id));
			const from = couple.filter((c) => theirs.has(c.entityId!));
			out.push({ kind: 'child', from: (from.length ? from : [me]).map((c) => c.key), to: kn.key });
		}
		return me;
	};
	const tree = measure(root.id, 0, false);
	const rootNode = place(tree, 0, 0, 'root');
	const shift = -rootNode.b;
	for (const n of nodes) n.b += shift;

	// ── Brothers and sisters, to the left of the root's family. ──
	const rootParents = links.parents(root.id);
	const sibs = doc.show.siblings ? [...new Set(rootParents.flatMap((p) => links.children(p)))].filter((id) => id !== root.id && !claimed.has(id)) : [];
	const descMin = Math.min(...nodes.filter((n) => n.gen === 0).map((n) => n.b));
	const sibNodes: TreeNode[] = [];
	sibs.reverse().forEach((id, i) => {
		claimed.add(id);
		sibNodes.unshift(node(id, 0, descMin - (i + 1) * (m.card + m.gap), 'sibling'));
	});

	// ── Ancestors: measure, then place centred over the root. ──
	interface Anc {
		id: string;
		parents: Anc[];
		width: number;
		repeat: boolean;
	}
	const seen = new Set<string>([root.id, ...claimed]);
	const ancMeasure = (id: string, depth: number, repeat: boolean): Anc => {
		const ps = !repeat && depth < doc.up ? links.parents(id) : [];
		const parents: Anc[] = [];
		for (const p of ps) {
			const again = seen.has(p);
			seen.add(p);
			parents.push(ancMeasure(p, depth + 1, again));
		}
		const w = parents.reduce((n, p) => n + p.width, 0) + Math.max(0, parents.length - 1) * m.gap;
		return { id, parents, width: Math.max(m.card, w), repeat };
	};
	const ancPlace = (a: Anc, centre: number, gen: number, child: TreeNode, childIsSiblingBar: TreeNode[]): void => {
		const w = a.parents.reduce((n, p) => n + p.width, 0) + Math.max(0, a.parents.length - 1) * m.gap;
		let x = centre - w / 2;
		const parentNodes: TreeNode[] = [];
		for (const p of a.parents) {
			const pn = node(p.id, gen, x + p.width / 2, 'ancestor');
			if (p.repeat) pn.repeat = true;
			parentNodes.push(pn);
			x += p.width + m.gap;
			if (!p.repeat) ancPlace(p, pn.b, gen - 1, pn, []);
		}
		for (let i = 1; i < parentNodes.length; i++) {
			const a1 = parentNodes[i - 1]!;
			const a2 = parentNodes[i]!;
			if (links.partners(a1.entityId!).includes(a2.entityId!)) out.push({ kind: 'partner', from: [a1.key], to: a2.key });
		}
		for (const c of [child, ...childIsSiblingBar]) {
			// Half-brothers and sisters hang from the parent they share.
			const theirs = new Set(links.parents(c.entityId!));
			const from = parentNodes.filter((p) => theirs.has(p.entityId!));
			if (from.length) out.push({ kind: 'child', from: from.map((p) => p.key), to: c.key });
		}
	};
	if (doc.up > 0 && rootParents.length) {
		const anc = ancMeasure(root.id, 0, false);
		const sibOfRoot = sibNodes.filter((n) => {
			const theirs = new Set(links.parents(n.entityId!));
			return rootParents.some((p) => theirs.has(p));
		});
		ancPlace(anc, 0, -1, nodes.find((n) => n.key === rootNode.key)!, sibOfRoot);
	} else if (sibNodes.length) {
		// No parents drawn: nothing joins the siblings, so leave them out.
		for (const n of sibNodes) nodes.splice(nodes.indexOf(n), 1);
	}
	return bounds(nodes, out);
}

function bounds(nodes: TreeNode[], links: TreeLink[]): TreeLayout {
	return {
		nodes,
		links,
		minB: Math.min(...nodes.map((n) => n.b)),
		maxB: Math.max(...nodes.map((n) => n.b)),
		minG: Math.min(...nodes.map((n) => n.gen)),
		maxG: Math.max(...nodes.map((n) => n.gen)),
	};
}

/** Live children of an entry (or top-level entries of a type), in their saved order. */
export function hierarchyChildren(s: WorldSession, parentId: string | null, typeId?: string | null): EntityRecord[] {
	const out: EntityRecord[] = [];
	for (const e of s.entities.values()) {
		if (e.trashedAt || e.archivedAt) continue;
		if (parentId) {
			if (e.parentId === parentId) out.push(e);
		} else if (typeId && e.typeId === typeId) {
			const p = e.parentId ? s.entities.get(e.parentId) : undefined;
			if (!live(p)) out.push(e);
		}
	}
	return out.sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
}

/** A hierarchy (places inside places, groups inside groups) from an entry or a type. */
export function layoutHierarchy(s: WorldSession, doc: TreeDoc, m: TreeMetrics): TreeLayout | null {
	const root = doc.rootId ? s.entities.get(doc.rootId) : undefined;
	const type = !root && doc.typeId ? s.schemas.get(doc.typeId) : undefined;
	if (!live(root) && !type) return null;
	const folded = new Set(doc.collapsed);
	const nodes: TreeNode[] = [];
	const links: TreeLink[] = [];
	const seen = new Set<string>();
	let seq = 0;
	interface H {
		id: string | null;
		kids: H[];
		width: number;
		count: number;
		folded: boolean;
	}
	const measure = (id: string | null, gen: number): H => {
		const all = id ? hierarchyChildren(s, id) : hierarchyChildren(s, null, type!.id);
		const isFolded = !!id && folded.has(id) && all.length > 0;
		const kids: H[] = [];
		if (!isFolded && gen < doc.down) {
			for (const k of all) {
				if (seen.has(k.id)) continue;
				seen.add(k.id);
				kids.push(measure(k.id, gen + 1));
			}
		}
		const w = kids.reduce((n, k) => n + k.width, 0) + Math.max(0, kids.length - 1) * m.gap;
		return { id, kids, width: Math.max(m.card, w), count: all.length, folded: isFolded || (gen >= doc.down && all.length > 0) };
	};
	if (root) seen.add(root.id);
	const place = (h: H, left: number, gen: number): TreeNode => {
		const n: TreeNode = { key: `h${seq++}`, entityId: h.id, gen, b: left + h.width / 2, role: gen === 0 ? (h.id ? 'root' : 'type') : 'child', repeat: false, children: h.count, folded: h.folded };
		if (!h.id) n.label = type!.plural;
		nodes.push(n);
		const kidsW = h.kids.reduce((x, k) => x + k.width, 0) + Math.max(0, h.kids.length - 1) * m.gap;
		let x = left + (h.width - kidsW) / 2;
		for (const k of h.kids) {
			const kn = place(k, x, gen + 1);
			links.push({ kind: 'child', from: [n.key], to: kn.key });
			x += k.width + m.gap;
		}
		return n;
	};
	const tree = measure(root?.id ?? null, 0);
	const top = place(tree, 0, 0);
	const shift = -top.b;
	for (const n of nodes) n.b += shift;
	return bounds(nodes, links);
}
