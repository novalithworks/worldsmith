/** Worldsmith's section markers in native notes (`%% ws-start view:… %%`, `%% ws-end … %%`). */
export const NOTE_MARKER = /^%%\s*ws-(?:start|end)\b.*%%\s*$/;

/** Is this whole line one of Worldsmith's markers? */
export function isMarkerLine(text: string): boolean {
	return NOTE_MARKER.test(text);
}
