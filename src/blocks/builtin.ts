import type { BlockDefinition } from './BlockRegistry';
import { entryChartBlock, entryListBlock, entryStatBlock, featuredEntryBlock, linksBlock } from './dashboard/builders';
import { imageWallBlock, randomQuoteBlock, recentConnectionsBlock, searchBoxBlock, spotlightBlock, worldAttentionBlock, worldProgressBlock } from './dashboard/discover';
import { contentsBlock, favoritesBlock, quickCreateBlock, recentBlock, worldHeroBlock } from './dashboard/dashboard';
import { descriptionBlock } from './entity/description';
import { heroBlock } from './entity/hero';
import { propertiesBlock } from './entity/properties';
import { unusedDataBlock } from './entity/unusedData';
import { connectionsBlock } from './entity/connections';
import { checklistBlock } from './entity/checklist';
import { headingBlock, imageSpotlightBlock, keyFactsBlock, quoteBlock, singleFieldBlock, statBlockBlock } from './entity/feature';
import { relationshipWebBlock, rosterBlock, sharedConnectionsBlock } from './entity/network';
import { embeddedNoteBlock, noteBacklinksBlock } from './entity/notes';
import { taskStatsBlock } from './tasks/stats';
import { taskCalendarBlock } from './tasks/calendar';
import { attentionBlock, dueSoonBlock, focusBlock, overdueBlock, progressByTypeBlock, recentBlock as recentTasksBlock } from './tasks/lists';
import { taskBoardBlock, taskTableBlock } from './tasks/taskTable';
import { taskChartBlock, taskNotesBlock } from './tasks/extras';
import { timelineBlock } from './dashboard/time';
import { worldHealthBlock } from './dashboard/health';
import { connectionMapBlock, familyTreeBlock, mapBlock } from './visual';
import { childrenBlock, galleryBlock, linkedNoteBlock, namesTagsBlock, progressBlock } from './entity/side';

/** Task widgets that also belong on dashboards (grouped under "Tasks" there). */
for (const b of [taskStatsBlock, dueSoonBlock, overdueBlock, taskCalendarBlock, taskTableBlock, taskBoardBlock, taskChartBlock, recentTasksBlock, progressByTypeBlock, taskNotesBlock]) {
	if (!b.surfaces.includes('dashboard')) b.surfaces = [...b.surfaces, 'dashboard'];
	b.category ??= 'Tasks';
}
// Tasks-page-only widgets share the same group, so that drawer has no stray heading.
for (const b of [attentionBlock, focusBlock]) b.category ??= 'Tasks';

/** Built-in blocks, registered through the same API extensions use. */
export const BUILTIN_BLOCKS: BlockDefinition[] = [
	// Entry pages (order within each category = "Add a widget" order)
	heroBlock,
	descriptionBlock,
	propertiesBlock,
	progressBlock,
	checklistBlock,
	namesTagsBlock,
	linkedNoteBlock,
	childrenBlock,
	galleryBlock,
	unusedDataBlock,
	keyFactsBlock,
	quoteBlock,
	statBlockBlock,
	imageSpotlightBlock,
	singleFieldBlock,
	headingBlock,
	connectionsBlock,
	relationshipWebBlock,
	familyTreeBlock,
	connectionMapBlock,
	mapBlock,
	rosterBlock,
	sharedConnectionsBlock,
	noteBacklinksBlock,
	embeddedNoteBlock,
	timelineBlock,
	// Dashboards (Home and your own), by category
	worldHeroBlock,
	contentsBlock,
	quickCreateBlock,
	searchBoxBlock,
	worldProgressBlock,
	entryListBlock,
	entryStatBlock,
	entryChartBlock,
	featuredEntryBlock,
	linksBlock,
	recentBlock,
	favoritesBlock,
	recentConnectionsBlock,
	spotlightBlock,
	randomQuoteBlock,
	imageWallBlock,
	worldAttentionBlock,
	worldHealthBlock,
	// Tasks home widgets (order = "Add a widget" order)
	taskCalendarBlock,
	taskStatsBlock,
	taskChartBlock,
	dueSoonBlock,
	overdueBlock,
	taskTableBlock,
	taskBoardBlock,
	recentTasksBlock,
	progressByTypeBlock,
	attentionBlock,
	focusBlock,
	taskNotesBlock,
];
