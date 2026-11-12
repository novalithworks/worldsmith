import { setIcon, setTooltip } from 'obsidian';
import type { SemanticColor, StatusDefinition } from '../../core/types';

/**
 * Small, consistent building blocks. Every interactive element is a real <button> (or
 * input) so keyboard and screen-reader access come for free.
 */

export function icon(parent: HTMLElement, name: string, cls?: string): HTMLSpanElement {
	// One or several classes ("a b" is split: class lists reject spaces).
	const el = parent.createSpan({ cls: cls ? ['ws-icon', ...cls.split(/\s+/).filter(Boolean)] : 'ws-icon' });
	el.setAttr('aria-hidden', 'true');
	setIcon(el, name);
	return el;
}

export interface ButtonOptions {
	label?: string;
	icon?: string;
	/** Visual weight. 'quiet' = icon-only toolbar button. */
	variant?: 'primary' | 'default' | 'ghost' | 'quiet' | 'danger';
	size?: 'sm' | 'md';
	tooltip?: string;
	ariaLabel?: string;
	/** One class, several space-separated, or a list (e.g. from `cx`). */
	cls?: string | string[];
	disabled?: boolean;
	onClick?: (evt: MouseEvent) => void;
}

export function button(parent: HTMLElement, o: ButtonOptions): HTMLButtonElement {
	const cls = ['ws-btn', `ws-btn--${o.variant ?? 'default'}`, `ws-btn--${o.size ?? 'md'}`];
	if (!o.label) cls.push('ws-btn--icon-only');
	// Several classes may be given space-separated ("ws-vbar__sort is-active").
	if (o.cls) cls.push(...(Array.isArray(o.cls) ? o.cls : [o.cls]).flatMap((c) => c.split(/\s+/)).filter(Boolean));
	const btn = parent.createEl('button', { cls, attr: { type: 'button' } });
	if (o.icon) icon(btn, o.icon, 'ws-btn__icon');
	if (o.label) btn.createSpan({ cls: 'ws-btn__label', text: o.label });
	const aria = o.ariaLabel ?? (o.label ? undefined : o.tooltip);
	if (aria) btn.setAttr('aria-label', aria);
	if (o.tooltip) setTooltip(btn, o.tooltip, { delay: 400 });
	if (o.disabled) btn.disabled = true;
	if (o.onClick) btn.addEventListener('click', (e) => o.onClick?.(e));
	return btn;
}

export interface EmptyStateOptions {
	icon: string;
	title: string;
	body?: string;
	actionLabel?: string;
	actionIcon?: string;
	onAction?: () => void;
	compact?: boolean;
}

/** Empty states invite the next action instead of leaving blank space. */
export function emptyState(parent: HTMLElement, o: EmptyStateOptions): HTMLElement {
	const el = parent.createDiv({ cls: cx('ws-empty', o.compact ? 'ws-empty--compact' : '') });
	const mark = el.createDiv({ cls: 'ws-empty__mark' });
	icon(mark, o.icon);
	el.createDiv({ cls: 'ws-empty__title', text: o.title });
	if (o.body) el.createDiv({ cls: 'ws-empty__body', text: o.body });
	if (o.actionLabel && o.onAction) {
		button(el, { label: o.actionLabel, icon: o.actionIcon ?? 'plus', variant: 'ghost', size: 'sm', onClick: o.onAction });
	}
	return el;
}

