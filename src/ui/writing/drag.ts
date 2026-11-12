import type { Component } from 'obsidian';

/*
 * Dragging on the story boards (WS4), with pointer events so it works with a mouse, a pen
 * and a finger (HTML5 drag and drop never fires on touch screens). With a mouse a drag starts
 * after the pointer moves a few pixels; with a finger, after holding still for a moment (so
 * swiping still scrolls). A light copy of the card follows the pointer, the board's own
 * scroller scrolls near its edges, and Esc cancels. Every board also has keyboard and menu
 * ways to do the same thing (Move up/down, Move to…, Status).
 */

export interface DragSpec<T> {
	/** Where drags start (pointerdown is listened for here). */
	root: HTMLElement;
	/** Selector of what can be dragged, inside `root`. */
	item: string;
	/** What scrolls while dragging near its edges. */
	scrollers?: () => HTMLElement[];
	/** The payload for a drag of this element (null: it can't be dragged). */
	start(el: HTMLElement): T | null;
	/** The pointer moved: show where it would land. */
	over(x: number, y: number, payload: T, under: Element | null): void;
	/** Dropped (not cancelled). */
	drop(x: number, y: number, payload: T, under: Element | null): void;
	/** The drag ended either way: clear what `over` showed. */
	end(): void;
}

const NO_DRAG = 'input, textarea, select, button, a, [contenteditable="true"], [data-nodrag]';
const MOUSE_SLOP = 5;
const TOUCH_SLOP = 8;
const HOLD_MS = 360;

/** True while any board drag is running (boards don't redraw under the pointer meanwhile). */
export let dragging = false;

