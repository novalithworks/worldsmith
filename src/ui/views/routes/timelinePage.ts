import { Menu, setIcon } from 'obsidian';
import type { WorldSession } from '../../../services/WorldSession';
import { collectTimeline, datedTypes } from '../../../services/timeline';
import { ROUTES } from '../../../state/route';
import { button, cx, emptyState, icon, nameRegion } from '../../components/dom';
import { own } from '../../components/lifecycle';
import { renderTimelineAxis, renderTimelineList, yearLabel, type AxisHandle } from '../../timeline/render';
import type { TimelineData } from '../../../services/timeline';
import type { RouteContext, RouteDefinition } from './RouteRegistry';
import { mountToolBanner } from '../../media/pageBanner';
import { datedScenes, type DatedScene } from '../../../services/writing/world';
import { chronoPosition, formatChrono } from '../../../core/calendar/engine';

/**
 * Timeline (0.10): every dated entry on one line. Lanes by type, era bands on top, a
 * chronological list on phones (or by choice). Type and tag filters are saved with the
 * world; zoom and mode are per pane.
 */
export const timelineRoute: RouteDefinition = {
	id: 'timeline',
	needsWorld: true,
	title: () => 'Timeline',
	icon: () => 'gantt-chart',
	render(ctx) {
		new TimelinePage(ctx).mount();
	},
};

class TimelinePage {
	private mode: 'axis' | 'list' | null = null;
	private ppy: number | null = null;
	private scrollLeft = 0;
	private showEl!: HTMLElement;
	private barEl!: HTMLElement;
	private bodyEl!: HTMLElement;
	private axis: AxisHandle | null = null;
	private queued = false;

	/** Set once the page is left: a late timer must not draw into the next page. */
	private dead = false;

	constructor(private readonly ctx: RouteContext) {
		own(ctx.component, { dispose: () => (this.dead = true) });
	}

	private get s(): WorldSession {
		return this.ctx.session!;
	}

	private get narrow(): boolean {
		return this.ctx.el.closest('.worldsmith')?.getAttribute('data-ws-size') === 'narrow';
	}

	mount(): void {
		const page = this.ctx.el.createDiv({ cls: 'ws-page ws-tl' });
		const head = page.createDiv({ cls: 'ws-studio-head' });
		const mark = head.createDiv({ cls: 'ws-db-header__mark ws-tint--purple' });
		icon(mark, 'gantt-chart');
		const ht = head.createDiv({ cls: 'ws-db-header__text' });
		ht.createEl('h1', { cls: 'ws-db-header__title', text: 'Timeline' });
		ht.createDiv({ cls: 'ws-db-header__desc', text: 'Every dated entry in your world, in order.' });
		const actions = head.createDiv({ cls: 'ws-db-header__actions' });
		button(actions, { label: 'Calendars', icon: 'calendar-range', variant: 'ghost', onClick: () => this.ctx.navigate(ROUTES.calendars()) });
		mountToolBanner(this.ctx, head, 'timeline');
		this.showEl = page.createDiv({ cls: 'ws-tl__show' });
		this.barEl = page.createDiv({ cls: 'ws-tl__bar' });
		this.bodyEl = page.createDiv({ cls: 'ws-tl__body' });
		this.render();
		const later = () => this.queue();
		const ev = this.s.events;
		const c = this.ctx.component;
		own(c, ev.on('entity:created', later));
		own(c, ev.on('entity:deleted', later));
		own(c, ev.on('entity:updated', ({ change }) => change.keys.some((k) => k === 'name' || k === 'trashedAt' || k === 'tags' || k === 'typeId' || k.startsWith('values')) && later()));
		for (const e of ['schema:created', 'schema:updated', 'schema:deleted', 'calendar:saved', 'calendar:deleted'] as const) own(c, ev.on(e, later));
		own(c, ev.on('world:updated', ({ keys }) => keys.some((k) => k === 'timeline' || k === 'mainCalendar') && later()));
	}

	private queue(): void {
		if (this.queued) return;
		this.queued = true;
		window.setTimeout(() => {
			this.queued = false;
			if (!this.dead && this.ctx.el.isConnected) this.render();
		}, 120);
	}

	private setFilter(patch: { types?: string[]; tags?: string[] }): void {
		this.s.updateWorld({ timeline: { ...this.s.world.timeline, ...patch } });
	}

