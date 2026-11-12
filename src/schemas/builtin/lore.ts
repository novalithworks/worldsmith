import { defineType, f, opts, section, tasks } from '../dsl';

export const loreType = defineType(
	{
		id: 'lore',
		singular: 'Lore entry',
		plural: 'Lore & myths',
		icon: 'book-marked',
		description: 'Myths, legends, prophecies, folk tales, secrets and in-world documents.',
		group: 'lore',
		color: 'purple',
		order: 140,
		subtitle: ['loreType', 'truth'],
		card: ['loreType', 'truth', 'knownBy'],
		parentTypes: ['lore'],
		childTypes: ['lore'],
		tasks: tasks(
			'Write the tale|Content',
			'Decide what is actually true|Truth',
			'Decide who knows it|Knowledge',
			'Link the people and places involved|Connections',
			'Describe its influence on the world|Impact|optional',
		),
	},
	section('identity', 'Identity', 'book-marked', [
		f.select('loreType', 'Type', opts('Myth:purple', 'Legend:orange', 'Prophecy:yellow', 'Folk tale:green', 'Secret:red', 'Document:blue', 'Song:pink', 'Rumor:gray', 'Concept:cyan')),
		f.select('truth', 'Truth', opts('True:green', 'Partly true:yellow', 'Distorted:orange', 'False:red', 'Unknown:gray')),
		f.text('knownBy', 'Known by', { placeholder: 'Everyone, scholars, a single order…' }),
		f.text('origin', 'Origin'),
	]),
	section('content', 'Content', 'scroll-text', [
		f.rich('content', 'The tale', { recommended: true }),
		f.long('truthBehind', 'The truth behind it', { recommended: true }),
		f.long('variations', 'Variations', { advanced: true }),
		f.long('influence', 'Influence on the world'),
	]),
	section('connections', 'Connections', 'link-2', [
		f.rel('subjects', 'Subjects', { via: 'about', targets: [] }),
	]),
);
