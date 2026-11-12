import type { EntityTypeTemplate } from '../core/types';
import { defineType, f, opts, section, tasks } from './dsl';

/**
 * Starting points for new types (Milestone 9): ready-made fields, sections, cards and a
 * checklist for things many worlds need but not every world has. Picking one in “New entity
 * type” copies it into the world as an ordinary custom type — edit anything afterwards.
 * Link fields use the built-in relationship kinds; any the world no longer has are left out.
 */

const ships = defineType(
	{ id: 'vehicle', order: 201, singular: 'Vehicle', plural: 'Vehicles & ships', icon: 'ship', description: 'Ships, airships, carriages, mounts and anything else that carries people.', group: 'world', color: 'cyan', subtitle: ['vehicleType', 'vesselClass'], card: ['vehicleType', 'owner', 'homePort'], tasks: tasks('Describe its appearance|Appearance', 'Decide who owns it|Ownership', 'Give it a history|History', 'Define its crew|Crew|optional') },
	section('identity', 'Identity', 'ship', [
		f.select('vehicleType', 'Kind', opts('Ship:blue', 'Airship:cyan', 'Carriage:orange', 'Mount:green', 'Machine:gray', 'Starship:purple')),
		f.text('vesselClass', 'Class or model'),
		f.select('size', 'Size', opts('Small', 'Medium', 'Large', 'Huge', 'Colossal')),
		f.select('condition', 'Condition', opts('Pristine:green', 'Seaworthy:blue', 'Battered:yellow', 'Wrecked:red')),
		f.rel('owner', 'Owner', { via: 'wields', direction: 'reverse', targets: ['character', 'faction'], max: 1 }),
		f.rel('homePort', 'Home port', { via: 'located-in', targets: ['location'], max: 1 }),
	]),
	section('details', 'Details', 'gauge', [f.number('crew', 'Crew'), f.text('speed', 'Speed'), f.list('armament', 'Armament & equipment'), f.long('appearance', 'Appearance', { recommended: true })]),
	section('history', 'History', 'scroll', [f.rich('history', 'History', { recommended: true }), f.list('voyages', 'Notable voyages')]),
);

const spells = defineType(
	{ id: 'spell', order: 202, singular: 'Spell', plural: 'Spells & rituals', icon: 'sparkles', description: 'Individual spells, rituals and incantations within your magic systems.', group: 'world', color: 'purple', subtitle: ['school', 'level'], card: ['school', 'level', 'system'], tasks: tasks('Describe the effect|Effect', 'Define the cost|Cost', 'Decide who can cast it|Casting', 'Write its origin|Lore|optional') },
	section('casting', 'Casting', 'wand-2', [
		f.select('school', 'School', opts('Evocation:red', 'Illusion:purple', 'Divination:blue', 'Healing:green', 'Necromancy:gray', 'Enchantment:pink', 'Transmutation:orange')),
		f.number('level', 'Level or tier'),
		f.text('castingTime', 'Casting time'),
		f.text('range', 'Range'),
		f.text('duration', 'Duration'),
		f.list('components', 'Components'),
		f.rel('system', 'Magic system', { via: 'power-of', targets: ['magic'], max: 1 }),
	]),
	section('effect', 'Effect', 'zap', [f.rich('effect', 'What it does', { recommended: true }), f.long('cost', 'Cost & risk', { recommended: true }), f.long('origin', 'Origin')]),
);

const plants = defineType(
	{ id: 'plant', order: 203, singular: 'Plant', plural: 'Plants & herbs', icon: 'leaf', description: 'Flora: crops, herbs, trees and the strange things that grow in your world.', group: 'world', color: 'green', subtitle: ['plantType', 'rarity'], card: ['plantType', 'rarity', 'properties'], tasks: tasks('Describe how it looks|Appearance', 'Decide where it grows|Habitat', 'Define its uses|Uses') },
	section('identity', 'Identity', 'leaf', [
		f.select('plantType', 'Kind', opts('Herb:green', 'Tree:green', 'Flower:pink', 'Crop:yellow', 'Fungus:orange', 'Vine:green', 'Aquatic:blue')),
		f.select('rarity', 'Rarity', opts('Common:gray', 'Uncommon:green', 'Rare:blue', 'Legendary:purple')),
		f.multi('properties', 'Properties', opts('Edible:green', 'Medicinal:cyan', 'Poisonous:red', 'Magical:purple', 'Hallucinogenic:pink')),
		f.rel('habitat', 'Grows in', { via: 'inhabits', targets: ['location'] }),
	]),
	section('description', 'Description', 'flower-2', [f.long('appearance', 'Appearance', { recommended: true }), f.list('uses', 'Uses'), f.long('lore', 'Folklore')]),
);

