import { defineType, f, opts, section, tasks } from '../dsl';

export const abilityType = defineType(
	{
		id: 'ability',
		singular: 'Ability',
		plural: 'Abilities & techniques',
		icon: 'zap',
		description: 'Individual powers, spells, techniques and skills.',
		group: 'world',
		color: 'yellow',
		order: 60,
		subtitle: ['abilityType', 'tier'],
		card: ['abilityType', 'tier', 'magicSystem'],
		parentTypes: ['ability', 'magic'],
		childTypes: ['ability'],
		tasks: tasks(
			'Describe what it does|Effect',
			'Define activation|Mechanics',
			'Define cost|Mechanics',
			'Define limitations|Mechanics',
			'Define counters|Mechanics',
			'Link to a power system|Connections',
			'Add known users|Connections|optional',
		),
	},
	section('identity', 'Identity', 'zap', [
		f.select('abilityType', 'Type', opts('Spell:purple', 'Technique:blue', 'Skill:green', 'Innate power:orange', 'Transformation:pink', 'Ritual:yellow', 'Passive:gray')),
		f.select('tier', 'Tier', opts('Basic:gray', 'Intermediate:green', 'Advanced:blue', 'Master:purple', 'Legendary:orange', 'Forbidden:red')),
		f.rel('magicSystem', 'Power system', { via: 'power-of', targets: ['magic'], max: 1, recommended: true }),
		f.rating('power', 'Power', 5),
	]),
	section('effect', 'Effect', 'sparkles', [
		f.rich('effect', 'Effect', { recommended: true }),
		f.long('activation', 'Activation', { width: 'half', recommended: true }),
		f.text('range', 'Range', { width: 'third' }),
		f.text('duration', 'Duration', { width: 'third' }),
	]),
	section('mechanics', 'Mechanics', 'settings-2', [
		f.long('cost', 'Cost', { width: 'half', recommended: true }),
		f.long('limitations', 'Limitations', { width: 'half', recommended: true }),
		f.long('counters', 'Counters'),
		f.long('sideEffects', 'Side effects', { advanced: true }),
		f.long('training', 'Training required', { advanced: true }),
	]),
	section('users', 'Users', 'users', [
		f.rel('users', 'Known users', { via: 'has-ability', direction: 'reverse', targets: ['character', 'creature', 'species'] }),
	]),
);
