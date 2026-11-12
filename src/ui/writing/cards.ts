import { avatar } from '../components/avatar';
import type { FilterArg } from './boards';
import { setIcon, type Component } from 'obsidian';
import type { ManuscriptItem, WritingProject } from '../../core/types';
import { cx } from '../components/dom';
import { moveStep } from './actions';
import { statusFor, threadsOf } from './boards';
import { fmt, type Studio } from './kit';
import { describeWhen } from './planDialogs';
import { deviceMemory } from './device';

/*
 * What every story board shares (WS4): the index card of a scene, and the clicks and keys
 * on cards. A card is a button-like element: click selects it, double-click or Enter opens
 * the scene in the Manuscript, the "…" button, right-click or the context-menu key opens its
 * menu (status, plot threads, date, Move to…, Move up/down), and Alt+↑/↓ moves it one place
 * in the manuscript (the keyboard way to reorder; the menu's Move to… is the touch way).
 */

export interface BoardCtx {
	readonly st: Studio;
	readonly project: WritingProject;
	/** The board's filter: a plot thread and/or an entry (null = every scene). Truthy while filtering. */
	readonly thread: FilterArg;
	readonly component: Component;
	/** What scrolls (for drags near the edge, and keeping the place on redraw). */
	readonly scroller: HTMLElement;
	/** Open a scene, chapter or part in the Manuscript. */
	open(id: string): void;
	menu(id: string, at: MouseEvent | HTMLElement): void;
	/** Scene numbers in reading order. */
	sceneNo(id: string): number | undefined;
}

export interface BoardPane {
	refresh(): void;
}

export type CardSize = 'full' | 'compact' | 'mini';

/** A scene's index card: number and status, title, synopsis, words, plot-thread colours. */
export function sceneCard(parent: HTMLElement, ctx: BoardCtx, s: ManuscriptItem, o: { size: CardSize; where?: string; cls?: string }): HTMLElement {
	const p = ctx.project;
	const status = statusFor(p, s.status);
	const threads = threadsOf(p, s);
	const n = ctx.sceneNo(s.id);
	const card = parent.createDiv({
		cls: cx('ws-wr-ix', `ws-wr-ix--${o.size}`, o.size === 'full' && 'ws-wr-paper', threads[0]?.color && `ws-wr-ix--strip`, o.cls),
		attr: { 'data-id': s.id, tabindex: '0', role: 'listitem', 'aria-label': `${s.title}. ${status.label}${n ? `. Scene ${n}` : ''}` },
	});
	// The edge's colour: the first plot thread (default), the status, or the point of view (0.28).
	const colorBy = deviceMemory(ctx.st.ws.app).board(ctx.project.id).color ?? 'thread';
	const tint = colorBy === 'status' ? statusFor(ctx.project, s.status).color : colorBy === 'pov' ? (s.pov ? povTint(s.pov) : null) : threads[0]?.color;
	if (tint) card.createDiv({ cls: cx('ws-wr-ix__strip', `ws-tint--${tint}`), attr: { 'aria-hidden': 'true' } });
	const head = card.createDiv({ cls: 'ws-wr-ix__head' });
	if (o.size !== 'mini') head.createSpan({ cls: 'ws-wr-caps ws-wr-ix__no', text: [n ? `Scene ${n}` : 'Scene', o.where].filter(Boolean).join(' · ') });
	else if (n) head.createSpan({ cls: 'ws-wr-ix__badge', text: String(n), attr: { title: `Scene ${n} in reading order` } });
	const pill = head.createSpan({ cls: cx('ws-wr-ix__status', `ws-tint--${status.color}`, !status.known && 'is-unknown'), attr: { title: status.known ? status.label : `No status (it had “${(status as { was?: string }).was ?? s.status}”)` } });
	pill.createSpan({ cls: 'ws-wr-dot' });
	if (o.size !== 'mini') pill.createSpan({ text: status.label });
	const more = head.createEl('button', { cls: 'ws-wr-ix__more clickable-icon', attr: { type: 'button', 'aria-label': `Menu for ${s.title}`, tabindex: '-1' } });
	setIcon(more, 'more-horizontal');
	card.createDiv({ cls: 'ws-wr-ix__title', text: s.title });
	if (o.size === 'full') card.createDiv({ cls: cx('ws-wr-ix__syn', !s.synopsis && 'is-empty'), text: s.synopsis || 'No synopsis yet.' });
	// Who and where as chips (full cards), like index-card tags; smaller cards keep a face in the foot.
	const pov = s.pov ? ctx.st.s.entities.get(s.pov) : undefined;
	const place = s.location ? ctx.st.s.entities.get(s.location) : undefined;
	if (o.size === 'full' && ((pov && !pov.trashedAt) || (place && !place.trashedAt))) {
		const chips = card.createDiv({ cls: 'ws-wr-ix__chips' });
		if (pov && !pov.trashedAt) {
			const c = chips.createSpan({ cls: 'ws-wr-ix__chip ws-wr-ix__pov', attr: { title: `Point of view: ${pov.name}` } });
			avatar(c, ctx.st.ws.app, pov, ctx.st.s.schemas.get(pov.typeId), { size: 'xs' });
			c.createSpan({ text: pov.name });
		}
		if (place && !place.trashedAt) {
			const c = chips.createSpan({ cls: 'ws-wr-ix__chip ws-wr-ix__place', attr: { title: `Where: ${place.name}` } });
			setIcon(c.createSpan({ cls: 'ws-wr-ix__chipicon' }), 'map-pin');
			c.createSpan({ text: place.name });
		}
	}
	const foot = card.createDiv({ cls: 'ws-wr-ix__foot' });
	if (o.size !== 'mini') {
		const words = ctx.st.w.words.words(s.notePath);
		foot.createSpan({ cls: 'ws-wr-ix__words', text: words ? `${fmt(words)} ${words === 1 ? 'word' : 'words'}` : s.notePath ? 'Not started' : 'No note yet' });
		if (s.date && o.size === 'full') foot.createSpan({ cls: 'ws-wr-ix__when', text: describeWhen(s.date, s.time) });
	}
	if (pov && !pov.trashedAt && o.size !== 'mini' && o.size !== 'full') {
		const who = foot.createSpan({ cls: 'ws-wr-ix__pov', attr: { title: `Point of view: ${pov.name}` } });
		avatar(who, ctx.st.ws.app, pov, ctx.st.s.schemas.get(pov.typeId), { size: 'xs' });
		who.createSpan({ text: pov.name });
	}
	if (threads.length) {
		const dots = foot.createSpan({ cls: 'ws-wr-ix__threads', attr: { title: threads.map((t) => t.label).join(', ') } });
		for (const t of threads) dots.createSpan({ cls: cx('ws-wr-dot', `ws-tint--${t.color ?? 'gray'}`) });
	}
	return card;
}

