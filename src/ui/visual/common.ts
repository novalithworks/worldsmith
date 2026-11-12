import { Menu } from 'obsidian';
import type { CanvasBackground } from '../../core/types';
import { button, cx, icon } from '../components/dom';
import type { PanZoom } from '../components/panzoom';
import { formRow, inlineText, segmented, toggle } from '../views/routes/typeStudio/common';

/**
 * Shared pieces of the Family trees, Relationship graph and Maps pages (0.11): a header
 * with the document's name, a switcher between documents, Customize panels and the
 * zoom buttons over a canvas.
 */

export interface VisualHeader {
	head: HTMLElement;
	actions: HTMLElement;
}

export function visualHeader(
	parent: HTMLElement,
	o: { icon: string; tint: string; title: string; desc: string; editable?: boolean; onRename?: (name: string) => void; onDescribe?: (text: string) => void },
): VisualHeader {
	const head = parent.createDiv({ cls: 'ws-studio-head ws-vis-head' });
	const mark = head.createDiv({ cls: `ws-db-header__mark ws-tint--${o.tint}` });
	icon(mark, o.icon);
	const ht = head.createDiv({ cls: 'ws-db-header__text' });
	if (o.editable && o.onRename) {
		const h = ht.createEl('h1', { cls: 'ws-db-header__title ws-vis-head__title' });
		inlineText(h, o.title, { ariaLabel: 'Name', cls: 'ws-vis-head__name', onCommit: (v) => v.trim() && o.onRename!(v.trim()) });
	} else ht.createEl('h1', { cls: 'ws-db-header__title', text: o.title });
	if (o.editable && o.onDescribe) inlineText(ht, o.desc, { ariaLabel: 'Description', placeholder: 'Add a short description…', multiline: true, cls: 'ws-db-header__desc ws-vis-head__desc', onCommit: (v) => o.onDescribe!(v.trim()) });
	else ht.createDiv({ cls: 'ws-db-header__desc', text: o.desc });
	const actions = head.createDiv({ cls: 'ws-db-header__actions' });
	return { head, actions };
}

/** A titled group inside a Customize panel. */
export function panelSection(parent: HTMLElement, title: string, iconName?: string): HTMLElement {
	const sec = parent.createDiv({ cls: 'ws-vis-panel__section' });
	const h = sec.createDiv({ cls: 'ws-vis-panel__title' });
	if (iconName) icon(h, iconName);
	h.createSpan({ text: title });
	return sec;
}

export function segmentedRow<T extends string>(parent: HTMLElement, label: string, options: Array<{ id: T; label: string; icon?: string }>, value: T, onChange: (v: T) => void): HTMLElement {
	const c = formRow(parent, label);
	return segmented(c, options, value, onChange, label);
}

export function toggleRow(parent: HTMLElement, label: string, value: boolean, onChange: (v: boolean) => void, hint?: string): HTMLButtonElement {
	const c = formRow(parent, label, hint);
	return toggle(c, value, onChange, label);
}

/** − 2 + */
export function stepperRow(parent: HTMLElement, label: string, value: number, min: number, max: number, onChange: (v: number) => void, hint?: string): HTMLElement {
	const c = formRow(parent, label, hint);
	const box = c.createDiv({ cls: 'ws-stepper', attr: { role: 'group', 'aria-label': label } });
	button(box, { icon: 'minus', variant: 'quiet', size: 'sm', tooltip: 'Fewer', disabled: value <= min, cls: 'ws-stepper__down', onClick: () => onChange(Math.max(min, value - 1)) });
	box.createSpan({ cls: 'ws-stepper__value', text: String(value) });
	button(box, { icon: 'plus', variant: 'quiet', size: 'sm', tooltip: 'More', disabled: value >= max, cls: 'ws-stepper__up', onClick: () => onChange(Math.min(max, value + 1)) });
	return box;
}

export const BACKGROUND_OPTIONS: Array<{ id: CanvasBackground; label: string }> = [
	{ id: 'dots', label: 'Dots' },
	{ id: 'grid', label: 'Grid' },
	{ id: 'parchment', label: 'Parchment' },
	{ id: 'plain', label: 'Plain' },
];

/** Zoom out, zoom in, fit — floating over a canvas. */
export function canvasHud(parent: HTMLElement, pz: () => PanZoom | null, fit: () => void, extra?: (bar: HTMLElement) => void): HTMLElement {
	const hud = parent.createDiv({ cls: 'ws-canvas__hud' });
	if (extra) extra(hud);
	button(hud, { icon: 'zoom-out', variant: 'quiet', size: 'sm', tooltip: 'Zoom out', cls: 'ws-canvas__zoom-out', onClick: () => pz()?.zoomBy(1 / 1.3) });
	button(hud, { icon: 'zoom-in', variant: 'quiet', size: 'sm', tooltip: 'Zoom in', cls: 'ws-canvas__zoom-in', onClick: () => pz()?.zoomBy(1.3) });
	button(hud, { icon: 'maximize', variant: 'quiet', size: 'sm', tooltip: 'Fit everything', cls: 'ws-canvas__fit', onClick: fit });
	return hud;
}

