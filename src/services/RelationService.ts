import { RECORD_VERSIONS } from '../app/constants';
import type { EventBus } from '../core/events/EventBus';
import type { WorldsmithEvents } from '../core/events/events';
import type {
	EdgePatch,
	EntityRecord,
	EntitySchema,
	FieldDefinition,
	LinkedEntry,
	RelationEdge,
	RelationFieldConfig,
	RelationType,
	RelationTypeTemplate,
} from '../core/types';
import { clone, jsonEqual } from '../core/util/clone';
import { slugId, uuid } from '../core/util/ids';
import type { EntityRepository } from '../data/repositories/EntityRepository';
import type { BucketStore } from '../data/storage/BucketStore';
import type { Disposable } from '../core/util/disposable';

/** A connection seen from one of its ends. */
export interface EdgeView {
	edge: RelationEdge;
	type: RelationType | undefined;
	/** The entry at the other end. */
	other: EntityRecord;
	/** Heading for `other` as seen from the viewing entry ("Students", "Mentors"). */
	label: string;
	/** Whether the viewing entry is the edge's `from` (always true for symmetric types). */
	outgoing: boolean;
}

export interface LinkResult {
	edge?: RelationEdge;
	/** Connections removed to make room (single-link fields). */
	replaced: RelationEdge[];
	error?: string;
}

export interface RelationTypeInput {
	label: string;
	forwardLabel?: string;
	reverseLabel?: string;
	symmetric?: boolean;
	category?: string;
	description?: string;
	icon?: string;
	sourceTypes?: string[];
	targetTypes?: string[];
}

export type RelationTypePatch = Partial<Omit<RelationType, 'id' | 'v' | 'origin' | 'createdAt' | 'updatedAt' | 'rev'>>;

/** Read a relation field's config defensively (hand-edited or older schemas). */
export function relationConfig(field: FieldDefinition): RelationFieldConfig {
	const c = field.config ?? {};
	return {
		relationType: typeof c.relationType === 'string' && c.relationType ? c.relationType : null,
		direction: c.direction === 'reverse' ? 'reverse' : 'forward',
		targetTypes: Array.isArray(c.targetTypes) ? c.targetTypes.filter((x): x is string => typeof x === 'string') : [],
		max: typeof c.max === 'number' && c.max > 0 ? Math.floor(c.max) : null,
	};
}

/**
 * Connections between entries. One edge = one connection; relation fields on both ends
 * are views over it, so the two sides can never disagree.
 *
 *  - Edges survive trashing (hidden while the other end is in the trash) and are removed
 *    only when an entry is deleted permanently.
 *  - Every removal returns the removed edges so the UI can offer Undo (`restore`).
 */
export class RelationService {
	/** entity id → ids of edges touching it (either end). */
	private byEntity = new Map<string, Set<string>>();
	private subs: Disposable[] = [];

	constructor(
		private readonly typeStore: BucketStore<RelationType>,
		private readonly edgeStore: BucketStore<RelationEdge>,
		private readonly entities: EntityRepository,
		private readonly events: EventBus<WorldsmithEvents>,
	) {
		for (const e of edgeStore.values()) this.indexEdge(e);
		// Permanent delete removes the entry's connections in both directions.
		this.subs.push(events.on('entity:deleted', ({ entity }) => void this.removeAllFor(entity.id)));
	}

	dispose(): void {
		for (const s of this.subs) s.dispose();
		this.subs = [];
	}

	// ── relationship types ─────────────────────────────────────────────────────

	types(): RelationType[] {
		return this.typeStore.all().sort((a, b) => a.category.localeCompare(b.category) || a.label.localeCompare(b.label));
	}

	type(id: string | null | undefined): RelationType | undefined {
		return id ? this.typeStore.get(id) : undefined;
	}

	installTemplate(t: RelationTypeTemplate): RelationType {
		const now = Date.now();
		const { templateVersion, ...rest } = clone(t);
		const type: RelationType = {
			...rest,
			v: RECORD_VERSIONS.relationType,
			reverseLabel: rest.symmetric ? rest.forwardLabel : rest.reverseLabel,
			origin: { templateId: t.id, templateVersion: templateVersion ?? 1 },
			createdAt: now,
			updatedAt: now,
			rev: 0,
		};
		this.typeStore.put(type);
		this.events.emit('relationType:created', { type });
		return type;
	}

