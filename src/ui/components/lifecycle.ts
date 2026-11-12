import type { Component } from 'obsidian';
import type { Disposable } from '../../core/util/disposable';

/**
 * Tie a Worldsmith Disposable (event subscription, registry entry) to an Obsidian
 * Component so it is released when the component unloads.
 */
export function own(component: Component, d: Disposable | (() => void)): void {
	component.register(typeof d === 'function' ? d : () => d.dispose());
}

/** Observe an element's width; cleaned up with the component. */
export function observeWidth(component: Component, el: HTMLElement, cb: (width: number) => void): void {
	const ro = new ResizeObserver((entries) => {
		const w = entries[0]?.contentRect.width;
		if (w !== undefined) cb(w);
	});
	ro.observe(el);
	component.register(() => ro.disconnect());
}
