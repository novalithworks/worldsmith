import { defineType, f, opts, section, tasks } from '../dsl';

export const eventType = defineType(
	{
		id: 'event',
		singular: 'Event',
		plural: 'Historical events',
		icon: 'flag',
		description: 'Battles, treaties, catastrophes, discoveries — anything that happened.',
		group: 'lore',
		color: 'red',
		order: 120,
		subtitle: ['eventType', 'start'],
		card: ['eventType', 'start', 'scale'],
		parentTypes: ['event'],
		childTypes: ['event'],
		tasks: tasks(
			'Set the date|When',
			'Set the location|Where',
			'Add participants|Who',
			'Describe what happened|What',
			'Define causes|Why',
			'Define consequences|Impact',
			'Place it in an era|When',
			'Link related events|Connections|optional',
		),
	},
	section('when', 'When & where', 'calendar-clock', [
		f.select('eventType', 'Type', opts('Battle:red', 'War:red', 'Treaty:green', 'Discovery:cyan', 'Disaster:orange', 'Founding:blue', 'Coronation:purple', 'Death:gray', 'Birth:green', 'Miracle:yellow', 'Other:gray')),
		f.chrono('start', 'Date / start', { recommended: true }),
		f.chrono('end', 'End'),
		f.rel('era', 'Era', { via: 'within-era', targets: ['era'], max: 1, recommended: true }),
		f.rel('locations', 'Locations', { via: 'occurs-at', targets: ['location'], recommended: true }),
		f.select('scale', 'Scale', opts('Personal:gray', 'Local:green', 'Regional:cyan', 'National:blue', 'World-changing:purple')),
	]),
	section('who', 'Participants', 'users', [
		f.rel('participants', 'Participants', { via: 'participates', direction: 'reverse', targets: ['character', 'creature', 'deity'], recommended: true }),
		f.rel('factions', 'Factions & nations', { via: 'involved-in', direction: 'reverse', targets: ['faction', 'nation'] }),
	]),
	section('what', 'What happened', 'scroll-text', [
		f.rich('summary', 'Account', { recommended: true }),
		f.long('causes', 'Causes', { width: 'half', recommended: true }),
		f.long('consequences', 'Consequences', { width: 'half', recommended: true }),
		f.rel('causedBy', 'Caused by', { via: 'causes', direction: 'reverse', targets: ['event'] }),
		f.rel('ledTo', 'Led to', { via: 'causes', targets: ['event'] }),
		f.long('versions', 'Conflicting accounts', { advanced: true }),
	]),
);