const quests = defineType(
	{ id: 'quest', order: 204, singular: 'Quest', plural: 'Quests & plot threads', icon: 'scroll-text', description: 'Quests, missions and the plot threads you’re following.', group: 'lore', color: 'orange', subtitle: ['questState', 'stakes'], card: ['questState', 'location', 'reward'], tasks: tasks('Write the hook|Setup', 'Define the stakes|Setup', 'Plan the resolution|Outcome') },
	section('thread', 'Thread', 'compass', [
		f.select('questState', 'State', opts('Planned:gray', 'Active:blue', 'Resolved:green', 'Failed:red', 'Abandoned:gray')),
		f.text('stakes', 'Stakes'),
		f.text('reward', 'Reward'),
		f.rel('location', 'Where', { via: 'occurs-at', targets: ['location'] }),
		f.rel('era', 'Era', { via: 'within-era', targets: ['era'], max: 1 }),
	]),
	section('story', 'Story', 'book-open', [f.rich('hook', 'Hook', { recommended: true }), f.list('objectives', 'Objectives'), f.long('outcome', 'Outcome')]),
);

const prophecies = defineType(
	{ id: 'prophecy', order: 205, singular: 'Prophecy', plural: 'Prophecies', icon: 'eye', description: 'Prophecies, omens and foretellings — and whether they came true.', group: 'lore', color: 'purple', subtitle: ['fulfilment'], card: ['fulfilment', 'era'], tasks: tasks('Write the wording|Prophecy', 'Decide who spoke it|Origin', 'Decide what it really means|Meaning') },
	section('prophecy', 'Prophecy', 'eye', [f.rich('wording', 'Wording', { recommended: true }), f.select('fulfilment', 'Fulfilment', opts('Unfulfilled:gray', 'Unfolding:blue', 'Fulfilled:green', 'False:red', 'Misread:orange')), f.rel('era', 'Era', { via: 'within-era', targets: ['era'], max: 1 })]),
	section('meaning', 'Meaning', 'sparkle', [f.long('origin', 'Who spoke it, and when'), f.long('interpretations', 'Interpretations', { recommended: true }), f.long('truth', 'What it really means')]),
);

const houses = defineType(
	{ id: 'house', order: 206, singular: 'House', plural: 'Houses & bloodlines', icon: 'castle', description: 'Noble houses, clans, dynasties and bloodlines.', group: 'society', color: 'red', subtitle: ['motto'], card: ['motto', 'seat', 'standing'], tasks: tasks('Write the motto|Identity', 'Describe the sigil|Identity', 'Choose a seat|Holdings', 'Write the history|History') },
	section('identity', 'Identity', 'shield', [
		f.text('motto', 'Motto'),
		f.image('sigil', 'Sigil'),
		f.select('standing', 'Standing', opts('Ruling:purple', 'Great:blue', 'Minor:gray', 'Fallen:red', 'Extinct:gray')),
		f.rel('seat', 'Seat', { via: 'based-in', targets: ['location'], max: 1 }),
		f.rel('members', 'Members', { via: 'member-of', direction: 'reverse', targets: ['character'] }),
		f.chrono('founded', 'Founded'),
	]),
	section('history', 'History', 'scroll', [f.rich('history', 'History', { recommended: true }), f.list('traits', 'Family traits'), f.long('feuds', 'Feuds & alliances')]),
);

