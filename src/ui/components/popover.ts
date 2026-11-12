import { nameRegion, isSheet } from './dom';
/**
 * A small floating panel anchored to an element inside a Worldsmith pane (so it inherits
 * the scoped styles). Closes on outside click, Escape, or `close()`; flips above the
 * anchor when there's no room below.
 */
/** Open popovers by element, so one opened from inside another counts as part of it. */
const OPEN = new WeakMap<HTMLElement, Popover>();

export class Popover {
	readonly el: HTMLElement;
	private cleanup: Array<() => void> = [];
	private closed = false;
	/** Popovers opened from inside this one (a picker from a filter panel). */
	private children = new Set<Popover>();

	constructor(
		private anchor: HTMLElement,
		opts: { cls?: string; width?: number; label?: string; onClose?: () => void } = {},
	) {
		const host = (anchor.closest('.worldsmith, .worldsmith-modal .modal-content, .modal-content')) ?? anchor.ownerDocument.body;
		this.el = host.createDiv({ cls: ['ws-popover', ...(opts.cls ? opts.cls.split(/\s+/).filter(Boolean) : [])], attr: { role: 'dialog'} });
		const name = nameRegion(this.el, opts.label ?? '');
		this.cleanup.push(() => name.remove());
		const parentEl = anchor.closest<HTMLElement>('.ws-popover');
		const parent = parentEl ? OPEN.get(parentEl) : undefined;
		if (parent) {
			parent.children.add(this);
			this.cleanup.push(() => parent.children.delete(this));
		}
		OPEN.set(this.el, this);
		if (opts.width) this.el.style.width = `${opts.width}px`;
		const doc = anchor.ownerDocument;
		const outside = (e: Event) => {
			const t = e.target as Node;
			// A menu opened from inside the panel (e.g. "Add a filter") isn't "outside".
			if ((t as HTMLElement).closest?.('.menu')) return;
			if ([...this.children].some((c) => c.el.contains(t))) return;
			if (!this.el.contains(t) && !this.anchor.contains(t)) this.close();
		};
		const key = (e: KeyboardEvent) => {
			if (e.key !== 'Escape' || this.children.size) return; // the innermost one closes first
			e.preventDefault();
			e.stopPropagation();
			this.close();
			this.anchor.focus({ preventScroll: true });
		};
		const reposition = () => this.position();
		doc.addEventListener('mousedown', outside, true);
		doc.addEventListener('touchstart', outside, true);
		doc.addEventListener('keydown', key, true);
		doc.addEventListener('scroll', reposition, true);
		doc.defaultView?.addEventListener('resize', reposition);
		this.cleanup.push(
			() => doc.removeEventListener('mousedown', outside, true),
			() => doc.removeEventListener('touchstart', outside, true),
			() => doc.removeEventListener('keydown', key, true),
			() => doc.removeEventListener('scroll', reposition, true),
			() => doc.defaultView?.removeEventListener('resize', reposition),
		);
		if (opts.onClose) this.cleanup.push(opts.onClose);
		// Placed at once, then again when its content is in: left where it was created (below
		// the pane) a panel that focuses or reveals a row would scroll the pane to it.
		this.position();
		window.requestAnimationFrame(() => this.position());
	}

	/** False once closed, including when its anchor was already gone as it opened. */
	get isOpen(): boolean {
		return !this.closed;
	}

	/** Follow a replacement anchor (e.g. a toolbar that re-rendered while this is open). */
	setAnchor(el: HTMLElement): void {
		this.anchor = el;
		this.position();
	}

	position(): void {
		if (this.closed) return;
		// Its button was redrawn away and nobody re-anchored it: close rather than jump to a corner.
		if (!this.anchor.isConnected) {
			this.close();
			return;
		}
		const host = this.el.parentElement as HTMLElement;
		const hr = host.getBoundingClientRect();
		const ar = this.anchor.getBoundingClientRect();
		const view = this.el.ownerDocument.defaultView;
		// Kept inside what can be seen: the host (the pane) and the window, whichever is smaller.
		const minX = Math.max(hr.left, 0) + 8;
		const maxX = Math.min(hr.right, view?.innerWidth ?? hr.right) - 8;
		const minY = Math.max(hr.top, 0) + 8;
		const maxY = Math.min(hr.bottom, view?.innerHeight ?? hr.bottom) - 8;
		this.el.style.maxWidth = `${Math.max(160, maxX - minX)}px`;
		// On a phone-sized pane the panel is a sheet fixed to the bottom (codex.css): of the pane, not the window.
		this.el.style.setProperty('--ws-sheet-l', `${Math.round(minX)}px`);
		this.el.style.setProperty('--ws-sheet-r', `${Math.round((view?.innerWidth ?? hr.right) - maxX)}px`);
		this.el.style.setProperty('--ws-sheet-b', `${Math.round((view?.innerHeight ?? hr.bottom) - maxY)}px`);
		if (isSheet(this.el)) {
			this.el.setCssStyles({ top: '', left: '', width: '', maxWidth: '', maxHeight: '' });
			this.el.removeClass('is-capped');
			return;
		}
		this.el.setCssStyles({ maxHeight: '' });
		this.el.removeClass('is-capped');
		const w = this.el.offsetWidth || 280;
		let h = this.el.offsetHeight || 300;
		const x = Math.max(minX, Math.min(ar.left, maxX - w));
		const below = maxY - ar.bottom - 6;
		const aboveRoom = ar.top - minY - 6;
		const up = below < h && aboveRoom > below;
		const room = Math.max(120, up ? aboveRoom : below);
		if (h > room) {
			// Taller than the room on either side: it scrolls inside instead of running off.
			this.el.style.maxHeight = `${room}px`;
			this.el.addClass('is-capped');
			h = room;
		}
		this.el.toggleClass('is-above', up);
		const y = up ? ar.top - h - 6 : ar.bottom + 6;
		this.el.style.left = `${x - hr.left + host.scrollLeft}px`;
		this.el.style.top = `${y - hr.top + host.scrollTop}px`;
	}

	close(): void {
		if (this.closed) return;
		this.closed = true;
		for (const c of [...this.children]) c.close();
		for (const c of this.cleanup) c();
		this.el.remove();
	}
}