	/**
	 * Make sure the world has the relationship types it needs: every built-in on first
	 * use, plus a type for every relation field that names one that doesn't exist (e.g. a
	 * schema imported from another world). Never removes or overwrites existing types.
	 */
	ensureSeeded(templates: RelationTypeTemplate[], schemas: EntitySchema[]): number {
		let added = 0;
		if (this.typeStore.size === 0) {
			for (const t of templates) {
				this.installTemplate(t);
				added++;
			}
		}
		for (const schema of schemas) {
			for (const f of schema.fields) {
				if (f.type !== 'relation') continue;
				const cfg = relationConfig(f);
				if (!cfg.relationType || this.typeStore.has(cfg.relationType)) continue;
				const tpl = templates.find((t) => t.id === cfg.relationType);
				if (tpl) this.installTemplate(tpl);
				else
					this.putType({
						id: cfg.relationType,
						label: f.label,
						forwardLabel: f.label,
						reverseLabel: `${f.label} of`,
						symmetric: false,
						category: 'Custom',
						sourceTypes: [schema.id],
						targetTypes: cfg.targetTypes,
						fields: [],
					});
				added++;
			}
		}
		return added;
	}

	createType(input: RelationTypeInput): RelationType {
		const label = input.label.trim() || 'Connection';
		const symmetric = !!input.symmetric;
		const forwardLabel = input.forwardLabel?.trim() || label;
		return this.putType({
			id: slugId(label, this.typeStore.all().map((t) => t.id)),
			label,
			forwardLabel,
			reverseLabel: symmetric ? forwardLabel : input.reverseLabel?.trim() || `${label} of`,
			symmetric,
			category: input.category?.trim() || 'Custom',
			description: input.description,
			icon: input.icon,
			sourceTypes: input.sourceTypes ?? [],
			targetTypes: input.targetTypes ?? [],
			fields: [],
		});
	}

	private putType(t: Omit<RelationType, 'v' | 'origin' | 'createdAt' | 'updatedAt' | 'rev'>): RelationType {
		const now = Date.now();
		const type: RelationType = { ...t, v: RECORD_VERSIONS.relationType, origin: null, createdAt: now, updatedAt: now, rev: 0 };
		if (!type.description) delete type.description;
		if (!type.icon) delete type.icon;
		this.typeStore.put(type);
		this.events.emit('relationType:created', { type });
		return type;
	}

	updateType(id: string, patch: RelationTypePatch): RelationType {
		const prev = this.typeStore.get(id);
		if (!prev) throw new Error(`Unknown relationship type “${id}”.`);
		const next: RelationType = { ...prev, ...clone(patch), updatedAt: Date.now(), rev: prev.rev + 1 };
		for (const [k, v] of Object.entries(patch)) if (v === undefined) delete (next as unknown as Record<string, unknown>)[k];
		next.label = next.label.trim() || prev.label;
		next.forwardLabel = next.forwardLabel.trim() || next.label;
		next.reverseLabel = next.symmetric ? next.forwardLabel : next.reverseLabel.trim() || `${next.label} of`;
		this.typeStore.put(next);
		this.events.emit('relationType:updated', { type: next });
		return next;
	}

	/** How much uses a relationship type. */
	typeUsage(id: string, schemas: EntitySchema[]): { edges: number; fields: Array<{ schema: EntitySchema; field: FieldDefinition }> } {
		let edges = 0;
		for (const e of this.edgeStore.values()) if (e.type === id) edges++;
		const fields: Array<{ schema: EntitySchema; field: FieldDefinition }> = [];
		for (const schema of schemas) {
			for (const field of schema.fields) if (field.type === 'relation' && relationConfig(field).relationType === id) fields.push({ schema, field });
		}
		return { edges, fields };
	}

	/** Delete an unused relationship type. Refuses while connections or fields use it. */
	deleteType(id: string, schemas: EntitySchema[]): RelationType {
		const t = this.typeStore.get(id);
		if (!t) throw new Error(`Unknown relationship type “${id}”.`);
		const usage = this.typeUsage(id, schemas);
		if (usage.edges) throw new Error(`“${t.label}” is used by ${usage.edges} connection${usage.edges === 1 ? '' : 's'}. Change or remove them first.`);
		if (usage.fields.length) {
			const names = usage.fields.map((u) => `${u.schema.plural} → ${u.field.label}`).join(', ');
			throw new Error(`“${t.label}” is used by these fields: ${names}. Point them at another relationship first.`);
		}
		this.typeStore.delete(id);
		this.events.emit('relationType:deleted', { type: t });
		return t;
	}

