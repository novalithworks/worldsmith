import { defineType, f, opts, section, tasks } from '../dsl';

export const artifactType = defineType(
	{
		id: 'artifact',
		singular: 'Artifact',
		plural: 'Artifacts & items',
		icon: 'gem',
		description: 'Relics, weapons, heirlooms and items of note.',
		group: 'world',
		color: 'yellow',
		order: 65,
		subtitle: ['itemType', 'rarity'],
		card: ['itemType', 'rarity', 'currentOwner'],
		parentTypes: ['artifact'],
		childTypes: ['artifact'],
		tasks: tasks(
			'Describe appearance|Appearance',
			'Define powers or properties|Properties',
			'Define origin and creator|History',
			'Track current owner and location|Whereabouts',
			'Define drawbacks or curses|Properties',
			'Add an image|Media|optional',
		),
	},
	section('identity', 'Identity', 'gem', [
		f.select('itemType', 'Type', opts('Weapon:red', 'Armor:gray', 'Relic:yellow', 'Jewelry:pink', 'Tool:green', 'Tome:blue', 'Vehicle:cyan', 'Key:orange', 'Other:gray')),
		f.select('rarity', 'Rarity', opts('Common:gray', 'Uncommon:green', 'Rare:blue', 'Legendary:purple', 'Unique:orange')),
		f.rel('currentOwner', 'Current owner', { via: 'wields', direction: 'reverse', targets: ['character', 'faction'], max: 1 }),
		f.rel('location', 'Location', { via: 'located-in', targets: ['location'], max: 1 }),
	]),
	section('properties', 'Properties', 'sparkles', [
		f.rich('appearance', 'Appearance', { recommended: true }),
		f.long('powers', 'Powers & properties', { recommended: true }),
		f.long('drawbacks', 'Drawbacks & curses'),
		f.rel('magic', 'Channels', { via: 'channels', targets: ['magic'] }),
		f.text('materials', 'Materials', { advanced: true }),
	]),
	section('history', 'History', 'scroll-text', [
		f.rel('creator', 'Creator', { via: 'created-by', targets: ['character', 'deity', 'faction'], max: 1 }),
		f.chrono('created', 'Created'),
		f.rich('history', 'History & previous owners'),
	]),
);
