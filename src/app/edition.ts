import type { FeatureId } from '../core/features';
import { safeUrl } from '../core/util/urls';

/**
 * Editions (0.30): Worldsmith Free (the community directory) and Worldsmith Pro (sold
 * separately on Buy Me a Coffee, no licence key). One codebase; the build decides (WS_EDITION=free|pro). In the
 * free edition the Pro parts are switched off and can't be switched on; their code and any data
 * a world already has are kept.
 */

declare const __EDITION__: string | undefined;

export const EDITION: 'free' | 'pro' = typeof __EDITION__ !== 'undefined' && __EDITION__ === 'free' ? 'free' : 'pro';

/**
 * The edition's name, fixed into each build when it's made (0.30.6): a free build contains only
 * "Worldsmith Free edition", a Pro build only "Worldsmith Pro edition". The release script
 * checks for it, so a Pro build can never be released as the free one.
 */
export const EDITION_NAME: string = typeof __EDITION__ !== 'undefined' && __EDITION__ === 'free' ? 'Worldsmith Free edition' : 'Worldsmith Pro edition';

/** The parts that come with Pro. */
export const PRO_FEATURES: readonly FeatureId[] = ['writing', 'maps', 'timeline', 'trees', 'graph', 'calendars'];

/** Where Worldsmith Pro is sold. */
export const PRO_URL = 'https://buymeacoffee.com/novalith';

/** The other edition's plugin id (the two must not run together). */
export const OTHER_EDITION_ID = EDITION === 'free' ? 'worldsmith-pro' : 'worldsmith';

export function isLocked(id: FeatureId): boolean {
	return EDITION === 'free' && PRO_FEATURES.includes(id);
}

export function openProPage(): void {
	const url = safeUrl(PRO_URL);
	if (url) window.open(url, '_blank', 'noopener,noreferrer');
}