/** A circular progress indicator. `set()` animates to a new value. */
export function progressRing(parent: HTMLElement, ratio: number, size = 30): { el: HTMLElement; set(r: number): void } {
	const el = parent.createDiv({ cls: 'ws-ring' });
	el.style.setProperty('--ws-ring-size', `${size}px`);
	const ns = 'http://www.w3.org/2000/svg';
	const svg = document.createElementNS(ns, 'svg');
	svg.setAttribute('viewBox', '0 0 36 36');
	svg.setAttribute('aria-hidden', 'true');
	const track = document.createElementNS(ns, 'circle');
	const bar = document.createElementNS(ns, 'circle');
	for (const c of [track, bar]) {
		c.setAttribute('cx', '18');
		c.setAttribute('cy', '18');
		c.setAttribute('r', '15.5');
		svg.appendChild(c);
	}
	track.setAttribute('class', 'ws-ring__track');
	bar.setAttribute('class', 'ws-ring__bar');
	el.appendChild(svg);
	const label = el.createSpan({ cls: 'ws-ring__label' });
	const C = 2 * Math.PI * 15.5;
	bar.setAttribute('stroke-dasharray', `${C}`);
	const set = (r: number) => {
		const clamped = Math.max(0, Math.min(1, r));
		bar.setAttribute('stroke-dashoffset', `${C * (1 - clamped)}`);
		label.setText(`${Math.round(clamped * 100)}`);
		el.setAttr('role', 'img');
		el.setAttr('aria-label', `${Math.round(clamped * 100)}% developed`);
		el.toggleClass('is-complete', clamped >= 1);
	};
	set(ratio);
	return { el, set };
}

export interface ChipOptions {
	label: string;
	color?: SemanticColor | null;
	icon?: string;
	onClick?: (evt: MouseEvent) => void;
	onRemove?: () => void;
	tooltip?: string;
}

export function chip(parent: HTMLElement, o: ChipOptions): HTMLElement {
	const el = parent.createSpan({ cls: cx('ws-chip', o.color ? `ws-tint--${o.color}` : '') });
	if (o.icon) icon(el, o.icon, 'ws-chip__icon');
	el.createSpan({ cls: 'ws-chip__label', text: o.label });
	if (o.tooltip) setTooltip(el, o.tooltip, { delay: 400 });
	if (o.onClick) {
		el.addClass('is-clickable');
		el.setAttr('role', 'button');
		el.tabIndex = 0;
		el.addEventListener('click', (e) => o.onClick?.(e));
		el.addEventListener('keydown', (e) => {
			if (e.key === 'Enter' || e.key === ' ') {
				e.preventDefault();
				o.onClick?.(e as unknown as MouseEvent);
			}
		});
	}
	if (o.onRemove) {
		const x = el.createEl('button', { cls: 'ws-chip__remove', attr: { type: 'button', 'aria-label': `Remove ${o.label}` } });
		setIcon(x, 'x');
		x.addEventListener('click', (e) => {
			e.stopPropagation();
			o.onRemove?.();
		});
	}
	return el;
}

export function statusPill(parent: HTMLElement, status: StatusDefinition | undefined): HTMLElement {
	const el = parent.createSpan({ cls: ['ws-status', `ws-tint--${status?.color ?? 'gray'}`] });
	el.createSpan({ cls: 'ws-status__dot' });
	el.createSpan({ text: status?.label ?? 'No status' });
	return el;
}

/** Make a non-button element keyboard-activatable. */
export function makeActivatable(el: HTMLElement, onActivate: (evt: MouseEvent | KeyboardEvent) => void, label?: string): void {
	el.tabIndex = 0;
	el.setAttr('role', 'button');
	if (label) el.setAttr('aria-label', label);
	el.addEventListener('click', onActivate);
	el.addEventListener('keydown', (e) => {
		if (e.key === 'Enter' || e.key === ' ') {
			e.preventDefault();
			onActivate(e);
		}
	});
}

/** Auto-grow a textarea to fit its content. */
export function autoGrow(ta: HTMLTextAreaElement): () => void {
	const fit = () => {
		// Hidden or not yet laid out: measuring now would lock in a wrong height.
		if (!ta.isConnected || ta.clientWidth === 0) return;
		ta.setCssStyles({ height: 'auto' });
		ta.style.height = `${ta.scrollHeight}px`;
	};
	ta.addEventListener('input', fit);
	window.requestAnimationFrame(fit);
	// Re-fit when the width changes (pane resized, phone rotated, layout reflowed).
	if (typeof ResizeObserver !== 'undefined') {
		let width = -1;
		const ro = new ResizeObserver(() => {
			if (ta.clientWidth === width) return;
			width = ta.clientWidth;
			fit();
		});
		ro.observe(ta);
	}
	return fit;
}

