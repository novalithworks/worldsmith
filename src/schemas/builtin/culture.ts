import { defineType, f, section, tasks } from '../dsl';

export const cultureType = defineType(
	{
		id: 'culture',
		singular: 'Culture',
		plural: 'Cultures',
		icon: 'drama',
		description: 'Customs, values, arts and daily life of a people.',
		group: 'society',
		color: 'pink',
		order: 90,
		subtitle: ['region'],
		card: ['region', 'values'],
		parentTypes: ['culture'],
		childTypes: ['culture'],
		tasks: tasks(
			'Define core values|Values',
			'Describe customs and traditions|Customs',
			'Describe daily life|Daily life',
			'Describe arts and music|Arts',
			'Describe food and dress|Daily life',
			'Define social structure|Society',
			'Define coming-of-age and death rites|Customs',
			'Link language and religion|Connections',
		),
	},
	section('identity', 'Identity', 'drama', [
		f.text('region', 'Region'),
		f.list('values', 'Core values', { recommended: true }),
		f.list('taboos', 'Taboos'),
		f.rel('peoples', 'Peoples', { via: 'culture-of', direction: 'reverse', targets: ['species', 'nation', 'location'] }),
	]),
	section('customs', 'Customs', 'party-popper', [
		f.rich('customs', 'Customs & traditions', { recommended: true }),
		f.list('festivals', 'Festivals & holidays'),
		f.long('rites', 'Rites of passage'),
		f.long('etiquette', 'Etiquette & greetings', { advanced: true }),
	]),
	section('daily', 'Daily life', 'sun', [
		f.long('dailyLife', 'Daily life', { recommended: true }),
		f.long('food', 'Food & drink', { width: 'half' }),
		f.long('dress', 'Dress & fashion', { width: 'half' }),
		f.long('family', 'Family & kinship', { width: 'half' }),
		f.long('socialStructure', 'Social structure', { width: 'half' }),
	]),
	section('arts', 'Arts & knowledge', 'palette', [
		f.long('arts', 'Arts & crafts'),
		f.long('music', 'Music & dance', { width: 'half' }),
		f.long('literature', 'Stories & literature', { width: 'half' }),
		f.rel('languages', 'Languages', { via: 'speaks', targets: ['language'] }),
		f.rel('religions', 'Religions', { via: 'follows-religion', targets: ['religion'] }),
	]),
);
