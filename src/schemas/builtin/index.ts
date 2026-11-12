import type { EntityTypeTemplate } from '../../core/types';
import { abilityType } from './ability';
import { artifactType } from './artifact';
import { characterType } from './character';
import { creatureType } from './creature';
import { cultureType } from './culture';
import { deityType } from './deity';
import { eraType } from './era';
import { eventType } from './event';
import { factionType } from './faction';
import { languageType } from './language';
import { locationType } from './location';
import { loreType } from './lore';
import { magicType } from './magic';
import { nationType } from './nation';
import { religionType } from './religion';
import { speciesType } from './species';
import { technologyType } from './technology';

/**
 * The 17 built-in type templates. They are seeded into every new world as ordinary
 * schema data. To add a built-in type: create a file here and add it to this list.
 */
export const BUILTIN_TYPES: EntityTypeTemplate[] = [
	characterType,
	locationType,
	creatureType,
	speciesType,
	magicType,
	abilityType,
	artifactType,
	technologyType,
	factionType,
	nationType,
	cultureType,
	religionType,
	deityType,
	languageType,
	eventType,
	eraType,
	loreType,
].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
