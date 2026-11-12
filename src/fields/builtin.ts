import type { FieldTypeDefinition, FieldTypeLogic, FieldTypeUI } from './FieldType';
import * as L from './types/logic';
import { booleanUI, listUI, multiSelectUI, selectUI, tagsUI } from './ui/choice';
import { chronoUI } from './ui/chrono';
import { fileUI, galleryUI, imageUI } from './ui/media';
import { numberUI, percentUI, progressUI, ratingUI } from './ui/numeric';
import { childrenUI, formulaUI, parentUI, relationUI, rollupUI } from './ui/relation';
import { colorUI, dateUI, iconUI, longTextUI, richTextUI, textUI, timeUI, urlUI } from './ui/textual';

/**
 * Built-in field types: pure logic (fields/types/logic.ts) joined with its UI
 * (fields/ui/*). Registered through the same API extensions use.
 */
const pairs: Array<[FieldTypeLogic, FieldTypeUI]> = [
	[L.textLogic, textUI],
	[L.longTextLogic, longTextUI],
	[L.richTextLogic, richTextUI],
	[L.numberLogic, numberUI],
	[L.percentLogic, percentUI],
	[L.booleanLogic, booleanUI],
	[L.dateLogic, dateUI],
	[L.chronoLogic, chronoUI],
	[L.timeLogic, timeUI],
	[L.selectLogic, selectUI],
	[L.multiSelectLogic, multiSelectUI],
	[L.listLogic, listUI],
	[L.tagsLogic, tagsUI],
	[L.ratingLogic, ratingUI],
	[L.progressLogic, progressUI],
	[L.urlLogic, urlUI],
	[L.fileLogic, fileUI],
	[L.imageLogic, imageUI],
	[L.galleryLogic, galleryUI],
	[L.colorLogic, colorUI],
	[L.iconLogic, iconUI],
	[L.relationLogic, relationUI],
	[L.parentLogic, parentUI],
	[L.childrenLogic, childrenUI],
	[L.rollupLogic, rollupUI],
	[L.formulaLogic, formulaUI],
];

export const BUILTIN_FIELD_TYPES: FieldTypeDefinition[] = pairs.map(([logic, ui]) => ({ ...logic, ui }));