	/** Put a deleted type back (undo). */
	restoreType(t: RelationType): void {
		if (this.typeStore.has(t.id)) return;
		this.typeStore.put(clone(t));
		this.events.emit('relationType:created', { type: t });
	}

	// ── reading edges ─────────────────────────────────────────────────────────

	edge(id: string): RelationEdge | undefined {
		return this.edgeStore.get(id);
	}

	allEdges(): RelationEdge[] {
		return this.edgeStore.all();
	}

	/** Raw edges touching an entry (either end), including ones to trashed entries. */
	edgesTouching(entityId: string): RelationEdge[] {
		const ids = this.byEntity.get(entityId);
		if (!ids) return [];
		const out: RelationEdge[] = [];
		for (const id of ids) {
			const e = this.edgeStore.get(id);
			if (e) out.push(e);
		}
		return out.sort(byOrder);
	}

	/** Number of connections touching an entry (for delete warnings). */
	count(entityId: string): number {
		return this.byEntity.get(entityId)?.size ?? 0;
	}

	/** Every connection of an entry, from its point of view. Trashed other ends are skipped. */
	viewsOf(entityId: string, opts: { includeTrashed?: boolean } = {}): EdgeView[] {
		const out: EdgeView[] = [];
		for (const edge of this.edgesTouching(entityId)) {
			const view = this.view(edge, entityId);
			if (!view) continue;
			if (view.other.trashedAt && !opts.includeTrashed) continue;
			out.push(view);
		}
		return out;
	}

	/** One connection seen from `viewerId`'s end. */
	view(edge: RelationEdge, viewerId: string): EdgeView | null {
		const outgoing = edge.from === viewerId;
		const otherId = outgoing ? edge.to : edge.from;
		if (!outgoing && edge.to !== viewerId) return null;
		const other = this.entities.get(otherId);
		if (!other) return null;
		const type = this.typeStore.get(edge.type);
		const label = type ? (type.symmetric || outgoing ? type.forwardLabel : type.reverseLabel) : edge.type;
		return { edge, type, other, label, outgoing: outgoing || !!type?.symmetric };
	}

	/** Connections a relation field shows for an entry, in order. */
	fieldViews(entityId: string, field: FieldDefinition, opts: { includeTrashed?: boolean } = {}): EdgeView[] {
		const cfg = relationConfig(field);
		if (!cfg.relationType) return [];
		const type = this.typeStore.get(cfg.relationType);
		const symmetric = !!type?.symmetric;
		const out: EdgeView[] = [];
		for (const edge of this.edgesTouching(entityId)) {
			if (edge.type !== cfg.relationType) continue;
			let otherId: string;
			if (symmetric) otherId = edge.from === entityId ? edge.to : edge.from;
			else if (cfg.direction === 'forward') {
				if (edge.from !== entityId) continue;
				otherId = edge.to;
			} else {
				if (edge.to !== entityId) continue;
				otherId = edge.from;
			}
			const other = this.entities.get(otherId);
			if (!other) continue;
			if (other.trashedAt && !opts.includeTrashed) continue;
			if (cfg.targetTypes.length && !cfg.targetTypes.includes(other.typeId)) continue;
			const label = type ? (symmetric || cfg.direction === 'forward' ? type.forwardLabel : type.reverseLabel) : field.label;
			out.push({ edge, type, other, label, outgoing: symmetric || cfg.direction === 'forward' });
		}
		return out;
	}

	/** The value of a relation field: the linked entries. */
	linked(entityId: string, field: FieldDefinition): LinkedEntry[] {
		return this.fieldViews(entityId, field).map((v) => ({ edgeId: v.edge.id, id: v.other.id, name: v.other.name }));
	}

