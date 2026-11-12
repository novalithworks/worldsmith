import type { StoryBeat } from '../../core/types';

/*
 * Story structures (WS4): shapes to plan against. Choosing one only adds its beats to the
 * project's Plot tab; it never makes, moves or changes chapters and scenes. (The writer can
 * then ask for empty "planned" chapters, one per beat, as a separate, undoable step.)
 */

export type BeatSpec = Pick<StoryBeat, 'label' | 'description' | 'group' | 'position'>;

export interface StoryStructure {
	id: string;
	name: string;
	description: string;
	beats: BeatSpec[];
}

const b = (group: string, label: string, position: number | null, description: string): BeatSpec => ({ group, label, position, description });

export const STORY_STRUCTURES: readonly StoryStructure[] = [
	{
		id: 'three-act',
		name: 'Three acts',
		description: 'Setup, confrontation and resolution, with the turns between them.',
		beats: [
			b('Act One', 'Opening', 0, 'The ordinary world and the hero in it.'),
			b('Act One', 'Inciting incident', 12, 'Something happens that the hero can’t ignore.'),
			b('Act One', 'First plot point', 25, 'The hero commits; there is no going back.'),
			b('Act Two', 'Rising action', 37, 'New rules, allies and enemies; the stakes grow.'),
			b('Act Two', 'Midpoint', 50, 'A false victory or a false defeat changes the goal.'),
			b('Act Two', 'Second plot point', 75, 'All seems lost; the hero must find a new way.'),
			b('Act Three', 'Climax', 88, 'The final confrontation.'),
			b('Act Three', 'Resolution', 97, 'How the world has changed.'),
		],
	},
	{
		id: 'save-the-cat',
		name: 'Save the Cat',
		description: 'Blake Snyder’s fifteen beats.',
		beats: [
			b('Act One', 'Opening image', 1, 'A snapshot of the hero’s world before the story.'),
			b('Act One', 'Theme stated', 5, 'Someone says what the story is really about.'),
			b('Act One', 'Set-up', 3, 'The hero, their flaws and what is missing in their life.'),
			b('Act One', 'Catalyst', 10, 'The event that sets the story going.'),
			b('Act One', 'Debate', 15, 'The hero hesitates: should they go?'),
			b('Act Two A', 'Break into Two', 20, 'The hero chooses to act and enters a new world.'),
			b('Act Two A', 'B story', 22, 'A new character or relationship carries the theme.'),
			b('Act Two A', 'Fun and games', 30, 'The promise of the premise.'),
			b('Act Two A', 'Midpoint', 50, 'A false victory or false defeat; the stakes rise.'),
			b('Act Two B', 'Bad guys close in', 62, 'Pressure from outside and doubt from inside.'),
			b('Act Two B', 'All is lost', 75, 'The lowest point; something or someone is lost.'),
			b('Act Two B', 'Dark night of the soul', 78, 'The hero takes in the loss.'),
			b('Act Three', 'Break into Three', 80, 'The answer, often from the B story.'),
			b('Act Three', 'Finale', 90, 'The hero puts the lesson to work.'),
			b('Act Three', 'Final image', 99, 'The opposite of the opening image.'),
		],
	},
	{
		id: 'heros-journey',
		name: 'Hero’s Journey',
		description: 'The twelve stages of the hero’s journey.',
		beats: [
			b('Departure', 'The ordinary world', 0, 'The hero at home, before the adventure.'),
			b('Departure', 'The call to adventure', 8, 'A problem or a challenge appears.'),
			b('Departure', 'Refusal of the call', 12, 'Fear or duty holds the hero back.'),
			b('Departure', 'Meeting the mentor', 17, 'Advice, training or a gift.'),
			b('Departure', 'Crossing the threshold', 25, 'The hero leaves the known world.'),
			b('Initiation', 'Tests, allies and enemies', 35, 'The rules of the new world.'),
			b('Initiation', 'Approach to the inmost cave', 45, 'Preparing for the great ordeal.'),
			b('Initiation', 'The ordeal', 55, 'A crisis that seems like death.'),
			b('Initiation', 'The reward', 65, 'Something is won.'),
			b('Return', 'The road back', 75, 'The hero turns for home, and is pursued.'),
			b('Return', 'Resurrection', 88, 'One last test, using everything learned.'),
			b('Return', 'Return with the elixir', 97, 'The hero comes home changed, with something to share.'),
		],
	},
	{
		id: 'seven-point',
		name: 'Seven points',
		description: 'Dan Wells’s seven-point structure, planned from the ending back.',
		beats: [
			b('Beginning', 'Hook', 0, 'The hero’s starting state, the opposite of the resolution.'),
			b('Beginning', 'Plot turn 1', 20, 'Something changes and the story starts moving.'),
			b('Middle', 'Pinch 1', 35, 'Pressure: the antagonist shows their strength.'),
			b('Middle', 'Midpoint', 50, 'The hero moves from reacting to acting.'),
			b('Middle', 'Pinch 2', 65, 'More pressure; the plan fails, all seems lost.'),
			b('End', 'Plot turn 2', 80, 'The hero finds the last thing they need.'),
			b('End', 'Resolution', 100, 'The climax and the end state.'),
		],
	},
	{
		id: 'kishotenketsu',
		name: 'Kishōtenketsu',
		description: 'Four parts: introduction, development, twist and reconciliation, without needing conflict.',
		beats: [
			b('Ki', 'Introduction (ki)', 0, 'The characters and their world.'),
			b('Shō', 'Development (shō)', 25, 'The world deepens; nothing changes yet.'),
			b('Ten', 'Twist (ten)', 50, 'Something unexpected that casts it all in a new light.'),
			b('Ketsu', 'Reconciliation (ketsu)', 75, 'The parts come together in a new understanding.'),
		],
	},
];

export function storyStructure(id: string | null | undefined): StoryStructure | undefined {
	return STORY_STRUCTURES.find((s) => s.id === id);
}
