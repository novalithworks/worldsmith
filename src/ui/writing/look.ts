import type { WritingSettings } from '../../settings/settings';

/*
 * The writing page's look (WS3): surface, text width, line height, size and font, set as
 * CSS variables on the studio so every page in it (the main editor and a second scene
 * beside it) follows the settings, live.
 */

/** The bundled-feeling book face for long prose (fonts most systems have, best first). */
export const BOOK_SERIF = "'Charter', 'Bitstream Charter', 'Iowan Old Style', 'Palatino Linotype', 'Book Antiqua', Georgia, serif";

/** The CSS font-family for the text. Pure. */
export function proseFont(w: Pick<WritingSettings, 'font' | 'customFont'>): string {
	if (w.font === 'theme') return 'var(--font-text, inherit)';
	if (w.font === 'custom' && w.customFont.trim()) return `'${w.customFont.trim().replace(/['"\\;{}]/g, '')}', ${BOOK_SERIF}`;
	return BOOK_SERIF;
}

/** The CSS variables for these settings. Pure. */
export function writingVars(w: WritingSettings): Record<string, string> {
	return {
		'--ws-wr-measure': `${w.pageWidth}ch`,
		'--ws-wr-leading': String(w.lineHeight),
		'--ws-wr-size': `${w.fontSize}px`,
		'--ws-wr-prose': proseFont(w),
	};
}

/**
 * The theme's own colours, read where Worldsmith's palette doesn't reach (the body), for the
 * "Theme" surface: inside Worldsmith's pane the bronze palette has replaced them.
 */
const THEME_VARS = [
	'--background-primary',
	'--background-primary-alt',
	'--background-secondary',
	'--background-modifier-border',
	'--background-modifier-hover',
	'--background-modifier-form-field',
	'--text-normal',
	'--text-muted',
	'--text-faint',
	'--text-accent',
	'--text-accent-hover',
	'--text-selection',
	'--text-highlight-bg',
	'--text-on-accent',
	'--interactive-accent',
	'--interactive-accent-hover',
	'--interactive-normal',
	'--interactive-hover',
	'--color-accent',
	'--link-color',
	'--link-color-hover',
	'--link-unresolved-color',
	'--hr-color',
	'--blockquote-border-color',
	'--code-background',
	'--caret-color',
	'--icon-color',
	'--icon-color-hover',
	'--h1-color',
	'--h2-color',
	'--h3-color',
	'--h4-color',
	'--h5-color',
	'--h6-color',
];

export function themeColours(doc: Document): Record<string, string> {
	const cs = doc.defaultView?.getComputedStyle(doc.body);
	const out: Record<string, string> = {};
	if (!cs) return out;
	for (const v of THEME_VARS) {
		const val = cs.getPropertyValue(v).trim();
		if (val) out[v] = val;
	}
	return out;
}

/** Put the settings on the studio element. */
export function applyWritingLook(el: HTMLElement, w: WritingSettings): void {
	el.dataset.surface = w.surface;
	el.toggleClass('is-typewriter', w.typewriter);
	el.toggleClass('is-dim', w.dimOthers);
	el.setCssProps(writingVars(w));
}

/**
 * Give a writing page the theme's own colours (the Theme surface), or take them off again.
 * Set on the page only, so the studio around it keeps Worldsmith's colours.
 */
export function paintSurface(page: HTMLElement, w: WritingSettings): void {
	for (const k of THEME_VARS) page.style.removeProperty(k);
	if (w.surface === 'theme') page.setCssProps(themeColours(page.ownerDocument));
}
