import { defineType, f, opts, section, tasks } from '../dsl';

const danger = opts('Harmless:green', 'Low:cyan', 'Moderate:yellow', 'High:orange', 'Extreme:red', 'Cataclysmic:purple');

/** Individual, named creatures (a specific dragon, a famous beast). */
export const creatureType = defineType(
	{
		id: 'creature',
		singular: 'Creature',
		plural: 'Creatures',
		icon: 'paw-print',
		description: 'Individual beasts, monsters and named creatures.',
		group: 'world',
		color: 'orange',
		order: 30,
		subtitle: ['species', 'dangerLevel'],
		card: ['species', 'dangerLevel', 'size'],
		tasks: tasks(
			'Describe appearance|Appearance',
			'Define size and anatomy|Appearance',
			'Define behavior and temperament|Behavior',
			'Define habitat|Ecology',
			'Define diet|Ecology',
			'Define abilities|Abilities',
			'Define weaknesses|Abilities',
			'Set danger level|Abilities',
			'Add an image|Media',
		),
	},
	section('identity', 'Identity', 'paw-print', [
		f.rel('species', 'Species', { via: 'species-of', targets: ['species'], max: 1, recommended: true }),
		f.select('dangerLevel', 'Danger level', danger, { recommended: true }),
		f.text('size', 'Size', { width: 'third' }),
		f.text('age', 'Age', { width: 'third' }),
		f.select('intelligence', 'Intelligence', opts('Instinctual:gray', 'Animal:green', 'Clever:cyan', 'Sapient:blue', 'Genius:purple')),
		f.rel('locations', 'Locations', { via: 'inhabits', targets: ['location'] }),
	]),
	section('appearance', 'Appearance', 'eye', [
		f.rich('appearance', 'Appearance', { recommended: true }),
		f.long('anatomy', 'Anatomy', { advanced: true }),
	]),
	section('behavior', 'Behavior', 'activity', [
		f.long('behavior', 'Behavior', { recommended: true }),
		f.long('temperament', 'Temperament'),
		f.long('diet', 'Diet', { width: 'half' }),
		f.long('habitat', 'Habitat', { width: 'half' }),
	]),
	section('abilities', 'Abilities', 'zap', [
		f.rel('abilities', 'Abilities', { via: 'has-ability', targets: ['ability'] }),
		f.list('weaknesses', 'Weaknesses', { recommended: true }),
		f.long('history', 'History & legend', { advanced: true }),
	]),
);
