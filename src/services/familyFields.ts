import type { EntitySchema, FieldDefinition } from '../core/types';
import type { WorldSession } from './WorldSession';

/**
 * Family trees read "Parent & child" and "Marriage" connections. Worlds made before 0.11
 * have no boxes for those on a character's page, so a tree can't be filled in from there.
 * Once per world (0.12), character types get Parents, Children and Spouses right next to
 * their Family field. Nothing is removed or renamed. A type that already has any
 * Parent & child field is left alone: it either came from the 0.11 template or was set up
 * by hand, and a field missing there was taken out on purpose.
 */

const WANTED: Array<{ id: string; label: string; via: string; direction: 'forward' | 'reverse'; description: string }> = [
	{ id: 'parents', label: 'Parents', via: 'parent-of', direction: 'reverse', description: 'Their mother, father or whoever raised them. Family trees are drawn from this.' },
	{ id: 'children', label: 'Children', via: 'parent-of', direction: 'forward', description: 'Sons, daughters, heirs. Family trees are drawn from this.' },
	{ id: 'spouses', label: 'Spouses', via: 'marriage', direction: 'forward', description: 'Husbands, wives and partners. Shown side by side in family trees.' },
];

const relOf = (f: FieldDefinition) => (f.type === 'relation' ? { via: f.config?.relationType as string | undefined, dir: (f.config?.direction as string | undefined) ?? 'forward' } : null);

/** The schema with the family fields added, or null when it already has them all. */
export function withFamilyFields(schema: EntitySchema): EntitySchema | null {
	if (schema.fields.some((f) => relOf(f)?.via === 'parent-of')) return null;
	const missing = WANTED.filter((w) =>
		!schema.fields.some((f) => {
			const r = relOf(f);
			// Marriage reads the same both ways.
			return !!r && r.via === w.via && (w.via === 'marriage' || r.dir === w.direction);
		}),
	);
	if (!missing.length) return null;
	const taken = new Set(schema.fields.map((f) => f.id));
	const unique = (id: string) => {
		let out = id;
		for (let n = 2; taken.has(out); n++) out = `${id}${n}`;
		taken.add(out);
		return out;
	};
	const added: FieldDefinition[] = missing.map((w) => ({
		id: unique(w.id),
		type: 'relation',
		label: w.label,
		description: w.description,
		config: { relationType: w.via, direction: w.direction, targetTypes: [schema.id], max: null },
	}));
	const ids = added.map((f) => f.id);
	const sections = schema.sections.map((s) => ({ ...s, fieldIds: [...s.fieldIds] }));
	// Next to the Family field if there is one, else at the top of Relationships, else a section of their own.
	const familyField = schema.fields.find((f) => {
		const r = relOf(f);
		return (r && r.via === 'family') || f.id === 'familyMembers';
	});
	const home = (familyField && sections.find((s) => s.fieldIds.includes(familyField.id))) ?? sections.find((s) => s.id === 'relationships');
	if (home) {
		const at = familyField ? home.fieldIds.indexOf(familyField.id) : -1;
		home.fieldIds.splice(at === -1 ? 0 : at, 0, ...ids);
	} else {
		let sid = 'family';
		for (let n = 2; sections.some((s) => s.id === sid); n++) sid = `family${n}`;
		sections.push({ id: sid, label: 'Family', icon: 'network', fieldIds: ids });
	}
	return { ...schema, fields: [...schema.fields, ...added], sections };
}

/** Once per world: give character types their family fields. Returns the types changed. */
export function ensureFamilyFields(s: WorldSession): string[] {
	if (s.world.familyFields) return [];
	const changed: string[] = [];
	const people = s.schemas.list().filter((t) => t.id === 'character' || t.origin?.templateId === 'character');
	if (people.length) {
		s.ensureRelationKinds(['parent-of', 'marriage']);
		// Try again next time if the connection kinds couldn't be made.
		if (!s.relations.type('parent-of')) return [];
	}
	for (const t of people) {
		const next = withFamilyFields(t);
		if (!next) continue;
		s.schemas.update(next);
		changed.push(t.id);
	}
	s.updateWorld({ familyFields: true });
	return changed;
}
