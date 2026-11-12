import { RECORD_VERSIONS } from '../../app/constants';
import type { EventBus } from '../../core/events/EventBus';
import type { WorldsmithEvents } from '../../core/events/events';
import type { EntityRecord, EntitySchema, NoteAppearance, NoteSection, NoteTemplate, World } from '../../core/types';
import { uuid } from '../../core/util/ids';
import type { BucketStore } from '../../data/storage/BucketStore';
import { BUILTIN_NOTE_TEMPLATES, builtInTemplate, defaultTemplateFor, normalizeAppearance, normalizeSections, structuralChange } from './templates';

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/**
 * Native note templates of one world (0.17): the six built-ins (virtual, read-only) and the
 * ones people make, kept in `note-templates/<id>.json`. Which template each type uses lives
 * in world.json (`noteTemplates.byType`); an entry can override it.
 */
export class NoteTemplateService {
	constructor(
		private readonly store: BucketStore<NoteTemplate>,
		private readonly events: EventBus<WorldsmithEvents>,
		private readonly getWorld: () => World,
		private readonly updateWorld: (patch: Partial<World>) => void,
	) {}

	/** Built-ins first, then people's templates in the order they were made. */
	list(): NoteTemplate[] {
		return [...BUILTIN_NOTE_TEMPLATES.map(clone), ...this.custom()];
	}

	custom(): NoteTemplate[] {
		return this.store
			.all()
			.sort((a, b) => a.createdAt - b.createdAt || a.name.localeCompare(b.name))
			.map(clone);
	}

	get(id: string | undefined | null): NoteTemplate | undefined {
		if (!id) return undefined;
		const b = builtInTemplate(id);
		if (b) return clone(b);
		const t = this.store.get(id);
		return t ? clone(t) : undefined;
	}

	/** The type's chosen template, or the built-in that fits it. */
	forType(schema: EntitySchema): NoteTemplate {
		const chosen = this.getWorld().noteTemplates?.byType?.[schema.id];
		return this.get(chosen) ?? this.get(defaultTemplateFor(schema))!;
	}

	/** The template an entry's note uses, and whether the entry chose it itself. */
	forEntity(entity: EntityRecord, schema: EntitySchema): { template: NoteTemplate; override: boolean } {
		const own = this.get(entity.nativeNote?.templateId);
		return own ? { template: own, override: true } : { template: this.forType(schema), override: false };
	}

	/** Which template a type uses (null = back to the built-in that fits). Returns the previous choice. */
	assign(typeId: string, templateId: string | null): string | null {
		const world = this.getWorld();
		const byType = { ...(world.noteTemplates?.byType ?? {}) };
		const prev = byType[typeId] ?? null;
		if (templateId) byType[typeId] = templateId;
		else delete byType[typeId];
		this.updateWorld({ noteTemplates: { byType } });
		return prev;
	}

	uniqueName(name: string, except?: string): string {
		const base = name.trim() || 'My note template';
		const taken = new Set(this.list().filter((t) => t.id !== except).map((t) => t.name.toLowerCase()));
		if (!taken.has(base.toLowerCase())) return base;
		let n = 2;
		while (taken.has(`${base} ${n}`.toLowerCase())) n++;
		return `${base} ${n}`;
	}

	create(input: { name: string; icon?: string; description?: string; sections: NoteSection[]; appearance?: Partial<NoteAppearance>; id?: string }): NoteTemplate {
		const now = Date.now();
		const doc: NoteTemplate = {
			v: RECORD_VERSIONS.noteTemplate,
			// Ids are file names: only plain ones from a file are kept.
			id: input.id && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(input.id) && !this.get(input.id) ? input.id : uuid(),
			name: this.uniqueName(input.name),
			icon: input.icon || 'file-text',
			description: input.description?.trim() ?? '',
			builtIn: false,
			sections: normalizeSections(input.sections),
			appearance: normalizeAppearance(input.appearance),
			createdAt: now,
			updatedAt: now,
			rev: 0,
		};
		this.store.put(doc);
		this.events.emit('note-template:saved', { template: clone(doc), structural: true });
		return clone(doc);
	}

