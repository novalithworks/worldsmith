import type { ChronoDate } from './chrono';
import type { EntityId, SemanticColor } from './ids';

/**
 * Writing Studio (WS2). A project is a folder of ordinary Markdown notes; everything else
 * (order, status, POV, places, dates, threads, goals) lives here, in Worldsmith's own data.
 * Worldsmith never writes into the notes themselves: a scene only *points* at its note.
 *
 * Files: `writing/projects/<projectId>.json` (one project each) and
 * `writing/manuscript/<projectId>.json` (every part, chapter and scene of that project).
 */

export type ProjectKind = 'novel' | 'novella' | 'short-story' | 'anthology' | 'script';
export const PROJECT_KINDS: readonly ProjectKind[] = ['novel', 'novella', 'short-story', 'anthology', 'script'];

/** A scene status of one project ("First draft"). Ids are slugs, immutable once made. */
export interface SceneStatus {
	id: string;
	label: string;
	color: SemanticColor;
	/** Counts as finished in progress roll-ups. */
	done: boolean;
}

/** A plot thread scenes can belong to (WS4 draws the grid; WS2 stores membership). */
export interface PlotThread {
	id: string;
	label: string;
	color: SemanticColor | null;
	description: string;
}

/**
 * A story beat of the project's structure (WS4): "Catalyst", "Midpoint". Beats are planning
 * marks only: they never create, move or change chapters and scenes. A beat lists the
 * scenes that carry it.
 */
export interface StoryBeat {
	id: string;
	label: string;
	description: string;
	/** The act or section it belongs to ("Act One"). */
	group: string;
	/** Where it usually falls in the book, in percent (guidance only), or null. */
	position: number | null;
	/** Scenes that carry this beat (ids; scenes in the trash are simply not shown). */
	sceneIds: string[];
	/** The structure it came from (a built-in id, `own:<templateId>`, or `custom`). */
	source: string;
}

/** A reusable planning skeleton the writer saved from a project (WS4). */
export interface WritingTemplate {
	v: number;
	id: string;
	name: string;
	description: string;
	/** Parts, chapters and scene titles with synopses (no notes, no text). */
	outline: WritingTemplateNode[];
	beats: Array<Pick<StoryBeat, 'label' | 'description' | 'group' | 'position'>>;
	statuses: SceneStatus[];
	/** The status new scenes start with (null: the first). */
	defaultStatus: string | null;
	threads: PlotThread[];
	/** Deleted (kept for Undo; hidden). */
	trashedAt: number | null;
	createdAt: number;
	updatedAt: number;
	rev: number;
}

export interface WritingTemplateNode {
	kind: ManuscriptKind;
	title: string;
	synopsis?: string;
	children?: WritingTemplateNode[];
}

/** A revision pass (WS6): "Tighten dialogue", with the scenes done in it. */
export interface RevisionPass {
	id: string;
	name: string;
	createdAt: number;
	done: string[];
	/** 0.28: things to check in this pass. */
	checklist?: Array<{ id: string; text: string; done: boolean }>;
}

/** A research item (0.28): a pointer to something used while writing; nothing is copied. */
export interface ResearchItem {
	id: string;
	kind: 'note' | 'image' | 'link' | 'source' | 'entry' | 'board';
	title: string;
	/** note / image: the vault file. */
	path?: string;
	/** link: the web address. */
	url?: string;
	/** source: where in it ("Ch. 1, p. 9"). */
	citation?: string;
	/** entry: the world entry. */
	entityId?: string;
	/** board: vault images. */
	images?: string[];
	/** Scenes it's used in. */
	scenes: string[];
	createdAt: number;
}

/** A marked passage (0.28): a quote from a scene with a note, to deal with in revision. */
export interface MarkedPassage {
	id: string;
	sceneId: string;
	quote: string;
	note: string;
	createdAt: number;
}

/** Where a character starts and ends in one book (WS5). */
export interface CharacterArc {
	start: string;
	end: string;
	/** 0.28: the character in this book. */
	wants?: string;
	needs?: string;
	flaw?: string;
	internal?: string;
	external?: string;
	arc?: string;
	/** 0.28: where they are in each of their scenes, from despair (−1) to hope (1). */
	points?: Record<string, number>;
	/** 0.28: scenes that are turning points, with what turns ("Takes the oath"). */
	turning?: Record<string, string>;
}

