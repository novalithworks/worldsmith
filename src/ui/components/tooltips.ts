/**
 * The "Hover tooltips" preference. Obsidian draws tooltips (from aria-label and
 * setTooltip) in one shared element on <body>, so while the pointer is over a Worldsmith
 * pane or dialog <body> carries `ws-tooltips-off` and a scoped rule hides them.
 *
 * One `pointerover` listener per window decides from what's under the pointer, so the mark
 * can't get stuck when a dialog or pane is removed while the pointer is still over it.
 */
let enabled = true;
const watched = new WeakSet<Document>();

export function setTooltipsEnabled(on: boolean): void {
	enabled = on;
	if (on) for (const d of [activeDocument]) d.body.removeClass('ws-tooltips-off');
}

export function tooltipsEnabled(): boolean {
	return enabled;
}

export function watchTooltips(el: HTMLElement): void {
	const doc = el.ownerDocument;
	if (watched.has(doc)) return;
	watched.add(doc);
	doc.addEventListener(
		'pointerover',
		(e) => {
			const over = !!(e.target as HTMLElement | null)?.closest?.('.worldsmith, .worldsmith-modal');
			doc.body.toggleClass('ws-tooltips-off', over && !enabled);
		},
		{ capture: true, passive: true },
	);
}

/** Drop the mark (a Worldsmith pane or dialog closed under the pointer). */
export function releaseTooltips(doc: Document = activeDocument): void {
	doc.body.removeClass('ws-tooltips-off');
}