	private render(): void {
		const scroller = this.bodyEl.querySelector('.ws-tl-axis__scroll');
		if (scroller) this.scrollLeft = scroller.scrollLeft;
		const h = this.bodyEl.offsetHeight;
		if (h) this.bodyEl.style.minHeight = `${h}px`;
		this.renderBar();
		this.renderBody();
		this.bodyEl.setCssStyles({ minHeight: '' });
	}

	private renderBar(): void {
		const bar = this.barEl;
		bar.empty();
		const cfg = this.s.world.timeline;
		const types = datedTypes(this.s);
		const all = collectTimeline(this.s);
		const counts = new Map<string, number>();
		for (const it of all.items) counts.set(it.schema.id, (counts.get(it.schema.id) ?? 0) + 1);
		for (const b of all.bands) {
			const e = b.entityId ? this.s.entities.get(b.entityId) : undefined;
			if (e) counts.set(e.typeId, (counts.get(e.typeId) ?? 0) + 1);
		}
		const chips = bar.createDiv({ cls: 'ws-tl__types', attr: { role: 'group' } });
		nameRegion(chips, 'Show types');
		const allOn = !cfg.types.length;
		const allBtn = chips.createEl('button', { cls: cx('ws-tl__type', allOn && 'is-on'), attr: { type: 'button', 'aria-pressed': String(allOn) } });
		allBtn.createSpan({ text: 'All' });
		allBtn.createSpan({ cls: 'ws-tl__type-n', text: String([...counts.values()].reduce((a, b) => a + b, 0)) });
		allBtn.addEventListener('click', () => this.setFilter({ types: [] }));
		for (const t of types) {
			const on = cfg.types.includes(t.id);
			if (!on && !counts.get(t.id)) continue;
			const b = chips.createEl('button', { cls: cx('ws-tl__type', on && 'is-on', `ws-tint--${t.color ?? 'gray'}`), attr: { type: 'button', 'aria-pressed': String(on), 'data-type': t.id } });
			const ic = b.createSpan({ cls: 'ws-tl__type-icon' });
			setIcon(ic, t.icon);
			b.createSpan({ text: t.plural });
			b.createSpan({ cls: 'ws-tl__type-n', text: String(counts.get(t.id) ?? 0) });
			b.addEventListener('click', () => this.setFilter({ types: on ? cfg.types.filter((x) => x !== t.id) : [...cfg.types, t.id] }));
		}
		const tools = bar.createDiv({ cls: 'ws-tl__tools' });
		const tags = new Set<string>();
		for (const e of this.s.entities.values()) if (!e.trashedAt) for (const t of e.tags) tags.add(t);
		if (tags.size || cfg.tags.length) {
			button(tools, {
				label: cfg.tags.length ? `Tags: ${cfg.tags.length}` : 'Tags',
				icon: 'tag',
				variant: cfg.tags.length ? 'default' : 'ghost',
				size: 'sm',
				cls: 'ws-tl__tags',
				onClick: (evt) => {
					const m = new Menu();
					for (const t of [...new Set([...tags, ...cfg.tags])].sort((a, b) => a.localeCompare(b))) {
						const on = cfg.tags.includes(t);
						m.addItem((i) => i.setTitle(t).setChecked(on).onClick(() => this.setFilter({ tags: on ? cfg.tags.filter((x) => x !== t) : [...cfg.tags, t] })));
					}
					if (cfg.tags.length) {
						m.addSeparator();
						m.addItem((i) => i.setTitle('Show every tag').setIcon('x').onClick(() => this.setFilter({ tags: [] })));
					}
					m.showAtMouseEvent(evt);
				},
			});
		}
		// WS5: scenes from the Writing Studio, in story time (when any has a date).
		if (this.storyScenes().length) {
			const on = this.ctx.ws.settings.timelineScenes;
			button(tools, {
				label: 'Scenes',
				icon: 'feather',
				variant: on ? 'default' : 'ghost',
				size: 'sm',
				cls: cx('ws-tl__scenes-toggle', on && 'is-on').join(' '),
				tooltip: on ? 'Hide Writing Studio scenes' : 'Show Writing Studio scenes in story time',
				onClick: () => void (async () => {
					this.ctx.ws.settings.timelineScenes = !on;
					await this.ctx.ws.saveSettings();
					this.render();
				})(),
			});
		}
		const mode = this.mode ?? (this.narrow ? 'list' : 'axis');
		if (mode === 'axis') {
			button(tools, { icon: 'zoom-out', variant: 'quiet', size: 'sm', tooltip: 'Zoom out', cls: 'ws-tl__zoom-out', onClick: () => this.axis?.zoom(0.66) });
			button(tools, { icon: 'zoom-in', variant: 'quiet', size: 'sm', tooltip: 'Zoom in', cls: 'ws-tl__zoom-in', onClick: () => this.axis?.zoom(1.5) });
			button(tools, {
				icon: 'maximize-2',
				variant: 'quiet',
				size: 'sm',
				tooltip: 'Fit everything',
				onClick: () => {
					this.ppy = null;
					this.axis?.fit();
				},
			});
		}
		const seg = tools.createDiv({ cls: 'ws-segmented ws-tl__mode', attr: { role: 'radiogroup' } });
		nameRegion(seg, 'View');
		for (const [id, ic, label] of [
			['axis', 'gantt-chart', 'Timeline'],
			['list', 'list', 'List'],
		] as const) {
			const on = mode === id;
			const b = seg.createEl('button', { cls: cx('ws-segmented__item', on && 'is-active'), attr: { type: 'button', role: 'radio', 'aria-checked': String(on), 'aria-label': label, 'data-mode': id } });
			icon(b, ic);
			b.addEventListener('click', () => {
				this.mode = id;
				this.render();
			});
		}
	}