	/** An existing edge of `type` between two entries (either order for symmetric types). */
	findEdge(typeId: string, fromId: string, toId: string): RelationEdge | undefined {
		const symmetric = !!this.typeStore.get(typeId)?.symmetric;
		for (const e of this.edgesTouching(fromId)) {
			if (e.type !== typeId) continue;
			if (e.from === fromId && e.to === toId) return e;
			if (symmetric && e.from === toId && e.to === fromId) return e;
		}
		return undefined;
	}

	// ── writing edges ─────────────────────────────────────────────────────────

	/** Why `targetId` can't be added to this field right now (null = it can). */
	linkProblem(entityId: string, field: FieldDefinition, targetId: string): string | null {
		const cfg = relationConfig(field);
		if (!cfg.relationType) return 'Choose what this field links to in its settings first.';
		if (!this.typeStore.has(cfg.relationType)) return `The relationship type “${cfg.relationType}” no longer exists.`;
		if (entityId === targetId) return 'An entry can’t be linked to itself.';
		const target = this.entities.get(targetId);
		if (!target) return 'That entry no longer exists.';
		if (cfg.targetTypes.length && !cfg.targetTypes.includes(target.typeId)) return `${field.label} only links to other kinds of entries.`;
		const [from, to] = this.ends(cfg, entityId, targetId);
		if (this.findEdge(cfg.relationType, from, to)) return `${target.name} is already linked.`;
		return null;
	}

	/**
	 * Link `targetId` through a relation field. Single-link fields (max 1) replace their
	 * current link; the replaced connections are returned for Undo.
	 */
	link(entityId: string, field: FieldDefinition, targetId: string): LinkResult {
		const problem = this.linkProblem(entityId, field, targetId);
		if (problem) return { replaced: [], error: problem };
		const cfg = relationConfig(field);
		const current = this.fieldViews(entityId, field);
		const replaced: RelationEdge[] = [];
		if (cfg.max === 1) {
			for (const v of current) {
				const removed = this.unlink(v.edge.id);
				if (removed) replaced.push(removed);
			}
		} else if (cfg.max !== null && current.length >= cfg.max) {
			return { replaced: [], error: `${field.label} holds at most ${cfg.max} entries.` };
		}
		const [from, to] = this.ends(cfg, entityId, targetId);
		const edge = this.connect(from, cfg.relationType as string, to);
		return { edge, replaced };
	}

	private ends(cfg: RelationFieldConfig, entityId: string, targetId: string): [string, string] {
		const symmetric = !!this.type(cfg.relationType)?.symmetric;
		return symmetric || cfg.direction === 'forward' ? [entityId, targetId] : [targetId, entityId];
	}

	/** Create a connection. Returns the existing one if it's already there. */
	connect(fromId: string, typeId: string, toId: string, init: EdgePatch = {}): RelationEdge {
		if (fromId === toId) throw new Error('An entry can’t be connected to itself.');
		if (!this.entities.get(fromId) || !this.entities.get(toId)) throw new Error('Both entries must exist.');
		if (!this.typeStore.has(typeId)) throw new Error(`Unknown relationship type “${typeId}”.`);
		const existing = this.findEdge(typeId, fromId, toId);
		if (existing) return existing;
		const now = Date.now();
		const edge: RelationEdge = {
			v: RECORD_VERSIONS.edge,
			id: uuid(),
			type: typeId,
			from: fromId,
			to: toId,
			status: null,
			strength: null,
			secret: false,
			start: null,
			end: null,
			description: '',
			notes: '',
			props: {},
			order: now,
			createdAt: now,
			updatedAt: now,
			rev: 0,
			...clone(init),
		};
		this.edgeStore.put(edge);
		this.indexEdge(edge);
		this.events.emit('edge:created', { edge });
		return edge;
	}

	updateEdge(id: string, patch: EdgePatch): RelationEdge | null {
		const prev = this.edgeStore.get(id);
		if (!prev) return null;
		const next: RelationEdge = { ...prev };
		const keys: string[] = [];
		for (const [k, v] of Object.entries(patch)) {
			if (k === 'props') continue;
			const value = k === 'secret' ? !!v : k === 'description' || k === 'notes' ? (typeof v === 'string' ? v : '') : v;
			if (!jsonEqual((prev as unknown as Record<string, unknown>)[k], value)) {
				(next as unknown as Record<string, unknown>)[k] = value === undefined ? null : clone(value);
				keys.push(k);
			}
		}
		if (patch.props) {
			const props = { ...prev.props };
			for (const [k, v] of Object.entries(patch.props)) {
				if (v === undefined || v === null || v === '') {
					if (k in props) {
						delete props[k];
						keys.push(`props.${k}`);
					}
				} else if (!jsonEqual(props[k], v)) {
					props[k] = clone(v);
					keys.push(`props.${k}`);
				}
			}
			next.props = props;
		}
		if (!keys.length) return prev;
		return this.replace(prev, next, keys);
	}

