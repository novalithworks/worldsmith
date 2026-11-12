import { defineType, f, opts, section, tasks } from '../dsl';

export const languageType = defineType(
	{
		id: 'language',
		singular: 'Language',
		plural: 'Languages',
		icon: 'languages',
		description: 'Spoken, written and signed languages, scripts and dialects.',
		group: 'society',
		color: 'cyan',
		order: 115,
		subtitle: ['family', 'status'],
		card: ['family', 'status', 'script'],
		parentTypes: ['language'],
		childTypes: ['language'],
		tasks: tasks(
			'Define language family|Origins',
			'Describe sound and feel|Phonology',
			'Define writing system|Script',
			'Build a starter vocabulary|Lexicon',
			'Define naming conventions|Lexicon',
			'Link speakers|Speakers',
			'Define grammar basics|Grammar|optional',
		),
	},
	section('identity', 'Identity', 'languages', [
		f.text('family', 'Language family'),
		f.select('status', 'Status', opts('Living:green', 'Endangered:yellow', 'Dead:gray', 'Sacred:purple', 'Constructed:blue')),
		f.text('script', 'Script', { width: 'half' }),
		f.rel('speakers', 'Speakers', { via: 'speaks', direction: 'reverse', targets: ['species', 'culture', 'nation', 'character'] }),
		f.rel('regions', 'Spoken in', { via: 'spoken-in', targets: ['location'] }),
	]),
	section('structure', 'Sound & structure', 'audio-lines', [
		f.long('phonology', 'Sound & feel', { recommended: true }),
		f.long('grammar', 'Grammar', { advanced: true }),
		f.long('writing', 'Writing system'),
	]),
	section('lexicon', 'Lexicon', 'book-a', [
		f.rich('vocabulary', 'Vocabulary', { recommended: true, placeholder: 'word — meaning' }),
		f.long('naming', 'Naming conventions'),
		f.list('phrases', 'Common phrases', { advanced: true }),
	]),
);