	private renderBody(): void {
		const el = this.bodyEl;
		el.empty();
		this.axis = null;
		const cfg = this.s.world.timeline;
		const data = collectTimeline(this.s, { types: cfg.types, tags: cfg.tags });
		this.renderShowcase(data);
		if (!data.items.length && !data.bands.some((b) => b.entityId)) {
			const types = datedTypes(this.s);
			emptyState(el, {
				icon: 'gantt-chart',
				title: cfg.types.length || cfg.tags.length ? 'Nothing matches these filters' : 'Nothing dated yet',
				body: types.length
					? `Give ${types.slice(0, 3).map((t) => t.plural.toLowerCase()).join(', ')} a date (Start, Birth date, Founded…) and they appear here.`
					: 'Add a date field to a type in Type Studio and its entries appear here.',
				actionLabel: cfg.types.length || cfg.tags.length ? 'Show everything' : 'Set up a calendar',
				actionIcon: cfg.types.length || cfg.tags.length ? 'filter-x' : 'calendar-range',
				onAction: () => (cfg.types.length || cfg.tags.length ? this.setFilter({ types: [], tags: [] }) : this.ctx.navigate(ROUTES.calendars())),
			});
			if (this.ctx.ws.settings.timelineScenes) this.renderScenes(el);
			return;
		}
		const mode = this.mode ?? (this.narrow ? 'list' : 'axis');
		if (mode === 'list') renderTimelineList(el, data, (r, l) => this.ctx.navigate(r, l));
		else {
			// WS5: dated scenes get their own lane on the timeline itself.
			const scenes = this.ctx.ws.settings.timelineScenes
				? this.storyScenes().map((d) => {
						const pov = d.scene.pov ? this.s.entities.get(d.scene.pov) : undefined;
						return {
							id: d.scene.id,
							title: d.scene.title,
							pos: d.pos,
							when: formatChrono(d.scene.date!) + (d.scene.time ? `, ${d.scene.time}` : ''),
							meta: [d.projectName, pov && !pov.trashedAt ? `told by ${pov.name}` : ''].filter(Boolean).join(' · '),
							open: () => this.ctx.navigate(ROUTES.writing({ project: d.projectId, view: 'manuscript', item: d.scene.id })),
						};
					})
				: [];
			this.axis = renderTimelineAxis(el, data, (r, l) => this.ctx.navigate(r, l), { ppy: this.ppy ?? undefined, onScale: (p) => (this.ppy = p), wheelZoom: true, scenes });
			const sc = el.querySelector('.ws-tl-axis__scroll');
			if (sc && this.scrollLeft) sc.scrollLeft = this.scrollLeft;
		}
		if (mode === 'axis') {
			const hint = el.createDiv({ cls: 'ws-tl__note ws-tl__hint' });
			icon(hint, 'mouse-pointer-2');
			hint.createSpan({ text: 'Scroll to zoom in and out around the pointer; Shift+scroll or swipe sideways to move along.' });
		}
		// In Timeline mode scenes are a lane on the axis; in List mode they're listed here.
		if (this.ctx.ws.settings.timelineScenes && mode !== 'axis') this.renderScenes(el);
		if (data.undated) {
			const note = el.createDiv({ cls: 'ws-tl__note' });
			icon(note, 'info');
			note.createSpan({ text: `${data.undated} ${data.undated === 1 ? 'entry has' : 'entries have'} no date yet, so ${data.undated === 1 ? 'it isn’t' : 'they aren’t'} shown.` });
		}
	}