/** The big "start one" cards on an empty page. */
export function startCard(parent: HTMLElement, o: { icon: string; tint: string; title: string; body: string; cta: string; onClick: (evt: MouseEvent) => void; attr?: Record<string, string> }): HTMLButtonElement {
	const b = parent.createEl('button', { cls: cx('ws-vis-start', `ws-tint--${o.tint}`), attr: { type: 'button', ...(o.attr ?? {}) } });
	const mark = b.createDiv({ cls: 'ws-vis-start__mark' });
	icon(mark, o.icon);
	b.createDiv({ cls: 'ws-vis-start__title', text: o.title });
	b.createDiv({ cls: 'ws-vis-start__body', text: o.body });
	const cta = b.createDiv({ cls: 'ws-vis-start__cta' });
	cta.createSpan({ text: o.cta });
	icon(cta, 'arrow-right');
	b.addEventListener('click', (e) => o.onClick(e));
	return b;
}

// ── Home pages and the full-screen view (0.12) ──────────────────────────────────────

/**
 * A home page: the header, the "start one" cards (always first, so they never move),
 * then everything already made as a grid of cards.
 */
export function visualHome(parent: HTMLElement, o: { title: string; count: number; noun: string; empty: string }): { starts: HTMLElement; grid: HTMLElement | null; wrap: HTMLElement } {
	const wrap = parent.createDiv({ cls: 'ws-vis-home' });
	const top = wrap.createDiv({ cls: 'ws-vis-home__section' });
	top.createDiv({ cls: 'ws-vis-home__label', text: 'Start something new' });
	const starts = top.createDiv({ cls: 'ws-vis-starts' });
	const mine = wrap.createDiv({ cls: 'ws-vis-home__section' });
	const head = mine.createDiv({ cls: 'ws-vis-home__label' });
	head.createSpan({ text: o.title });
	if (o.count) head.createSpan({ cls: 'ws-vis-home__count', text: String(o.count) });
	if (!o.count) {
		const none = mine.createDiv({ cls: 'ws-vis-home__empty' });
		icon(none, 'sparkles');
		none.createSpan({ text: o.empty });
		return { starts, grid: null, wrap };
	}
	return { starts, grid: mine.createDiv({ cls: 'ws-vis-cards' }), wrap };
}

/** The usual things to do with a map, tree or view, for a right-click or the ⋯ button. */
export interface DocActions {
	noun: string;
	onOpen?: () => void;
	onRename?: () => void;
	onDuplicate?: () => void;
	onDelete?: () => void;
	extra?: (m: Menu) => void;
}

export function docMenu(a: DocActions): Menu {
	const m = new Menu();
	if (a.onOpen) m.addItem((i) => i.setTitle('Open').setIcon('arrow-up-right').onClick(() => a.onOpen!()));
	if (a.onRename) m.addItem((i) => i.setTitle('Rename…').setIcon('pencil').onClick(() => a.onRename!()));
	if (a.onDuplicate) m.addItem((i) => i.setTitle('Duplicate').setIcon('copy').onClick(() => a.onDuplicate!()));
	if (a.extra) a.extra(m);
	if (a.onDelete) {
		m.addSeparator();
		m.addItem((i) => i.setTitle(`Delete ${a.noun}`).setIcon('trash-2').setWarning(true).onClick(() => a.onDelete!()));
	}
	return m;
}

/** A card on a home page: a picture on top, the name and a line under it; right-click for more. */
export function docCard(
	grid: HTMLElement,
	o: { id: string; name: string; meta: string; icon: string; tint: string; cls?: string; attr?: Record<string, string>; picture: (frame: HTMLElement) => void; actions: DocActions },
): HTMLElement {
	const card = grid.createDiv({ cls: cx('ws-vis-card', `ws-tint--${o.tint}`, o.cls), attr: { 'data-doc': o.id, ...(o.attr ?? {}) } });
	const open = card.createEl('button', { cls: 'ws-vis-card__open', attr: { type: 'button', 'aria-label': `Open ${o.name}` } });
	const frame = open.createDiv({ cls: 'ws-vis-card__frame' });
	o.picture(frame);
	const text = open.createDiv({ cls: 'ws-vis-card__text' });
	const nameRow = text.createDiv({ cls: 'ws-vis-card__name-row' });
	icon(nameRow, o.icon, 'ws-vis-card__icon');
	nameRow.createDiv({ cls: 'ws-vis-card__name', text: o.name, attr: { title: o.name } });
	text.createDiv({ cls: 'ws-vis-card__meta', text: o.meta, attr: { title: o.meta } });
	open.addEventListener('click', () => o.actions.onOpen?.());
	const more = button(card, { icon: 'more-horizontal', variant: 'quiet', size: 'sm', tooltip: 'More', cls: 'ws-vis-card__more', onClick: (evt) => docMenu({ ...o.actions, onOpen: undefined }).showAtMouseEvent(evt) });
	more.setAttr('aria-label', `More for ${o.name}`);
	card.addEventListener('contextmenu', (evt) => {
		evt.preventDefault();
		docMenu(o.actions).showAtMouseEvent(evt);
	});
	return card;
}

