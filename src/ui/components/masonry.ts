/**
 * Masonry without CSS columns (0.30.9): the container is a grid of thin rows (its CSS sets
 * `grid-auto-rows` to MASONRY_ROW and `align-items: start`); each item spans as many rows as its
 * height needs, so items keep their own shapes and stack in staggered columns. Re-measured when
 * the container is resized, an item changes size (an image loads) or items are added; the
 * watching stops once the container leaves the page.
 */
export const MASONRY_ROW = 4;

export function masonry(container: HTMLElement): void {
	let queued = false;
	const lay = () => {
		queued = false;
		if (!container.isConnected) return stop();
		for (const child of Array.from(container.children)) {
			if (!child.instanceOf(HTMLElement)) continue;
			const style = getComputedStyle(child);
			if (style.display === 'none') continue;
			const h = child.getBoundingClientRect().height + (parseFloat(style.marginTop) || 0) + (parseFloat(style.marginBottom) || 0);
			child.setCssStyles({ gridRowEnd: `span ${Math.max(1, Math.ceil(h / MASONRY_ROW))}` });
		}
	};
	const soon = () => {
		if (queued) return;
		queued = true;
		window.requestAnimationFrame(lay);
	};
	const sizes = new ResizeObserver(soon);
	const watch = () => {
		sizes.observe(container);
		for (const child of Array.from(container.children)) sizes.observe(child);
	};
	const changes = new MutationObserver(() => {
		watch();
		soon();
	});
	const stop = () => {
		sizes.disconnect();
		changes.disconnect();
	};
	watch();
	changes.observe(container, { childList: true });
	container.addEventListener('load', soon, true);
	soon();
}
