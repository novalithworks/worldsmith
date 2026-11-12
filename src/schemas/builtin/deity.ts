import { defineType, f, opts, section, tasks } from '../dsl';

export const deityType = defineType(
	{
		id: 'deity',
		singular: 'Deity',
		plural: 'Deities',
		icon: 'sun',
		description: 'Gods, spirits, demons and other divine beings.',
		group: 'society',
		color: 'orange',
		order: 110,
		subtitle: ['rank', 'domains'],
		card: ['rank', 'domains', 'alignment'],
		parentTypes: ['deity'],
		childTypes: ['deity'],
		tasks: tasks(
			'Define domains|Divinity',
			'Describe appearance and manifestations|Appearance',
			'Define personality and temperament|Personality',
			'Define symbols and sacred animals|Symbols',
			'Write origin myth|Myth',
			'Define relationships with other deities|Pantheon',
			'Define worship and offerings|Worship',
		),
	},
	section('divinity', 'Divinity', 'sun', [
		f.select('rank', 'Rank', opts('Primordial:purple', 'Greater deity:orange', 'Lesser deity:yellow', 'Demigod:cyan', 'Spirit:green', 'Demon:red', 'Forgotten:gray')),
		f.list('domains', 'Domains', { recommended: true, placeholder: 'War, harvest, the moon…' }),
		f.select('alignment', 'Disposition', opts('Benevolent:green', 'Neutral:gray', 'Capricious:yellow', 'Malevolent:red')),
		f.list('titles', 'Titles & epithets'),
		f.select('state', 'State', opts('Active:green', 'Dormant:yellow', 'Imprisoned:orange', 'Dead:gray', 'Unknown:purple'), { advanced: true }),
	]),
	section('appearance', 'Appearance & nature', 'eye', [
		f.rich('appearance', 'Appearance & manifestations', { recommended: true }),
		f.long('personality', 'Personality'),
		f.list('symbols', 'Symbols'),
		f.list('sacredAnimals', 'Sacred animals & plants', { advanced: true }),
	]),
	section('myth', 'Myth & pantheon', 'scroll-text', [
		f.rich('origin', 'Origin myth'),
		f.long('myths', 'Myths & deeds'),
		f.rel('relatedDeities', 'Related deities', { via: 'divine-kin', targets: ['deity'] }),
	]),
	section('worship', 'Worship', 'flame', [
		f.rel('religions', 'Religions', { via: 'worships', direction: 'reverse', targets: ['religion'] }),
		f.long('worship', 'Worship & offerings'),
		f.rel('champions', 'Champions & avatars', { via: 'champion-of', direction: 'reverse', targets: ['character'], advanced: true }),
	]),
);