export function pointerDrag<T>(c: Component, spec: DragSpec<T>): void {
	let pending: { el: HTMLElement; x: number; y: number; id: number; touch: boolean; timer: number | null } | null = null;
	let live: { el: HTMLElement; payload: T; ghost: HTMLElement; dx: number; dy: number; x: number; y: number; id: number; raf: number | null } | null = null;
	let swallowClick = false;
	const win = () => spec.root.win ?? window;
	const doc = () => spec.root.doc ?? activeDocument;

	const under = (x: number, y: number) => doc().elementFromPoint(x, y);

	const begin = () => {
		const p = pending;
		pending = null;
		if (!p) return;
		if (p.timer !== null) win().clearTimeout(p.timer);
		const payload = spec.start(p.el);
		if (payload === null) return;
		const r = p.el.getBoundingClientRect();
		const ghost = p.el.cloneNode(true) as HTMLElement;
		ghost.addClass('ws-wr-ghost');
		ghost.removeAttribute('id');
		ghost.setAttr('aria-hidden', 'true');
		ghost.style.width = `${r.width}px`;
		ghost.style.left = `${r.left}px`;
		ghost.style.top = `${r.top}px`;
		// Inside the page, so it keeps the studio's look (it is fixed, so it doesn't scroll).
		spec.root.appendChild(ghost);
		p.el.addClass('is-dragging');
		spec.root.addClass('is-drag-on');
		dragging = true;
		live = { el: p.el, payload, ghost, dx: p.x - r.left, dy: p.y - r.top, x: p.x, y: p.y, id: p.id, raf: null };
		try {
			spec.root.setPointerCapture(p.id);
		} catch {
			/* the pointer is gone already */
		}
		if (p.touch) navigator.vibrate?.(8);
		move(p.x, p.y);
		tick();
	};

	const move = (x: number, y: number) => {
		if (!live) return;
		live.x = x;
		live.y = y;
		live.ghost.style.transform = `translate(${x - live.dx - parseFloat(live.ghost.style.left)}px, ${y - live.dy - parseFloat(live.ghost.style.top)}px) rotate(1.5deg)`;
		spec.over(x, y, live.payload, under(x, y));
	};

	/** Scroll the board while the pointer rests near an edge. */
	const tick = () => {
		if (!live) return;
		for (const s of spec.scrollers?.() ?? []) {
			const r = s.getBoundingClientRect();
			const edge = 36;
			const v = (d: number) => Math.ceil(((edge - d) / edge) * 14);
			if (live.y < r.top + edge && live.y > r.top - 20) s.scrollTop -= v(live.y - r.top);
			else if (live.y > r.bottom - edge && live.y < r.bottom + 20) s.scrollTop += v(r.bottom - live.y);
			if (live.x < r.left + edge && live.x > r.left - 20) s.scrollLeft -= v(live.x - r.left);
			else if (live.x > r.right - edge && live.x < r.right + 20) s.scrollLeft += v(r.right - live.x);
		}
		live.raf = win().requestAnimationFrame(() => {
			if (!live) return;
			spec.over(live.x, live.y, live.payload, under(live.x, live.y));
			tick();
		});
	};

	const finish = (drop: boolean) => {
		if (pending?.timer != null) win().clearTimeout(pending.timer);
		pending = null;
		const l = live;
		live = null;
		if (!l) return;
		dragging = false;
		if (l.raf !== null) win().cancelAnimationFrame(l.raf);
		l.ghost.remove();
		l.el.removeClass('is-dragging');
		spec.root.removeClass('is-drag-on');
		swallowClick = true;
		win().setTimeout(() => (swallowClick = false), 0);
		try {
			if (drop) spec.drop(l.x, l.y, l.payload, under(l.x, l.y));
		} finally {
			spec.end();
		}
	};

	const onDown = (e: PointerEvent) => {
		if (live || (e.pointerType === 'mouse' && e.button !== 0)) return;
		const t = e.target as Element | null;
		if (!t || t.closest(NO_DRAG)) return;
		const el = t.closest(spec.item);
		if (!el || !spec.root.contains(el)) return;
		const touch = e.pointerType !== 'mouse';
		pending = { el, x: e.clientX, y: e.clientY, id: e.pointerId, touch, timer: null };
		if (touch) pending.timer = win().setTimeout(begin, HOLD_MS);
	};
	const onMove = (e: PointerEvent) => {
		if (live) {
			if (e.pointerId !== live.id) return;
			e.preventDefault();
			move(e.clientX, e.clientY);
			return;
		}
		if (!pending || e.pointerId !== pending.id) return;
		// The button was let go somewhere we didn't hear about: this press is over.
		if (!pending.touch && (e.buttons & 1) === 0) {
			pending = null;
			return;
		}
		const d = Math.hypot(e.clientX - pending.x, e.clientY - pending.y);
		if (pending.touch) {
			// Moving before the hold is up: it's a scroll, not a drag.
			if (d > TOUCH_SLOP) {
				if (pending.timer !== null) win().clearTimeout(pending.timer);
				pending = null;
			}
		} else if (d > MOUSE_SLOP) begin();
	};
	const onUp = (e: PointerEvent) => {
		if (live && e.pointerId === live.id) finish(true);
		else if (pending && e.pointerId === pending.id) {
			if (pending.timer !== null) win().clearTimeout(pending.timer);
			pending = null;
		}
	};
	/** A press that never became a drag ends wherever the button is let go (even outside the board). */
	const onDocUp = (e: PointerEvent) => {
		if (!live && pending && e.pointerId === pending.id) {
			if (pending.timer !== null) win().clearTimeout(pending.timer);
			pending = null;
		}
	};
	const onCancel = (e: PointerEvent) => {
		if ((live && e.pointerId === live.id) || (pending && e.pointerId === pending.id)) finish(false);
	};
	const onKey = (e: KeyboardEvent) => {
		if (live && e.key === 'Escape') {
			e.preventDefault();
			e.stopPropagation();
			finish(false);
		}
	};
	// While a finger drags, the page must not scroll under it.
	const onTouchMove = (e: TouchEvent) => {
		if (live) e.preventDefault();
	};
	const onClick = (e: MouseEvent) => {
		if (!swallowClick) return;
		swallowClick = false;
		e.preventDefault();
		e.stopPropagation();
	};
	const onContext = (e: Event) => {
		// A long press on touch opens the context menu in some browsers: not while dragging.
		if (live || pending?.touch) e.preventDefault();
	};

	const root = spec.root;
	root.addEventListener('pointerdown', onDown);
	root.addEventListener('pointermove', onMove);
	root.addEventListener('pointerup', onUp);
	root.addEventListener('pointercancel', onCancel);
	root.addEventListener('click', onClick, true);
	root.addEventListener('contextmenu', onContext, true);
	root.addEventListener('touchmove', onTouchMove, { passive: false });
	const d = doc();
	d.addEventListener('keydown', onKey, true);
	d.addEventListener('pointerup', onDocUp, true);
	d.addEventListener('pointercancel', onDocUp, true);
	c.register(() => {
		finish(false);
		root.removeEventListener('pointerdown', onDown);
		root.removeEventListener('pointermove', onMove);
		root.removeEventListener('pointerup', onUp);
		root.removeEventListener('pointercancel', onCancel);
		root.removeEventListener('click', onClick, true);
		root.removeEventListener('contextmenu', onContext, true);
		root.removeEventListener('touchmove', onTouchMove);
		d.removeEventListener('keydown', onKey, true);
		d.removeEventListener('pointerup', onDocUp, true);
		d.removeEventListener('pointercancel', onDocUp, true);
	});
}
