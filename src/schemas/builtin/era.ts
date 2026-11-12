import { defineType, f, section, tasks } from '../dsl';

export const eraType = defineType(
	{
		id: 'era',
		singular: 'Era',
		plural: 'Eras & ages',
		icon: 'hourglass',
		description: 'Ages, epochs, dynasties and periods of history.',
		group: 'lore',
		color: 'cyan',
		order: 130,
		subtitle: ['start', 'end'],
		card: ['start', 'end', 'defining'],
		parentTypes: ['era'],
		childTypes: ['era'],
		tasks: tasks(
			'Set start and end|Span',
			'Describe the defining features|Character',
			'Describe how it began|Span',
			'Describe how it ended|Span',
			'Add key events|Events',
		),
	},
	section('span', 'Span', 'hourglass', [
		f.chrono('start', 'Start', { recommended: true }),
		f.chrono('end', 'End'),
		f.text('abbreviation', 'Abbreviation', { width: 'third', placeholder: 'e.g. AE' }),
		f.long('beginning', 'How it began', { width: 'half' }),
		f.long('ending', 'How it ended', { width: 'half' }),
	]),
	section('character', 'Character of the age', 'sparkles', [
		f.long('defining', 'Defining features', { recommended: true }),
		f.rich('summary', 'Overview', { recommended: true }),
		f.rel('events', 'Key events', { via: 'within-era', direction: 'reverse', targets: ['event'] }),
		f.rel('powers', 'Dominant powers', { via: 'dominant-in', direction: 'reverse', targets: ['nation', 'faction'], advanced: true }),
	]),
);