	/** Writing Studio scenes with an in-story date, across projects. */
	private storyScenes(): DatedScene[] {
		// The Writing Studio switched off: no scenes here either (0.29).
		if (!this.ctx.ws.features.isOn('writing')) return [];
		const w = this.s.writing;
		return datedScenes(
			w.projects().map((p) => ({ id: p.id, name: p.name, scenes: w.scenes(p.id) })),
			(d) => chronoPosition(d),
		);
	}

	/** WS5: "Scenes in story time", under the timeline; each opens in the Writing Studio. */
	private renderScenes(el: HTMLElement): void {
		const list = this.storyScenes();
		if (!list.length) return;
		const sec = el.createEl('section', { cls: 'ws-tl-scenes' });
		const head = sec.createDiv({ cls: 'ws-tl-scenes__head' });
		icon(head, 'feather');
		head.createEl('h2', { text: 'Scenes in story time' });
		head.createSpan({ cls: 'ws-tl-scenes__count', text: `${list.length} scene${list.length === 1 ? '' : 's'} with a date` });
		const ol = sec.createEl('ol', { cls: 'ws-tl-scenes__list' });
		let lastDay = '';
		for (const d of list) {
			const day = formatChrono(d.scene.date!);
			const li = ol.createEl('li', { cls: 'ws-tl-scenes__item' });
			li.createDiv({ cls: cx('ws-tl-scenes__when', day === lastDay && 'is-same'), text: day === lastDay ? '' : day });
			lastDay = day;
			const b = li.createEl('button', { cls: 'ws-tl-scenes__scene', attr: { type: 'button', 'data-scene': d.scene.id } });
			b.createSpan({ cls: 'ws-tl-scenes__title', text: d.scene.title });
			const pov = d.scene.pov ? this.s.entities.get(d.scene.pov) : undefined;
			b.createSpan({ cls: 'ws-tl-scenes__meta', text: [d.scene.time, d.projectName, pov && !pov.trashedAt ? `told by ${pov.name}` : ''].filter(Boolean).join(' · ') });
			b.addEventListener('click', () => this.ctx.navigate(ROUTES.writing({ project: d.projectId, view: 'manuscript', item: d.scene.id })));
		}
	}

	/** The span of time shown, in the calendar's words, and what's on it. */
	private renderShowcase(data: TimelineData): void {
		const el = this.showEl;
		el.empty();
		const eras = data.bands.length;
		const entries = data.items.length + data.bands.filter((b) => b.entityId).length;
		if (!entries) return;
		const band = el.createDiv({ cls: 'ws-cal-showcase ws-tl-show' });
		const words = band.createDiv({ cls: 'ws-cal-showcase__words' });
		words.createDiv({ cls: 'ws-cal-showcase__label', text: 'The span of your world’s history' });
		const a = yearLabel(Math.floor(data.min));
		const b = yearLabel(Math.floor(data.max));
		words.createDiv({ cls: 'ws-cal-showcase__date ws-tl-show__span', text: a === b ? `In ${a}` : `From ${a} to ${b}` });
		const sub = words.createDiv({ cls: 'ws-cal-showcase__sub' });
		sub.createSpan({ text: `${entries} ${entries === 1 ? 'entry' : 'entries'}` });
		const first = data.items[0];
		if (first) {
			sub.createSpan({ cls: 'ws-cal-showcase__dot', text: '·' });
			sub.createSpan({ text: `earliest: ${first.entity.name}` });
		}
		const stats = band.createDiv({ cls: 'ws-cal-showcase__stats ws-tl-show__stats' });
		const stat = (n: number | string, label: string, ic: string) => {
			const st = stats.createDiv({ cls: 'ws-cal-stat' });
			icon(st, ic);
			st.createDiv({ cls: 'ws-cal-stat__n', text: String(n) });
			st.createDiv({ cls: 'ws-cal-stat__label', text: label });
		};
		const years = Math.max(0, Math.round(data.max - data.min));
		const spans = data.items.filter((i) => i.end != null).length;
		const types = new Set(data.items.map((i) => i.schema.id)).size;
		stat(years, years === 1 ? 'year' : 'years', 'hourglass');
		stat(spans, spans === 1 ? 'span' : 'spans', 'move-horizontal');
		stat(types, types === 1 ? 'type' : 'types', 'layers');
		stat(eras, eras === 1 ? 'era' : 'eras', 'milestone');
	}
}
