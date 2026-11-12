import { defineType, f, opts, section, tasks } from '../dsl';

export const technologyType = defineType(
	{
		id: 'technology',
		singular: 'Technology',
		plural: 'Technology',
		icon: 'cog',
		description: 'Inventions, techniques, infrastructure and scientific knowledge.',
		group: 'world',
		color: 'blue',
		order: 68,
		subtitle: ['techType', 'availability'],
		card: ['techType', 'availability', 'era'],
		parentTypes: ['technology'],
		childTypes: ['technology'],
		tasks: tasks(
			'Describe what it does|Function',
			'Describe how it works|Function',
			'Define who invented it|History',
			'Define who has access|Society',
			'Define its impact on society|Impact',
			'Define limitations|Function|optional',
		),
	},
	section('identity', 'Identity', 'cog', [
		f.select('techType', 'Type', opts('Tool:green', 'Weapon:red', 'Transport:cyan', 'Communication:blue', 'Medicine:pink', 'Infrastructure:gray', 'Energy:yellow', 'Magitech:purple')),
		f.select('availability', 'Availability', opts('Common:green', 'Restricted:yellow', 'Rare:orange', 'Secret:red', 'Lost:gray')),
		f.rel('era', 'Era', { via: 'within-era', targets: ['era'], max: 1 }),
		f.rel('inventor', 'Inventor', { via: 'invented-by', targets: ['character', 'faction', 'nation'], max: 1 }),
	]),
	section('function', 'Function', 'settings-2', [
		f.rich('function', 'What it does', { recommended: true }),
		f.long('mechanism', 'How it works', { recommended: true }),
		f.long('limitations', 'Limitations'),
		f.list('materials', 'Materials & requirements', { advanced: true }),
	]),
	section('impact', 'Impact', 'globe-2', [
		f.long('impact', 'Impact on society'),
		f.long('history', 'History'),
		f.rel('users', 'Used by', { via: 'uses-tech', direction: 'reverse', targets: ['nation', 'faction', 'culture', 'character'] }),
	]),
);
