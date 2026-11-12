import type { RelationTypeTemplate } from '../core/types';

/**
 * Built-in kinds of connection, referenced by id from the built-in entity types'
 * relation fields. Seeded into every world as editable data.
 *
 * forwardLabel = what the `to` entries are, seen from the `from` entry's page.
 * reverseLabel = what the `from` entries are, seen from the `to` entry's page.
 */
type Spec = [id: string, label: string, forward: string, reverse: string | null, category: string, source: string[], target: string[], icon?: string];

const SPECS: Spec[] = [
	// People & bonds
	['family', 'Family', 'Family', null, 'Personal', ['character'], ['character'], 'home'],
	['friendship', 'Friendship', 'Friends', null, 'Personal', ['character'], ['character'], 'smile'],
	['romance', 'Romance', 'Romantic partners', null, 'Personal', ['character'], ['character'], 'heart'],
	['rivalry', 'Rivalry', 'Rivals', null, 'Personal', ['character'], ['character'], 'swords'],
	['enmity', 'Enmity', 'Enemies', null, 'Personal', ['character'], ['character'], 'skull'],
	['mentorship', 'Mentorship', 'Students', 'Mentors', 'Personal', ['character'], ['character'], 'graduation-cap'],
	// Family trees (0.11): from the parent to the child.
	['parent-of', 'Parent & child', 'Children', 'Parents', 'Personal', ['character', 'deity', 'creature'], ['character', 'deity', 'creature'], 'baby'],
	['marriage', 'Marriage', 'Spouses', null, 'Personal', ['character', 'deity'], ['character', 'deity'], 'gem'],

	// Identity & belonging
	['species-of', 'Species', 'Species', 'Members', 'Identity', ['character', 'creature'], ['species'], 'dna'],
	['citizen-of', 'Citizenship', 'Nationality', 'Citizens', 'Identity', ['character'], ['nation'], 'flag'],
	['member-of', 'Membership', 'Affiliations', 'Members', 'Identity', ['character'], ['faction', 'nation', 'religion'], 'users'],
	['leads', 'Leadership', 'Leads', 'Leaders', 'Identity', ['character'], ['faction'], 'crown'],
	['rules', 'Rule', 'Rules', 'Ruler', 'Identity', ['character'], ['nation'], 'crown'],
	['founded-by', 'Founding', 'Founder', 'Founded', 'Identity', ['faction'], ['character'], 'flag'],
	['champion-of', 'Championship', 'Champion of', 'Champions', 'Identity', ['character'], ['deity'], 'shield'],

	// Places
	['homeland', 'Homeland', 'Homeland', 'Natives', 'Places', ['character'], ['location'], 'home'],
	['birthplace', 'Birthplace', 'Birthplace', 'Born here', 'Places', ['character'], ['location'], 'baby'],
	['located-in', 'Location', 'Location', 'Present here', 'Places', ['character', 'artifact'], ['location'], 'map-pin'],
	['based-in', 'Headquarters', 'Headquarters', 'Based here', 'Places', ['faction'], ['location'], 'castle'],
	['capital-of', 'Capital', 'Capital', 'Capital of', 'Places', ['nation'], ['location'], 'landmark'],
	['territory-of', 'Territory', 'Nation', 'Territory', 'Places', ['location'], ['nation'], 'map'],
	['inhabits', 'Habitat', 'Habitat', 'Inhabitants', 'Places', ['creature', 'species'], ['location'], 'trees'],

	// Culture & faith
	['culture-of', 'Culture', 'Cultures', 'Peoples', 'Culture', ['species', 'nation', 'location'], ['culture'], 'palette'],
	['speaks', 'Language use', 'Languages', 'Speakers', 'Culture', ['culture', 'nation', 'species', 'character'], ['language'], 'languages'],
	['spoken-in', 'Spoken in', 'Spoken in', 'Languages', 'Culture', ['language'], ['location'], 'map-pin'],
	['follows-religion', 'Faith', 'Religions', 'Followers', 'Culture', ['character', 'culture', 'nation', 'faction'], ['religion'], 'church'],
	['worships', 'Worship', 'Deities', 'Worshipped by', 'Culture', ['religion'], ['deity'], 'sparkles'],
	['practiced-in', 'Holy place', 'Holy places', 'Religions practiced here', 'Culture', ['religion'], ['location'], 'landmark'],
	['divine-kin', 'Divine kinship', 'Related deities', null, 'Culture', ['deity'], ['deity'], 'sun'],

	// Powers & objects
	['has-ability', 'Ability', 'Abilities', 'Known users', 'Powers', ['character', 'creature', 'species'], ['ability'], 'zap'],
	['uses-power', 'Magic use', 'Magic systems', 'Users', 'Powers', ['character', 'species', 'creature'], ['magic'], 'wand-2'],
	['power-of', 'Power source', 'Power system', 'Abilities', 'Powers', ['ability'], ['magic'], 'wand-2'],
	['practices', 'Practice', 'Practices', 'Organizations', 'Powers', ['faction', 'religion'], ['magic'], 'book-open'],
	['channels', 'Channeling', 'Channels', 'Artifacts', 'Powers', ['artifact'], ['magic'], 'gem'],
	['wields', 'Ownership', 'Weapons & artifacts', 'Owner', 'Powers', ['character', 'faction'], ['artifact'], 'sword'],
	['created-by', 'Creation', 'Creator', 'Created', 'Powers', ['artifact'], ['character', 'deity', 'faction'], 'hammer'],
	['invented-by', 'Invention', 'Inventor', 'Inventions', 'Powers', ['technology'], ['character', 'faction', 'nation'], 'lightbulb'],
	['uses-tech', 'Technology use', 'Technology', 'Used by', 'Powers', ['nation', 'faction', 'culture', 'character'], ['technology'], 'cog'],

	// History & politics
	['participates', 'Participation', 'Events', 'Participants', 'History', ['character', 'creature', 'deity'], ['event'], 'flag'],
	['involved-in', 'Involvement', 'Events', 'Factions & nations', 'History', ['faction', 'nation'], ['event'], 'flag'],
	['occurs-at', 'Event location', 'Locations', 'Events here', 'History', ['event'], ['location'], 'map-pin'],
	['within-era', 'Era', 'Era', 'In this era', 'History', ['event', 'technology'], ['era'], 'hourglass'],
	['dominant-in', 'Dominance', 'Dominant in', 'Dominant powers', 'History', ['nation', 'faction'], ['era'], 'trophy'],
	['causes', 'Causation', 'Led to', 'Caused by', 'History', ['event'], ['event'], 'git-merge'],
	['alliance', 'Alliance', 'Allies', null, 'Politics', ['faction', 'nation'], ['faction', 'nation'], 'handshake'],
	['hostility', 'Hostility', 'Enemies', null, 'Politics', ['faction', 'nation'], ['faction', 'nation'], 'swords'],

	// Lore
	['about', 'Subject', 'Subjects', 'Appears in lore', 'Lore', ['lore'], [], 'book-marked'],
];

export const BUILTIN_RELATION_TYPES: RelationTypeTemplate[] = SPECS.map(([id, label, forward, reverse, category, source, target, icon]) => ({
	id,
	label,
	forwardLabel: forward,
	reverseLabel: reverse ?? forward,
	symmetric: reverse === null,
	category,
	icon,
	color: null,
	sourceTypes: source,
	targetTypes: target,
	fields: [],
	templateVersion: 1,
}));