	/** "Customize" a built-in (or copy any template): an editable copy. */
	duplicate(id: string, name?: string): NoteTemplate | null {
		const t = this.get(id);
		if (!t) return null;
		return this.create({ name: name ?? (t.builtIn ? `My ${t.name}` : `${t.name} copy`), icon: t.icon, description: t.description, sections: t.sections, appearance: t.appearance });
	}

	/**
	 * Change a template people made. Appearance, name and icon touch no note; sections do
	 * (Worldsmith's parts of the notes using it are rewritten). Returns the version before.
	 */
	update(id: string, patch: Partial<Pick<NoteTemplate, 'name' | 'icon' | 'description' | 'sections' | 'appearance'>>): { before: NoteTemplate; after: NoteTemplate; structural: boolean } | null {
		const prev = this.store.get(id);
		if (!prev) return null;
		const next: NoteTemplate = { ...clone(prev), updatedAt: Date.now(), rev: prev.rev + 1 };
		if (patch.name !== undefined) next.name = this.uniqueName(patch.name, id);
		if (patch.icon !== undefined) next.icon = patch.icon || 'file-text';
		if (patch.description !== undefined) next.description = patch.description.trim();
		if (patch.sections) next.sections = normalizeSections(patch.sections);
		if (patch.appearance) next.appearance = normalizeAppearance({ ...prev.appearance, ...patch.appearance });
		const structural = structuralChange(prev, next);
		this.store.put(next);
		this.events.emit('note-template:saved', { template: clone(next), structural });
		return { before: clone(prev), after: clone(next), structural };
	}

	/** Remove a template people made; types using it go back to their built-in. */
	remove(id: string): { template: NoteTemplate; types: string[] } | null {
		const t = this.store.get(id);
		if (!t) return null;
		const byType = { ...(this.getWorld().noteTemplates?.byType ?? {}) };
		const types = Object.keys(byType).filter((k) => byType[k] === id);
		if (types.length) {
			for (const k of types) delete byType[k];
			this.updateWorld({ noteTemplates: { byType } });
		}
		this.store.delete(id);
		this.events.emit('note-template:deleted', { template: clone(t) });
		return { template: clone(t), types };
	}

	/** Put a removed or changed template back (Undo). */
	restore(doc: NoteTemplate, types: string[] = []): void {
		const cur = this.store.get(doc.id);
		const next = { ...clone(doc), builtIn: false, updatedAt: Date.now(), rev: Math.max(doc.rev, cur?.rev ?? 0) + 1 };
		this.store.put(next);
		if (types.length) {
			const byType = { ...(this.getWorld().noteTemplates?.byType ?? {}) };
			for (const k of types) byType[k] = doc.id;
			this.updateWorld({ noteTemplates: { byType } });
		}
		this.events.emit('note-template:saved', { template: clone(next), structural: !cur || structuralChange(cur, next) });
	}

	/** A template as a small file of its own. */
	exportFile(id: string): string | null {
		const t = this.get(id);
		if (!t) return null;
		const { builtIn: _b, ...rest } = t;
		return JSON.stringify({ format: 'worldsmith/note-template', v: 1, template: rest }, null, '\t');
	}

	/** Read a template file; it becomes a new template (never replaces one). */
	importFile(text: string): NoteTemplate {
		let data: unknown;
		try {
			data = JSON.parse(text);
		} catch {
			throw new Error('This file isn’t a Worldsmith note template.');
		}
		const d = data as { format?: unknown; template?: Partial<NoteTemplate> };
		if (!d || d.format !== 'worldsmith/note-template' || !d.template || typeof d.template !== 'object') throw new Error('This file isn’t a Worldsmith note template.');
		const t = d.template;
		const sections = normalizeSections(t.sections);
		if (!sections.length) throw new Error('This note template has no sections.');
		return this.create({ name: typeof t.name === 'string' ? t.name : 'Imported template', icon: typeof t.icon === 'string' ? t.icon : undefined, description: typeof t.description === 'string' ? t.description : '', sections, appearance: t.appearance, id: typeof t.id === 'string' ? t.id : undefined });
	}
}