/** A card's scene id from an event target. */
export function cardOf(target: EventTarget | null): HTMLElement | null {
	return target instanceof Element ? (target.closest('.ws-wr-ix')) : null;
}

/** Clicks and keys on the cards inside `root`. `onKey` handles a board's own keys first (return true when it did). */
export function bindCards(root: HTMLElement, ctx: BoardCtx, onKey?: (e: KeyboardEvent, s: ManuscriptItem, card: HTMLElement) => boolean): void {
	const select = (card: HTMLElement) => {
		root.querySelectorAll('.ws-wr-ix.is-selected').forEach((x) => x.removeClass('is-selected'));
		card.addClass('is-selected');
		card.focus({ preventScroll: true });
	};
	root.addEventListener('click', (e) => {
		const card = cardOf(e.target);
		if (!card) return;
		if ((e.target as Element).closest('.ws-wr-ix__more')) {
			e.stopPropagation();
			ctx.menu(card.dataset.id!, e);
			return;
		}
		select(card);
	});
	root.addEventListener('dblclick', (e) => {
		const card = cardOf(e.target);
		if (card) ctx.open(card.dataset.id!);
	});
	root.addEventListener('contextmenu', (e) => {
		const card = cardOf(e.target);
		if (!card) return;
		e.preventDefault();
		select(card);
		ctx.menu(card.dataset.id!, e);
	});
	root.addEventListener('keydown', (e) => {
		const card = cardOf(e.target);
		if (!card || e.target !== card) return;
		const s = ctx.st.w.item(card.dataset.id);
		if (!s) return;
		if (onKey?.(e, s, card)) return;
		const cards = [...root.querySelectorAll<HTMLElement>('.ws-wr-ix')];
		const i = cards.indexOf(card);
		const focus = (j: number) => {
			const c = cards[Math.max(0, Math.min(cards.length - 1, j))];
			if (c) select(c);
		};
		if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
			e.preventDefault();
			moveStep(ctx.st, s, e.key === 'ArrowUp' ? -1 : 1);
			return;
		}
		switch (e.key) {
			case 'Enter':
				e.preventDefault();
				ctx.open(s.id);
				break;
			case 'ArrowDown':
			case 'ArrowRight':
				e.preventDefault();
				focus(i + 1);
				break;
			case 'ArrowUp':
			case 'ArrowLeft':
				e.preventDefault();
				focus(i - 1);
				break;
			case 'Home':
				e.preventDefault();
				focus(0);
				break;
			case 'End':
				e.preventDefault();
				focus(cards.length - 1);
				break;
			case 'ContextMenu':
				e.preventDefault();
				ctx.menu(s.id, card);
				break;
			default:
				if (e.key === 'F10' && e.shiftKey) {
					e.preventDefault();
					ctx.menu(s.id, card);
				}
		}
	});
}

/** Keep focus on the same card (by id) across a redraw. */
export function focusedCard(root: HTMLElement): string | null {
	const a = activeDocument.activeElement;
	return a instanceof HTMLElement && root.contains(a) && a.hasClass('ws-wr-ix') ? (a.dataset.id ?? null) : null;
}
export function refocus(root: HTMLElement, id: string | null): void {
	if (!id) return;
	const c = root.querySelector<HTMLElement>(`.ws-wr-ix[data-id="${CSS.escape(id)}"]`);
	if (c) {
		c.addClass('is-selected');
		c.focus({ preventScroll: true });
	}
}

const POV_TINTS = ['orange', 'blue', 'green', 'purple', 'pink', 'teal', 'yellow', 'red'];
/** A steady colour per character (the same one on every card). */
export function povTint(id: string): string {
	let h = 0;
	for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
	return POV_TINTS[h % POV_TINTS.length]!;
}
