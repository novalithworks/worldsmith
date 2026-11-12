import type { Component, PaneType } from 'obsidian';
import type { WorldsmithContext } from '../../app/context';
import type { ManuscriptItem, SceneStatus, WritingProject } from '../../core/types';
import type { WorldSession } from '../../services/WorldSession';
import type { WritingService } from '../../services/writing/WritingService';
import { cx, icon } from '../components/dom';
import { coverOf, kindLabel } from './model';

/** The studio's sections. Home and Projects are outside a project; the rest inside one. */
export type StudioView = 'home' | 'projects' | 'stats' | 'settings' | 'overview' | 'manuscript' | 'trash' | 'plot' | 'arcs' | 'goals' | 'revision' | 'research' | 'compile' | 'corkboard' | 'outline' | 'kanban' | 'timeline' | 'table';

/** What every studio screen gets from the page. */
export interface Studio {
	readonly ws: WorldsmithContext;
	readonly s: WorldSession;
	readonly w: WritingService;
	/** Released when the page is left. */
	readonly component: Component;
	readonly project: WritingProject | null;
	readonly view: StudioView;
	/** Go somewhere in the studio (with history). */
	go(o: { project?: string | null; view?: StudioView; item?: string | null }, newLeaf?: boolean | PaneType): void;
	/** Redraw the current screen now (normally it redraws itself on changes). */
	repaint(): void;
}

/** A screen that can refresh itself in place (keeping scroll, focus and what is being typed). */
export interface StudioScreen {
	refresh(): void;
}

export const fmt = (n: number): string => n.toLocaleString();

/** Small spaced capitals. */
export function caps(parent: HTMLElement, text: string, cls?: string): HTMLElement {
	return parent.createDiv({ cls: cx('ws-wr-caps', cls), text });
}

/** A project's generated cover: one of five colourways, an arch, the title. */
export function cover(parent: HTMLElement, project: WritingProject, size: 'mini' | 'card' | 'hero'): HTMLElement {
	const c = parent.createDiv({ cls: cx('ws-wr-cover', `ws-wr-cover--${coverOf(project.id)}`, `ws-wr-cover--${size}`), attr: { 'aria-hidden': 'true' } });
	if (size === 'mini') return c;
	c.createDiv({ cls: 'ws-wr-cover__orn' });
	c.createDiv({ cls: 'ws-wr-cover__title', text: project.name });
	if (size === 'hero') c.createDiv({ cls: 'ws-wr-cover__sub', text: kindLabel(project.kind) });
	return c;
}

export function dot(parent: HTMLElement, status: SceneStatus, cls?: string): HTMLElement {
	return parent.createSpan({ cls: cx('ws-wr-dot', `ws-tint--${status.color}`, cls), attr: { title: status.label } });
}

/** A status as a small pill (dot + label). */
export function statusPill(parent: HTMLElement, status: SceneStatus | null): HTMLElement {
	const el = parent.createSpan({ cls: cx('ws-wr-pill', `ws-tint--${status?.color ?? 'gray'}`) });
	el.createSpan({ cls: 'ws-wr-dot' });
	el.createSpan({ text: status?.label ?? 'No scenes yet' });
	return el;
}

export function bar(parent: HTMLElement, ratio: number, cls?: string): HTMLElement {
	const b = parent.createDiv({ cls: cx('ws-wr-bar', cls), attr: { role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(Math.round(Math.max(0, Math.min(1, ratio)) * 100)) } });
	b.createDiv({ cls: 'ws-wr-bar__fill' }).style.width = `${Math.max(0, Math.min(1, ratio)) * 100}%`;
	return b;
}

/** A screen heading: eyebrow, serif title, italic line, and tools on the right. */
export function head(parent: HTMLElement, o: { eyebrow?: string; title: string; sub?: string }): HTMLElement {
	const h = parent.createDiv({ cls: 'ws-wr-head' });
	const t = h.createDiv({ cls: 'ws-wr-head__text' });
	if (o.eyebrow) caps(t, o.eyebrow, 'ws-wr-head__eyebrow');
	t.createEl('h2', { cls: 'ws-wr-head__title', text: o.title });
	if (o.sub) t.createDiv({ cls: 'ws-wr-head__sub', text: o.sub });
	return h.createDiv({ cls: 'ws-wr-head__tools' });
}

export function panel(parent: HTMLElement, title: string, cls?: string): HTMLElement {
	const box = parent.createEl('section', { cls: cx('ws-wr-panel', cls) });
	box.createDiv({ cls: 'ws-wr-panel__head' }).createEl('h3', { cls: 'ws-wr-panel__title', text: title });
	return box;
}

/** A row of the "kind" icon for parts, chapters and scenes. */
export const KIND_ICON: Record<ManuscriptItem['kind'], string> = { part: 'book-open', chapter: 'bookmark', scene: 'file-text' };

/** The ornament under paper headings. */
export function ornament(parent: HTMLElement): HTMLElement {
	return parent.createDiv({ cls: 'ws-wr-orn', attr: { 'aria-hidden': 'true' } });
}

/** A small "i" note. */
export function hint(parent: HTMLElement, text: string, iconName = 'info', cls?: string): HTMLElement {
	const h = parent.createDiv({ cls: cx('ws-wr-hint', cls) });
	icon(h, iconName);
	h.createSpan({ text });
	return h;
}