/** Join class names, dropping empty/false entries (never pass '' to classList). */
export function cx(...parts: Array<string | false | null | undefined>): string[] {
	// Split "a b" into separate tokens: classList.add rejects tokens with spaces.
	return parts.flatMap((p) => (p ? p.split(/\s+/).filter(Boolean) : []));
}

let nameSeq = 0;
/**
 * Give a container (a navigation, toolbar, tab list, dialog…) an accessible name without
 * `aria-label`: Obsidian turns every aria-label into a hover tooltip, and on a large region
 * that tooltip appears wherever the pointer is ("Worldsmith navigation" over the whole
 * sidebar). The name lives in a visually hidden element just before the container, so it
 * survives the container being emptied and re-drawn.
 */
export function nameRegion(el: HTMLElement, text: string): HTMLElement {
	const label = createSpan();
	label.id = `ws-name-${++nameSeq}`;
	label.className = 'ws-visually-hidden';
	label.textContent = text.trim();
	if (el.parentElement) el.insertAdjacentElement('beforebegin', label);
	else el.prepend(label);
	el.setAttribute('aria-labelledby', label.id);
	return label;
}

/**
 * Bring a row into view inside its own scrolling list, and nothing else. Unlike
 * `scrollIntoView`, it never scrolls the page or the pane behind a panel: a panel that
 * isn't placed yet sits below the pane, and scrolling to it there made the screen jolt.
 */
export function revealInList(list: HTMLElement, row: HTMLElement): void {
	const lr = list.getBoundingClientRect();
	const rr = row.getBoundingClientRect();
	if (rr.top < lr.top) list.scrollTop -= lr.top - rr.top;
	else if (rr.bottom > lr.bottom) list.scrollTop += Math.min(rr.bottom - lr.bottom, rr.top - lr.top);
}

/**
 * Is this pop-up shown as a sheet along the bottom (Codex look, phone-sized pane, codex.css)?
 * Then the stylesheet places it, and the pop-up sets no inline position or size.
 */
export function isSheet(el: HTMLElement): boolean {
	return el.ownerDocument.body.hasClass('ws-look-codex') && !!el.closest(".worldsmith[data-ws-size='narrow']");
}

/**
 * Keeps inline styles on the elements matching `selector` inside `container`, re-applying them
 * whenever something else (Obsidian) rewrites those elements' inline style. Used where
 * Obsidian sets an inline value Worldsmith must replace (a stylesheet can't, without
 * !important). Stops once the container leaves the page.
 */
export function pinStyles(container: HTMLElement, selector: string, styles: Record<string, string>): void {
	// The values as the browser writes them back (e.g. "0" reads as "0px"), so a match is exact.
	const probe = createDiv();
	probe.setCssStyles(styles as Partial<CSSStyleDeclaration>);
	const want = Object.keys(styles).map((k) => [k, (probe.style as unknown as Record<string, string>)[k]] as const);
	let attached = container.isConnected;
	const apply = () => {
		for (const el of Array.from(container.querySelectorAll<HTMLElement>(selector))) {
			const style = el.style as unknown as Record<string, string>;
			if (want.some(([k, v]) => style[k] !== v)) el.setCssStyles(styles as Partial<CSSStyleDeclaration>);
		}
	};
	const obs = new MutationObserver(() => {
		if (container.isConnected) attached = true;
		else if (attached) return obs.disconnect();
		apply();
	});
	obs.observe(container, { childList: true, subtree: true, attributes: true, attributeFilter: ['style'] });
	apply();
}
