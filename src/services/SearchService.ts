import type { EventBus } from '../core/events/EventBus';
import type { WorldsmithEvents } from '../core/events/events';
import type { EntityRecord } from '../core/types';
import { DisposableStore } from '../core/util/disposable';
import { normalizeText } from '../core/util/strings';
import type { EntityRepository } from '../data/repositories/EntityRepository';
import type { FieldTypeRegistry } from '../fields/FieldTypeRegistry';
import type { SchemaService } from './SchemaService';

export interface SearchHit {
	entity: EntityRecord;
	score: number;
	/** Where the best match was found. */
	matched: 'name' | 'alias' | 'tag' | 'content';
}

/**
 * Global search over names, aliases, tags, descriptions and text-like field values.
 *
 * Each entity has a precomputed normalized haystack, updated incrementally on change.
 * A linear scan over a few thousand strings takes milliseconds; if worlds grow far
 * beyond that, an inverted index can replace `search()` without changing callers.
 */
export class SearchService {
	private hay = new Map<string, { name: string; aliases: string[]; tags: string[]; content: string }>();
	private disposables = new DisposableStore();

	constructor(
		private readonly repo: EntityRepository,
		private readonly schemas: SchemaService,
		private readonly fieldTypes: FieldTypeRegistry,
		events: EventBus<WorldsmithEvents>,
	) {
		for (const e of repo.values()) this.indexEntity(e);
		this.disposables.add(events.on('entity:created', ({ entity }) => this.indexEntity(entity)));
		this.disposables.add(events.on('entity:updated', ({ entity }) => this.indexEntity(entity)));
		this.disposables.add(events.on('entity:deleted', ({ entity }) => this.hay.delete(entity.id)));
		this.disposables.add(
			events.on('schema:updated', ({ schema }) => {
				for (const e of repo.values()) if (e.typeId === schema.id) this.indexEntity(e);
			}),
		);
	}

	private indexEntity(e: EntityRecord): void {
		const schema = this.schemas.get(e.typeId);
		const parts: string[] = [e.description];
		if (schema) {
			for (const field of schema.fields) {
				const type = this.fieldTypes.for(field);
				if (type.searchable === false || type.computed) continue;
				const v = e.values[field.id];
				if (v !== undefined && v !== null) parts.push(this.fieldTypes.toText(field, v));
			}
		}
		this.hay.set(e.id, {
			name: normalizeText(e.name),
			aliases: e.aliases.map(normalizeText),
			tags: e.tags.map(normalizeText),
			content: normalizeText(parts.join(' \n ')),
		});
	}

	search(query: string, opts: { typeId?: string; limit?: number; includeArchived?: boolean } = {}): SearchHit[] {
		const q = normalizeText(query.trim());
		const limit = opts.limit ?? 50;
		const hits: SearchHit[] = [];
		const terms = q.split(/\s+/).filter(Boolean);

		for (const e of this.repo.values()) {
			if (e.trashedAt) continue;
			if (!opts.includeArchived && e.archivedAt) continue;
			if (opts.typeId && e.typeId !== opts.typeId) continue;
			if (!q) {
				hits.push({ entity: e, score: e.updatedAt / 1e13, matched: 'name' });
				continue;
			}
			const h = this.hay.get(e.id);
			if (!h) continue;
			const hit = score(h, q, terms);
			if (hit) hits.push({ entity: e, score: hit.score + (e.flags.favorite ? 0.5 : 0), matched: hit.matched });
		}
		hits.sort((a, b) => b.score - a.score || a.entity.name.localeCompare(b.entity.name));
		return hits.slice(0, limit);
	}

	dispose(): void {
		this.disposables.dispose();
	}
}

function score(
	h: { name: string; aliases: string[]; tags: string[]; content: string },
	q: string,
	terms: string[],
): { score: number; matched: SearchHit['matched'] } | null {
	if (h.name === q) return { score: 100, matched: 'name' };
	if (h.name.startsWith(q)) return { score: 80, matched: 'name' };
	if (h.name.split(/\s+/).some((w) => w.startsWith(q))) return { score: 70, matched: 'name' };
	if (h.name.includes(q)) return { score: 60, matched: 'name' };
	if (h.aliases.some((a) => a.startsWith(q))) return { score: 55, matched: 'alias' };
	if (h.aliases.some((a) => a.includes(q))) return { score: 45, matched: 'alias' };
	if (h.tags.some((t) => t === q || t.startsWith(q))) return { score: 40, matched: 'tag' };
	// All terms must appear somewhere.
	const all = `${h.name} ${h.aliases.join(' ')} ${h.tags.join(' ')} ${h.content}`;
	if (terms.every((t) => all.includes(t))) return { score: 20, matched: 'content' };
	return null;
}