	/** Reverse a connection's direction (mentor ↔ student). */
	swap(id: string): RelationEdge | null {
		const prev = this.edgeStore.get(id);
		if (!prev) return null;
		if (this.findEdge(prev.type, prev.to, prev.from)) throw new Error('That connection already exists the other way round.');
		return this.replace(prev, { ...prev, from: prev.to, to: prev.from }, ['from', 'to']);
	}

	/** Re-type a connection (friend → rival). Keeps its notes and properties. */
	changeType(id: string, typeId: string): RelationEdge | null {
		const prev = this.edgeStore.get(id);
		if (!prev) return null;
		if (!this.typeStore.has(typeId)) throw new Error(`Unknown relationship type “${typeId}”.`);
		if (prev.type === typeId) return prev;
		if (this.findEdge(typeId, prev.from, prev.to)) throw new Error('These two entries already have that connection.');
		return this.replace(prev, { ...prev, type: typeId }, ['type']);
	}

	private replace(prev: RelationEdge, next: RelationEdge, keys: string[]): RelationEdge {
		next.rev = prev.rev + 1;
		next.updatedAt = Date.now();
		this.unindexEdge(prev);
		this.edgeStore.put(next);
		this.indexEdge(next);
		this.events.emit('edge:updated', { edge: next, prev, keys });
		return next;
	}

	/** Remove one connection. Returns it for Undo. */
	unlink(id: string): RelationEdge | null {
		const prev = this.edgeStore.get(id);
		if (!prev) return null;
		this.edgeStore.delete(id);
		this.unindexEdge(prev);
		this.events.emit('edge:deleted', { edge: prev });
		return prev;
	}

	/** Put removed connections back exactly as they were (Undo). */
	restore(edges: RelationEdge[]): number {
		let n = 0;
		for (const e of edges) {
			if (this.edgeStore.has(e.id)) continue;
			if (!this.entities.get(e.from) || !this.entities.get(e.to)) continue;
			const copy = clone(e);
			this.edgeStore.put(copy);
			this.indexEdge(copy);
			this.events.emit('edge:created', { edge: copy });
			n++;
		}
		return n;
	}

	/** Remove every connection of an entry (permanent delete). */
	removeAllFor(entityId: string): RelationEdge[] {
		const removed: RelationEdge[] = [];
		for (const e of this.edgesTouching(entityId)) {
			const r = this.unlink(e.id);
			if (r) removed.push(r);
		}
		this.byEntity.delete(entityId);
		return removed;
	}

	/** Give a duplicated entry the same connections as its source. */
	copyConnections(sourceId: string, copyId: string): number {
		let n = 0;
		for (const e of this.edgesTouching(sourceId)) {
			const from = e.from === sourceId ? copyId : e.from;
			const to = e.to === sourceId ? copyId : e.to;
			if (from === to) continue;
			const { id: _id, from: _f, to: _t, createdAt: _c, updatedAt: _u, rev: _r, v: _v, type, ...rest } = e;
			void [_id, _f, _t, _c, _u, _r, _v];
			this.connect(from, type, to, rest);
			n++;
		}
		return n;
	}

	// ── index ─────────────────────────────────────────────────────────────────

	private indexEdge(e: RelationEdge): void {
		for (const id of [e.from, e.to]) {
			let set = this.byEntity.get(id);
			if (!set) {
				set = new Set();
				this.byEntity.set(id, set);
			}
			set.add(e.id);
		}
	}

	private unindexEdge(e: RelationEdge): void {
		this.byEntity.get(e.from)?.delete(e.id);
		this.byEntity.get(e.to)?.delete(e.id);
	}
}

function byOrder(a: RelationEdge, b: RelationEdge): number {
	return a.order - b.order || a.createdAt - b.createdAt;
}