const afflictions = defineType(
	{ id: 'affliction', order: 207, singular: 'Affliction', plural: 'Curses & diseases', icon: 'biohazard', description: 'Plagues, curses, poisons and other afflictions.', group: 'world', color: 'red', subtitle: ['afflictionType', 'severity'], card: ['afflictionType', 'severity', 'contagious'], tasks: tasks('List the symptoms|Effects', 'Decide the cause|Origin', 'Decide if there is a cure|Cure') },
	section('identity', 'Identity', 'biohazard', [
		f.select('afflictionType', 'Kind', opts('Disease:green', 'Curse:purple', 'Poison:red', 'Madness:pink', 'Blight:orange')),
		f.select('severity', 'Severity', opts('Mild:green', 'Serious:yellow', 'Deadly:red')),
		f.bool('contagious', 'Contagious'),
		f.list('symptoms', 'Symptoms'),
	]),
	section('lore', 'Cause & cure', 'pill', [f.long('cause', 'Cause', { recommended: true }), f.long('cure', 'Cure or remedy', { recommended: true }), f.long('history', 'Outbreaks & history')]),
);

const currencies = defineType(
	{ id: 'currency', order: 208, singular: 'Currency', plural: 'Currencies & goods', icon: 'coins', description: 'Money, trade goods, commodities and contraband.', group: 'society', color: 'yellow', subtitle: ['goodsType', 'value'], card: ['goodsType', 'value', 'issuer'], tasks: tasks('Decide what it’s worth|Value', 'Decide who makes or trades it|Trade') },
	section('identity', 'Identity', 'coins', [
		f.select('goodsType', 'Kind', opts('Coin:yellow', 'Paper money:green', 'Commodity:orange', 'Luxury:purple', 'Contraband:red')),
		f.text('value', 'Value'),
		f.text('material', 'Material'),
		f.rel('issuer', 'Issued or made by', { via: 'created-by', targets: ['nation', 'faction', 'character'] }),
	]),
	section('trade', 'Trade', 'scale', [f.long('appearance', 'Appearance'), f.long('trade', 'Where and how it’s traded', { recommended: true }), f.list('exchange', 'Exchange rates')]),
);

const titles = defineType(
	{ id: 'title', order: 209, singular: 'Title', plural: 'Titles & ranks', icon: 'award', description: 'Noble titles, military ranks, offices and honours.', group: 'society', color: 'blue', subtitle: ['rankType'], card: ['rankType', 'precedence'], tasks: tasks('Define its duties|Duties', 'Define its privileges|Privileges', 'Decide how it’s granted|Granting') },
	section('identity', 'Identity', 'award', [
		f.select('rankType', 'Kind', opts('Noble:purple', 'Military:red', 'Religious:yellow', 'Civic:blue', 'Honorary:green')),
		f.number('precedence', 'Precedence', { description: 'Higher ranks first' }),
		f.text('address', 'Form of address'),
		f.image('insignia', 'Insignia'),
	]),
	section('role', 'Role', 'list-checks', [f.list('duties', 'Duties'), f.list('privileges', 'Privileges'), f.long('granting', 'How it’s granted or lost', { recommended: true })]),
);

const festivals = defineType(
	{ id: 'festival', order: 210, singular: 'Festival', plural: 'Holidays & festivals', icon: 'party-popper', description: 'Holidays, festivals, feasts and observances.', group: 'society', color: 'pink', subtitle: ['when'], card: ['when', 'mood'], tasks: tasks('Decide when it happens|Calendar', 'Describe the traditions|Traditions', 'Write its origin|Origin') },
	section('calendar', 'Calendar', 'calendar', [f.text('when', 'When'), f.select('mood', 'Mood', opts('Joyful:yellow', 'Solemn:gray', 'Sacred:purple', 'Wild:pink', 'Martial:red')), f.text('length', 'How long it lasts')]),
	section('traditions', 'Traditions', 'sparkles', [f.long('traditions', 'Traditions', { recommended: true }), f.list('foods', 'Foods & drink'), f.long('origin', 'Origin')]),
);

export const STARTER_TYPES: EntityTypeTemplate[] = [ships, spells, plants, quests, prophecies, houses, afflictions, currencies, titles, festivals];