export interface FullView {
	/** The canvas goes in here; it fills the whole page. */
	host: HTMLElement;
	/** Buttons on the right of the top bar (Layers, Customize…). */
	actions: HTMLElement;
	/** Show a new name (renamed elsewhere, or made unique on save) without rebuilding. */
	setName(name: string): void;
	/** Under the title: filters and such. */
	sub: HTMLElement;
}

/**
 * A map, tree or graph as the page itself (0.12): the canvas fills everything, and a slim
 * floating bar on top holds the way home, the name (click to rename) and the ⋯ menu.
 */
export function fullView(
	parent: HTMLElement,
	o: { icon: string; tint: string; title: string; home: string; label: (name: string) => string; onHome: () => void; onRename?: (name: string) => void; menu: () => DocActions; hostCls?: string },
): FullView {
	const root = parent.createDiv({ cls: 'ws-vis-full' });
	const host = root.createDiv({ cls: cx('ws-vis__canvas-host', 'ws-vis-full__host', o.hostCls), attr: { tabindex: '0', 'aria-label': o.label(o.title) } });
	const top = root.createDiv({ cls: 'ws-vis-full__top' });
	const bar = top.createDiv({ cls: 'ws-vis-full__bar' });
	const home = bar.createEl('button', { cls: 'ws-vis-full__home', attr: { type: 'button', 'aria-label': `Back to ${o.home}`, title: `Back to ${o.home}` } });
	icon(home, 'chevron-left');
	home.createSpan({ cls: 'ws-vis-full__home-label', text: o.home });
	home.addEventListener('click', () => o.onHome());
	bar.createDiv({ cls: 'ws-vis-full__sep' });
	const mark = bar.createDiv({ cls: `ws-vis-full__mark ws-tint--${o.tint}` });
	icon(mark, o.icon);
	let name = o.title;
	let setName: (v: string) => void;
	if (o.onRename) {
		const input = bar.createEl('input', { cls: 'ws-inline ws-vis-full__name', attr: { type: 'text', spellcheck: 'false', 'aria-label': 'Name' } });
		input.value = name;
		// Only what was typed is committed: a rename from elsewhere mustn't be undone on blur.
		let dirty = false;
		input.addEventListener('input', () => (dirty = true));
		const commit = () => {
			const typed = dirty;
			dirty = false;
			const v = input.value.trim();
			if (!typed) {
				input.value = name;
				return;
			}
			// A blank name puts the old one back.
			if (!v || v === name) {
				input.value = name;
				return;
			}
			name = v;
			o.onRename!(v);
		};
		input.addEventListener('blur', commit);
		input.addEventListener('keydown', (e) => {
			if (e.key === 'Enter') {
				e.preventDefault();
				input.blur();
			} else if (e.key === 'Escape') {
				input.value = name;
				dirty = false;
				input.blur();
			}
			e.stopPropagation();
		});
		setName = (v) => {
			name = v;
			host.setAttr('aria-label', o.label(v));
			if (!dirty) input.value = v;
		};
	} else {
		const el = bar.createDiv({ cls: 'ws-vis-full__name is-static', text: name });
		setName = (v) => {
			el.setText(v);
			host.setAttr('aria-label', o.label(v));
		};
	}
	button(bar, { icon: 'more-horizontal', variant: 'quiet', size: 'sm', tooltip: 'More', cls: 'ws-vis-full__more', onClick: (evt) => docMenu(o.menu()).showAtMouseEvent(evt) });
	const actions = top.createDiv({ cls: 'ws-vis-full__actions' });
	const sub = root.createDiv({ cls: 'ws-vis-full__sub' });
	return { host, actions, sub, setName: (v) => setName(v) };
}

/** A description box at the top of a Customize panel. */
export function aboutSection(parent: HTMLElement, value: string, placeholder: string, onCommit: (v: string) => void): HTMLElement {
	const sec = panelSection(parent, 'About', 'info');
	inlineText(sec, value, { ariaLabel: 'Description', placeholder, multiline: true, cls: 'ws-vis-panel__about', onCommit: (v) => onCommit(v.trim()) });
	return sec;
}
