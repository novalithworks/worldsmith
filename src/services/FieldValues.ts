import type { ChronoDate, EntityRecord, FieldDefinition, LinkedEntry, RollupAggregate, RollupFieldConfig } from '../core/types';
import { chronoOrdinal, isChronoDate } from '../core/types';
import type { EntityIndex } from '../data/indexes/EntityIndex';
import type { EntityRepository } from '../data/repositories/EntityRepository';
import type { FieldTypeRegistry } from '../fields/FieldTypeRegistry';
import type { RelationService } from './RelationService';
import type { SchemaService } from './SchemaService';

export const ROLLUP_AGGREGATES: Array<{ id: RollupAggregate; label: string; needs: 'none' | 'any' | 'number' | 'date' }> = [
	{ id: 'count', label: 'Count', needs: 'none' },
	{ id: 'list', label: 'List values', needs: 'any' },
	{ id: 'unique', label: 'List unique values', needs: 'any' },
	{ id: 'sum', label: 'Sum', needs: 'number' },
	{ id: 'avg', label: 'Average', needs: 'number' },
	{ id: 'min', label: 'Smallest', needs: 'number' },
	{ id: 'max', label: 'Largest', needs: 'number' },
	{ id: 'earliest', label: 'Earliest date', needs: 'date' },
	{ id: 'latest', label: 'Latest date', needs: 'date' },
];

export function rollupConfig(field: FieldDefinition): RollupFieldConfig {
	const c = field.config ?? {};
	const agg = ROLLUP_AGGREGATES.some((a) => a.id === c.aggregate) ? (c.aggregate as RollupAggregate) : 'count';
	return {
		relationField: typeof c.relationField === 'string' && c.relationField ? c.relationField : null,
		targetField: typeof c.targetField === 'string' && c.targetField ? c.targetField : null,
		aggregate: agg,
	};
}

/**
 * Whether a field kind has a value worth showing on cards, tables and subtitles:
 * stored kinds plus links and rollups (formulas aren't implemented yet).
 */
export function showsValue(logic: { computed?: boolean; category: string; id: string }): boolean {
	return !logic.computed || logic.category === 'relation' || logic.id === 'rollup';
}

/** Kinds whose value is a list of linked entries (rollups can run over them). */
export const LINK_KINDS = new Set(['relation', 'parent', 'children']);

/**
 * The value of any field on any entry — stored values for ordinary fields, derived values
 * for relation-family and computed fields. Every display (pages, cards, tables, subtitles,
 * completeness) reads through here so they all agree.
 */
export class FieldValues {
	constructor(
		private readonly entities: EntityRepository,
		private readonly index: EntityIndex,
		private readonly schemas: SchemaService,
		private readonly fieldTypes: FieldTypeRegistry,
		private readonly relations: () => RelationService,
	) {}

	get(entity: EntityRecord, field: FieldDefinition, depth = 0): unknown {
		switch (field.type) {
			case 'relation':
				return this.relations().linked(entity.id, field);
			case 'parent': {
				const p = entity.parentId ? this.entities.get(entity.parentId) : undefined;
				return p && !p.trashedAt ? [{ edgeId: '', id: p.id, name: p.name }] : [];
			}
			case 'children':
				return this.index.childrenOf(entity.id).map((c) => ({ edgeId: '', id: c.id, name: c.name }) satisfies LinkedEntry);
			case 'rollup':
				return depth > 3 ? null : this.rollup(entity, field, depth);
			default:
				return entity.values[field.id];
		}
	}

	text(entity: EntityRecord, field: FieldDefinition): string {
		return this.fieldTypes.toText(field, this.get(entity, field));
	}

	isEmpty(entity: EntityRecord, field: FieldDefinition): boolean {
		return this.fieldTypes.isEmpty(field, this.get(entity, field));
	}

	/**
	 * Order two entries by a field the way that field's kind orders values (choices by
	 * option order, dates and fictional dates chronologically, numbers numerically).
	 * Empty values aren't handled here; callers decide where blanks go.
	 */
	compare(a: EntityRecord, b: EntityRecord, field: FieldDefinition): number {
		const logic = this.fieldTypes.for(field);
		const va = this.get(a, field);
		const vb = this.get(b, field);
		if (logic.compare) return logic.compare(va, vb, field);
		return logic.toText(va, field).localeCompare(logic.toText(vb, field), undefined, { numeric: true, sensitivity: 'base' });
	}

	/** Linked entries a rollup runs over. */
	private linkedEntities(entity: EntityRecord, fieldId: string | null, depth: number): EntityRecord[] {
		if (!fieldId) return [];
		const schema = this.schemas.get(entity.typeId);
		const via = schema?.fields.find((f) => f.id === fieldId);
		if (!via || !LINK_KINDS.has(via.type)) return [];
		const linked = this.get(entity, via, depth + 1);
		if (!Array.isArray(linked)) return [];
		return (linked as LinkedEntry[]).map((l) => this.entities.get(l.id)).filter((e): e is EntityRecord => !!e && !e.trashedAt);
	}

	private rollup(entity: EntityRecord, field: FieldDefinition, depth: number): unknown {
		const cfg = rollupConfig(field);
		const linked = this.linkedEntities(entity, cfg.relationField, depth);
		if (cfg.aggregate === 'count') return linked.length;

		// Values of the target field on each linked entry (names when no field chosen).
		const values: unknown[] = [];
		for (const other of linked) {
			if (!cfg.targetField || cfg.targetField === '__name') {
				values.push(other.name);
				continue;
			}
			const f = this.schemas.get(other.typeId)?.fields.find((x) => x.id === cfg.targetField);
			if (!f) continue;
			const v = this.get(other, f, depth + 1);
			if (this.fieldTypes.isEmpty(f, v)) continue;
			if (cfg.aggregate === 'list' || cfg.aggregate === 'unique') {
				const t = this.fieldTypes.toText(f, v);
				if (t) values.push(t);
			} else values.push(v);
		}

		switch (cfg.aggregate) {
			case 'list':
				return values.map(String);
			case 'unique': {
				const seen = new Set<string>();
				const out: string[] = [];
				for (const v of values.map(String)) {
					const k = v.toLowerCase();
					if (seen.has(k)) continue;
					seen.add(k);
					out.push(v);
				}
				return out;
			}
			case 'sum':
			case 'avg':
			case 'min':
			case 'max': {
				const nums = values.filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
				if (!nums.length) return null;
				if (cfg.aggregate === 'sum') return round(nums.reduce((a, b) => a + b, 0));
				if (cfg.aggregate === 'avg') return round(nums.reduce((a, b) => a + b, 0) / nums.length);
				return cfg.aggregate === 'min' ? Math.min(...nums) : Math.max(...nums);
			}
			case 'earliest':
			case 'latest': {
				const dates = values.filter(isChronoDate);
				if (!dates.length) return null;
				const sorted = dates.sort((a, b) => chronoOrdinal(a) - chronoOrdinal(b));
				return cfg.aggregate === 'earliest' ? sorted[0] : sorted[sorted.length - 1];
			}
			default:
				return null;
		}
	}
}

function round(n: number): number {
	return Math.round(n * 100) / 100;
}
