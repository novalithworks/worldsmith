/**
 * Marker classes instead of CSS `:has()` (0.30.9). Obsidian's review asks plugins to avoid
 * `:has` (it makes the browser re-check styles broadly). Worldsmith's styles select these
 * classes instead; this keeps them in step with the page: an element gets the class while it
 * contains the matching child. Only changes inside Worldsmith's own containers are looked at,
 * at most once per frame.
 */
const RULES: ReadonlyArray<readonly [element: string, contains: string, cls: string]> = [
	['.ws-prog__missing', '.ws-prog__clear', 'has-clear'],
	['.ws-frow', '.ws-segmented', 'has-segmented'],
	['.ws-frow', '.ws-switch', 'has-switch'],
	['.ws-tree-card', '.ws-tree-card__fold', 'has-fold'],
	['.ws-map-host', '.ws-map-editor', 'has-map-editor'],
	['.ws-vis-full', '.ws-map-editor', 'has-map-editor'],
	['.ws-vis-full', ':scope > .ws-map-bar', 'has-map-bar'],
	['.ws-graph-bar__lead', ':scope > .ws-btn:only-child', 'is-single'],
	['.ws-fact__value', ':scope > *', 'has-children'],
	['.ws-wr-tile', '.ws-wr-minring, .ws-wr-tile__flame', 'has-meter'],
	['.ws-wr-home', ':scope > .ws-wr-emptydesk', 'has-empty-desk'],
];
const ROOTS = '.worldsmith, .worldsmith-modal';

/** Marks every rule's elements inside `root`. */
export function applyHasMarks(root: ParentNode): void {
	for (const [sel, inner, cls] of RULES) {
		for (const el of Array.from(root.querySelectorAll(sel))) el.toggleClass(cls, !!el.querySelector(inner));
	}
}

/** Watches the document; returns the function that stops watching. */
export function watchHasMarks(doc: Document = activeDocument): () => void {
	const dirty = new Set<Element>();
	let queued = false;
	const flush = () => {
		queued = false;
		for (const root of dirty) if (root.isConnected) applyHasMarks(root);
		dirty.clear();
	};
	const obs = new MutationObserver((records) => {
		for (const r of records) {
			const t = r.target.instanceOf(Element) ? r.target : r.target.parentElement;
			const root = t?.closest(ROOTS);
			if (root) dirty.add(root);
			for (const n of Array.from(r.addedNodes)) if (n.instanceOf(Element) && n.matches(ROOTS)) dirty.add(n);
		}
		if (dirty.size && !queued) {
			queued = true;
			window.requestAnimationFrame(flush);
		}
	});
	obs.observe(doc.body, { childList: true, subtree: true });
	for (const root of Array.from(doc.querySelectorAll(ROOTS))) applyHasMarks(root);
	return () => obs.disconnect();
}