export interface WritingProject {
	v: number;
	id: string;
	name: string;
	kind: ProjectKind;
	/** Vault folder the manuscript notes live in (new scene notes are created here). */
	folder: string;
	description: string;
	statuses: SceneStatus[];
	/** Status new scenes start with. */
	defaultStatus: string;
	threads: PlotThread[];
	/**
	 * WS4: statuses and threads taken off the list. Kept so the scenes that have them still
	 * say what they were, and so they can be brought back; scenes keep their values.
	 */
	retiredStatuses: SceneStatus[];
	retiredThreads: PlotThread[];
	/** WS4: the story beats of every structure used (only `structure`'s are shown). */
	beats: StoryBeat[];
	/** WS4: the structure shown on the Plot tab (a built-in id, `own:<id>`, `custom`), or null. */
	structure: string | null;
	/** WS5 (0.23): a character's arc in this book, by entry id. Absent on older records. */
	arcs?: Record<string, CharacterArc>;
	/** WS6 (0.24): words a day to aim for (null = none). */
	dailyGoal?: number | null;
	/** WS6: the day to finish by, "YYYY-MM-DD" (null = none). */
	deadline?: string | null;
	/** WS6: net words written per local day, "YYYY-MM-DD" → words. */
	days?: Record<string, number>;
	/** 0.28: words a week and a month to aim for (null = the daily goal × 7 / × 30). */
	weeklyGoal?: number | null;
	monthlyGoal?: number | null;
	/** 0.28: writing sessions, recorded on their own (a pause of 15 minutes starts a new one); newest last. */
	sessions?: Array<{ start: number; end: number; words: number; sceneId: string | null }>;
	/** WS6: the last writing sprints, newest last. */
	sprints?: Array<{ start: number; minutes: number; words: number }>;
	/** WS6 (0.25): revision passes, each with the scenes marked done in it. */
	passes?: RevisionPass[];
	/** 0.28: passages marked for revision, newest last. */
	marks?: MarkedPassage[];
	/** 0.28: the book's research library. */
	research?: ResearchItem[];
	/** 0.28: genre ("Epic fantasy"), series ("The Ashen Chronicles, Book One"), a tagline or epigraph. */
	genre?: string;
	series?: string;
	tagline?: string;
	/** WS7 (0.26): the author's name on the title page, and the last compile choices. */
	author?: string;
	compile?: Record<string, string | boolean>;
	/** Book word goal. */
	wordTarget: number | null;
	/** Archived projects are hidden from the studio; nothing else changes. */
	archivedAt: number | null;
	/** Position in the project list. */
	order: number;
	createdAt: number;
	updatedAt: number;
	rev: number;
}

export type ManuscriptKind = 'part' | 'chapter' | 'scene';

/**
 * One part, chapter or scene. Manuscript order is a depth-first walk of the tree:
 * `parentId` (null = top level of the project) and `order` among siblings.
 *
 * Scene metadata fields exist on every item (so the shape is one record type) but are
 * only used on scenes; `notePath` is always null on parts and chapters.
 */
export interface ManuscriptItem {
	v: number;
	id: string;
	projectId: string;
	kind: ManuscriptKind;
	parentId: string | null;
	order: number;
	title: string;
	synopsis: string;
	color: SemanticColor | null;
	/** Binder state: children hidden (parts and chapters). */
	collapsed: boolean;
	/** The scene's Markdown note; null when the scene has no note yet. */
	notePath: string | null;
	status: string;
	/** Point-of-view character (an entity id). */
	pov: EntityId | null;
	/** Characters in the scene (entity ids). */
	cast: EntityId[];
	/** Where it happens (an entity id). */
	location: EntityId | null;
	/** In-world date, in the world's calendars. */
	date: ChronoDate | null;
	/** WS4: in-story time of day, "HH:MM" (24 h), or null. */
	time: string | null;
	/** Plot thread ids of the project. */
	threads: string[];
	wordTarget: number | null;
	/** What the scene is for ("reveal the betrayal"). */
	purpose: string;
	/** The writer's own notes about the item (WS3), kept in Worldsmith's data, never in the note. */
	notes: string;
	/** In Worldsmith's trash (restorable). The note is never touched. */
	trashedAt: number | null;
	createdAt: number;
	updatedAt: number;
	rev: number;
}

/** Fields the studio edits directly on an item. */
export type ManuscriptPatch = Partial<
	Pick<ManuscriptItem, 'title' | 'synopsis' | 'color' | 'status' | 'pov' | 'cast' | 'location' | 'date' | 'time' | 'threads' | 'wordTarget' | 'purpose' | 'notes' | 'collapsed'>
>;
