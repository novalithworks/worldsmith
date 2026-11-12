import type { ManuscriptKind, ProjectKind } from '../../core/types';

/**
 * Starting structures for new projects. A template only makes records (parts, chapters,
 * scenes); scene notes are created only when the person asks for them.
 */
export interface TemplateNode {
	kind: ManuscriptKind;
	title: string;
	synopsis?: string;
	children?: TemplateNode[];
}

export interface StructureTemplate {
	id: string;
	name: string;
	description: string;
	/** Kinds of project it suits best (shown first); every template works for any kind. */
	suits: ProjectKind[];
	build(): TemplateNode[];
}

const scene = (title: string, synopsis = ''): TemplateNode => ({ kind: 'scene', title, synopsis });
const chapter = (n: number, synopsis = '', scenes = 1): TemplateNode => ({
	kind: 'chapter',
	title: `Chapter ${n}`,
	synopsis,
	children: Array.from({ length: scenes }, (_, i) => scene(`Chapter ${n}, scene ${i + 1}`)),
});

export const STRUCTURE_TEMPLATES: readonly StructureTemplate[] = [
	{
		id: 'blank',
		name: 'Blank',
		description: 'An empty project. Add parts, chapters and scenes as you go.',
		suits: ['novel', 'novella', 'short-story', 'anthology', 'script'],
		build: () => [],
	},
	{
		id: 'three-act',
		name: 'Three-act novel',
		description: 'Three parts (setup, confrontation, resolution) with twelve chapters and a scene in each.',
		suits: ['novel', 'novella'],
		build: () => [
			{
				kind: 'part',
				title: 'Act One: Setup',
				synopsis: 'The ordinary world, the hero and what they want. Ends when the inciting incident forces a choice.',
				children: [chapter(1, 'Opening image and the ordinary world.'), chapter(2, 'The inciting incident.'), chapter(3, 'Debate, then the decision that crosses into Act Two.')],
			},
			{
				kind: 'part',
				title: 'Act Two: Confrontation',
				synopsis: 'Rising stakes, allies and enemies, the midpoint turn, and the fall to the lowest point.',
				children: [
					chapter(4, 'A new world, new rules.'),
					chapter(5, 'Allies and enemies.'),
					chapter(6, 'Fun and games: the promise of the premise.'),
					chapter(7, 'Midpoint: a false victory or false defeat.'),
					chapter(8, 'The bad guys close in.'),
					chapter(9, 'All is lost.'),
				],
			},
			{
				kind: 'part',
				title: 'Act Three: Resolution',
				synopsis: 'The hero finds a new way, faces the climax and the world settles into its new shape.',
				children: [chapter(10, 'A new plan.'), chapter(11, 'The climax.'), chapter(12, 'Final image: how the world has changed.')],
			},
		],
	},
	{
		id: 'chapters',
		name: 'Chapters',
		description: 'Ten chapters with one scene each, no parts.',
		suits: ['novel', 'novella', 'script'],
		build: () => Array.from({ length: 10 }, (_, i) => chapter(i + 1)),
	},
	{
		id: 'short-story',
		name: 'Short story',
		description: 'Five scenes: opening, rising action, climax, falling action and ending.',
		suits: ['short-story'],
		build: () => [
			scene('Opening', 'Who, where, and what is wrong.'),
			scene('Rising action', 'Complications build toward a turning point.'),
			scene('Climax', 'The moment everything is decided.'),
			scene('Falling action', 'What the climax costs.'),
			scene('Ending', 'The last image.'),
		],
	},
	{
		id: 'anthology',
		name: 'Anthology',
		description: 'Three stories as parts, each with an opening scene.',
		suits: ['anthology'],
		build: () => [1, 2, 3].map((n) => ({ kind: 'part' as const, title: `Story ${n}`, children: [scene(`Story ${n}, opening`)] })),
	},
];

export function structureTemplate(id: string | undefined): StructureTemplate {
	return STRUCTURE_TEMPLATES.find((t) => t.id === id) ?? STRUCTURE_TEMPLATES[0]!;
}
