import { setIcon } from 'obsidian';
import { formatChrono, isPlain, mainCalendar } from '../../core/calendar/engine';
import type { TimelineBand, TimelineData, TimelineItem } from '../../services/timeline';
import { eraHeading, packRows, tickStep } from '../../services/timeline';
import { ROUTES, type Route } from '../../state/route';
import { cx } from '../components/dom';

type Navigate = (route: Route, newLeaf?: boolean | 'tab') => void;

const tint = (c: string | null | undefined) => `ws-tint--${c ?? 'gray'}`;

/** Text for a year on the ruler, in the main calendar's words. */
export function yearLabel(year: number): string {
	const cal = mainCalendar();
	if (isPlain(cal)) return year < 0 ? `${Math.abs(year)} BE` : String(year);
	return formatChrono({ calendar: cal.id, year, precision: 'year' });
}

function itemDates(it: TimelineItem, short = true): string {
	const a = formatChrono(it.startDate, { short });
	return it.endDate ? `${a} – ${formatChrono(it.endDate, { short })}` : a;
}

/** How long a span lasts, in plain words ("34 years"); empty for single dates. */
export function spanLength(start: number, end: number | null): string {
	if (end == null) return '';
	const years = end - start;
	if (years < 1) return 'under a year';
	const n = Math.round(years);
	return `${n} year${n === 1 ? '' : 's'}`;
}

/** The first sentence or so of an entry's description, for hover cards and the list. */
function summaryOf(text: string | undefined, max = 150): string {
	const t = (text ?? '').replace(/\s+/g, ' ').trim();
	return t.length > max ? `${t.slice(0, max - 1).replace(/\s+\S*$/, '')}…` : t;
}

function open(nav: Navigate, it: { entity: { id: string } }, e: MouseEvent): void {
	nav(ROUTES.entity(it.entity.id), e.metaKey || e.ctrlKey ? 'tab' : false);
}

/**
 * Chronological list (phones, widgets, and the List mode): one row per entry. On the page
 * the rows sit in cards, one per year, under the main calendar's eras; in widgets
 * (`compact`) it's a plain list.
 */
export function renderTimelineList(parent: HTMLElement, data: TimelineData, nav: Navigate, o: { limit?: number; highlight?: string; compact?: boolean } = {}): void {
	const list = parent.createDiv({ cls: cx('ws-tl-list', o.compact && 'is-compact') });
	const items = o.limit ? data.items.slice(0, o.limit) : data.items;
	const row = (host: HTMLElement, it: TimelineItem) => {
		const r = host.createEl('button', { cls: cx('ws-tl-list__row', tint(it.schema.color), it.entity.id === o.highlight && 'is-current'), attr: { type: 'button', 'data-entity': it.entity.id } });
		r.createSpan({ cls: 'ws-tl-list__date', text: itemDates(it) });
		const mark = r.createSpan({ cls: cx('ws-tl-list__mark', it.end != null && 'is-span') });
		setIcon(mark, it.schema.icon);
		const tx = r.createSpan({ cls: 'ws-tl-list__text' });
		tx.createSpan({ cls: 'ws-tl-list__name', text: it.entity.name });
		const len = spanLength(it.start, it.end);
		tx.createSpan({ cls: 'ws-tl-list__kind', text: [`${it.schema.singular} · ${it.field.label}`, len].filter(Boolean).join(' · ') });
		if (!o.compact) {
			const sum = summaryOf(it.entity.description, 160);
			if (sum) tx.createSpan({ cls: 'ws-tl-list__sum', text: sum });
		}
		r.addEventListener('click', (e) => open(nav, it, e));
	};
	if (o.compact) {
		for (const it of items) row(list, it);
	} else {
		let heading: string | null | undefined;
		let year: string | null = null;
		let rows: HTMLElement | null = null;
		let count: HTMLElement | null = null;
		let n = 0;
		for (const it of items) {
			const h = eraHeading(it.start);
			if (h !== heading && h) {
				const era = list.createDiv({ cls: 'ws-tl-list__era' });
				const ic = era.createSpan({ cls: 'ws-tl-list__era-mark' });
				setIcon(ic, 'milestone');
				era.createSpan({ cls: 'ws-tl-list__era-name', text: h });
				year = null;
			}
			heading = h;
			const y = yearLabel(Math.floor(it.start));
			if (y !== year || !rows) {
				year = y;
				n = 0;
				const card = list.createDiv({ cls: 'ws-tl-list__group' });
				const when = card.createDiv({ cls: 'ws-tl-list__when' });
				when.createDiv({ cls: 'ws-tl-list__year', text: y });
				count = when.createDiv({ cls: 'ws-tl-list__count' });
				rows = card.createDiv({ cls: 'ws-tl-list__rows' });
			}
			row(rows, it);
			n++;
			count?.setText(`${n} ${n === 1 ? 'entry' : 'entries'}`);
		}
	}
	if (o.limit && data.items.length > o.limit) list.createDiv({ cls: 'ws-tl-list__more', text: `and ${data.items.length - o.limit} more` });
}

export interface AxisHandle {
	zoom(factor: number): void;
	fit(): void;
	/** Pixels per year now. */
	scale(): number;
}

/** Widths of names in the lane font, so rows pack by what's really drawn. */
function measurer(el: HTMLElement): (text: string) => number {
	const ctx = createEl('canvas').getContext('2d');
	const cs = getComputedStyle(el);
	if (ctx) ctx.font = `500 12px ${cs.fontFamily || 'sans-serif'}`;
	return (text) => (ctx ? Math.ceil(ctx.measureText(text).width) : text.length * 6.6);
}

/**
 * The horizontal timeline: a ruler, era bands, and one lane per type with points (one
 * date) and bars (start to end). Lanes pack items into rows so labels never overlap.
 * Hovering (or focusing) an entry shows a card with its name, dates and summary. With
 * `wheelZoom` the mouse wheel zooms around the pointer (the Timeline page); otherwise
 * only Ctrl/Cmd+wheel does, so a widget's page still scrolls.
 */
/** A Writing Studio scene with an in-story date, drawn in its own lane (WS5). */
export interface AxisScene {
	id: string;
	title: string;
	pos: number;
	when: string;
	meta: string;
	open: () => void;
}

export function renderTimelineAxis(parent: HTMLElement, data: TimelineData, nav: Navigate, o: { ppy?: number; onScale?: (ppy: number) => void; wheelZoom?: boolean; scenes?: AxisScene[] } = {}): AxisHandle {
	const wrap = parent.createDiv({ cls: cx('ws-tl-axis', o.wheelZoom && 'is-wheel-zoom') });
	const scroller = wrap.createDiv({ cls: 'ws-tl-axis__scroll' });
	const canvas = scroller.createDiv({ cls: 'ws-tl-axis__canvas' });
	const card = wrap.createDiv({ cls: 'ws-tl-axis__card', attr: { 'aria-hidden': 'true' } });
	const scenes = o.scenes ?? [];
	// Scenes widen the span shown, so none falls off the edge.
	const lo = Math.min(data.min, ...scenes.map((x) => x.pos));
	const hi = Math.max(data.max, ...scenes.map((x) => x.pos));
	const span = Math.max(1, hi - lo);
	const pad = Math.max(0.5, span * 0.04);
	const from = lo - pad;
	const to = hi + pad;
	const LABEL_W = 172;
	/** Room after the last year for the last label. */
	const TAIL = 190;
	const ROW = 32;
	const fitScale = () => Math.max(0.0005, (Math.max(320, scroller.clientWidth || 900) - LABEL_W - TAIL) / (to - from));
	let ppy = o.ppy ?? fitScale();
	const textW = measurer(canvas);

	const x = (year: number) => LABEL_W + (year - from) * ppy;

	// ── hover card ──────────────────────────────────────────────────────────
	const hideCard = () => card.removeClass('is-shown');
	const showCard = (target: HTMLElement, c: { name: string; kind: string; icon?: string; color: string | null | undefined; when: string; length?: string; summary?: string }) => {
		card.empty();
		card.className = cx('ws-tl-axis__card', tint(c.color), 'is-shown').join(' ');
		const top = card.createDiv({ cls: 'ws-tl-axis__card-top' });
		const mark = top.createSpan({ cls: 'ws-tl-axis__card-mark' });
		setIcon(mark, c.icon ?? 'milestone');
		top.createSpan({ cls: 'ws-tl-axis__card-kind', text: c.kind });
		card.createDiv({ cls: 'ws-tl-axis__card-name', text: c.name });
		const when = card.createDiv({ cls: 'ws-tl-axis__card-when', text: c.when });
		if (c.length) when.createSpan({ cls: 'ws-tl-axis__card-len', text: c.length });
		if (c.summary) card.createDiv({ cls: 'ws-tl-axis__card-sum', text: c.summary });
		const wr = wrap.getBoundingClientRect();
		const tr = target.getBoundingClientRect();
		const w = card.offsetWidth;
		const h = card.offsetHeight;
		const left = Math.max(8, Math.min(tr.left - wr.left, wr.width - w - 8));
		const below = tr.bottom - wr.top + 8;
		// Above when there's no room below inside the page, else below.
		const room = (wrap.ownerDocument.defaultView?.innerHeight ?? 1e4) - tr.bottom;
		card.style.left = `${left}px`;
		card.style.top = `${room < h + 16 && tr.top - wr.top > h + 8 ? tr.top - wr.top - h - 8 : below}px`;
	};
	const hover = (el: HTMLElement, c: Parameters<typeof showCard>[1]) => {
		el.addEventListener('pointerenter', (e) => e.pointerType !== 'touch' && showCard(el, c));
		el.addEventListener('pointerleave', hideCard);
		el.addEventListener('focus', () => showCard(el, c));
		el.addEventListener('blur', hideCard);
	};
	const itemCard = (it: TimelineItem) => ({
		name: it.entity.name,
		kind: `${it.schema.singular} · ${it.field.label}`,
		icon: it.schema.icon,
		color: it.schema.color,
		when: itemDates(it, false),
		length: spanLength(it.start, it.end),
		summary: summaryOf(it.entity.description),
	});
	scroller.addEventListener('scroll', hideCard, { passive: true });

	const draw = () => {
		hideCard();
		canvas.empty();
		const width = LABEL_W + (to - from) * ppy + TAIL;
		canvas.style.width = `${Math.ceil(width)}px`;

		// Ruler: labelled years, with smaller marks between them.
		const ruler = canvas.createDiv({ cls: 'ws-tl-axis__ruler' });
		const corner = ruler.createDiv({ cls: 'ws-tl-axis__corner' });
		corner.createSpan({ cls: 'ws-tl-axis__corner-text', text: 'Years' });
		const step = tickStep(ppy);
		const minor = step % 5 === 0 ? step / 5 : step / 2;
		const first = Math.ceil(from / step) * step;
		const grid = canvas.createDiv({ cls: 'ws-tl-axis__grid' });
		if (minor >= 1 && minor * ppy >= 12) {
			for (let y = Math.ceil(from / minor) * minor; y <= to; y += minor) if (y % step !== 0) ruler.createDiv({ cls: 'ws-tl-axis__minor', attr: { style: `left:${x(y)}px` } });
		}
		for (let y = first; y <= to; y += step) {
			const t = ruler.createDiv({ cls: 'ws-tl-axis__tick', attr: { style: `left:${x(y)}px` } });
			t.createSpan({ text: yearLabel(y) });
			grid.createDiv({ cls: 'ws-tl-axis__gridline', attr: { style: `left:${x(y)}px` } });
		}

		// Era bands: a ribbon row each, and a faint wash behind the lanes.
		const bands = [...data.bands].sort((a, b) => a.start - b.start);
		const washes = canvas.createDiv({ cls: 'ws-tl-axis__washes' });
		if (bands.length) {
			const packed = packRows(bands, (b) => x(b.start), (b) => Math.max(x(b.end), x(b.start) + 4), 1);
			const rows = Math.max(...packed.map((p) => p.row)) + 1;
			const band = canvas.createDiv({ cls: 'ws-tl-axis__bands', attr: { style: `height:${rows * 28 + 10}px` } });
			const label = band.createDiv({ cls: 'ws-tl-axis__lane-label' });
			const ic = label.createSpan({ cls: 'ws-tl-axis__lane-icon ws-tl-axis__lane-icon--eras' });
			setIcon(ic, 'milestone');
			label.createSpan({ cls: 'ws-tl-axis__lane-name', text: 'Eras' });
			for (const { item: b, row } of packed) bandEl(band, b, row);
			for (const b of bands.filter((x) => x.entityId)) washes.createDiv({ cls: cx('ws-tl-axis__wash', tint(b.color)), attr: { style: `left:${x(b.start)}px;width:${Math.max(2, x(b.end) - x(b.start))}px` } });
		}

		// Lanes by type.
		const byType = new Map<string, TimelineItem[]>();
		for (const it of data.items) {
			const list = byType.get(it.schema.id);
			if (list) list.push(it);
			else byType.set(it.schema.id, [it]);
		}
		for (const [, items] of byType) {
			const schema = items[0]!.schema;
			const nameW = (it: TimelineItem) => textW(it.entity.name) + 16;
			// A point: dot (12) + gap (6) + label; a bar: its length, or itself and the label after it.
			const est = (it: TimelineItem) => {
				const bar = it.end != null && x(it.end) - x(it.start) >= 6;
				if (!bar) return x(it.start) - 6 + 18 + nameW(it);
				const w = x(it.end!) - x(it.start);
				return w < nameW(it) + 4 ? x(it.end!) + 6 + nameW(it) : x(it.end!);
			};
			const packed = packRows(items, (it) => x(it.start) - 6, est, 10);
			const rows = Math.max(...packed.map((p) => p.row)) + 1;
			const lane = canvas.createDiv({ cls: cx('ws-tl-axis__lane', tint(schema.color)), attr: { style: `height:${rows * ROW + 16}px`, 'data-type': schema.id } });
			const label = lane.createDiv({ cls: 'ws-tl-axis__lane-label' });
			const ic = label.createSpan({ cls: 'ws-tl-axis__lane-icon' });
			setIcon(ic, schema.icon);
			label.createSpan({ cls: 'ws-tl-axis__lane-name', text: schema.plural });
			label.createSpan({ cls: 'ws-tl-axis__lane-n', text: String(items.length) });
			for (const { item: it, row } of packed) {
				const top = 10 + row * ROW;
				if (it.end != null && x(it.end) - x(it.start) >= 6) {
					const w = x(it.end) - x(it.start);
					const bar = lane.createEl('button', { cls: cx('ws-tl-axis__span', w < nameW(it) + 4 && 'is-short'), attr: { type: 'button', 'data-entity': it.entity.id, style: `left:${x(it.start)}px;top:${top}px;width:${w}px` } });
					bar.createSpan({ cls: 'ws-tl-axis__span-label', text: it.entity.name });
					bar.addEventListener('click', (e) => open(nav, it, e));
					hover(bar, itemCard(it));
				} else {
					const pt = lane.createEl('button', { cls: 'ws-tl-axis__pt', attr: { type: 'button', 'data-entity': it.entity.id, style: `left:${x(it.start) - 6}px;top:${top}px` } });
					pt.createSpan({ cls: 'ws-tl-axis__dot' });
					pt.createSpan({ cls: 'ws-tl-axis__pt-label', text: it.entity.name });
					pt.addEventListener('click', (e) => open(nav, it, e));
					hover(pt, itemCard(it));
				}
			}
		}
		// WS5: the story's scenes, in a lane of their own.
		if (scenes.length) {
			const nameW = (sc: AxisScene) => textW(sc.title) + 16;
			const packed = packRows(scenes, (sc) => x(sc.pos) - 6, (sc) => x(sc.pos) - 6 + 18 + nameW(sc), 10);
			const rows = Math.max(...packed.map((p) => p.row)) + 1;
			const lane = canvas.createDiv({ cls: 'ws-tl-axis__lane ws-tl-axis__lane--scenes ws-tint--purple', attr: { style: `height:${rows * ROW + 16}px`, 'data-type': 'scenes' } });
			const label = lane.createDiv({ cls: 'ws-tl-axis__lane-label' });
			setIcon(label.createSpan({ cls: 'ws-tl-axis__lane-icon' }), 'feather');
			label.createSpan({ cls: 'ws-tl-axis__lane-name', text: 'Scenes' });
			label.createSpan({ cls: 'ws-tl-axis__lane-n', text: String(scenes.length) });
			for (const { item: sc, row } of packed) {
				const pt = lane.createEl('button', { cls: 'ws-tl-axis__pt ws-tl-axis__pt--scene', attr: { type: 'button', 'data-scene': sc.id, style: `left:${x(sc.pos) - 6}px;top:${10 + row * ROW}px` } });
				pt.createSpan({ cls: 'ws-tl-axis__dot' });
				pt.createSpan({ cls: 'ws-tl-axis__pt-label', text: sc.title });
				pt.addEventListener('click', () => sc.open());
				hover(pt, { name: sc.title, kind: 'Scene', icon: 'feather', color: 'purple', when: sc.when, summary: sc.meta });
			}
		}
		const h = canvas.scrollHeight;
		washes.style.height = `${h}px`;
		grid.style.height = `${h}px`;
	};

	const bandEl = (host: HTMLElement, b: TimelineBand, row: number) => {
		const w = Math.max(4, x(b.end) - x(b.start));
		const el = host.createEl(b.entityId ? 'button' : 'div', {
			cls: cx('ws-tl-axis__band', tint(b.color), !!b.entityId && 'is-entry'),
			attr: { style: `left:${x(b.start)}px;top:${5 + row * 28}px;width:${w}px` },
		});
		if (b.entityId) {
			el.setAttr('type', 'button');
			el.addEventListener('click', (e) => nav(ROUTES.entity(b.entityId!), (e as MouseEvent).metaKey || (e as MouseEvent).ctrlKey ? 'tab' : false));
		}
		el.createSpan({ cls: 'ws-tl-axis__band-label', text: b.name });
		hover(el, {
			name: b.name,
			kind: b.entityId ? 'Era' : 'Era of the calendar',
			color: b.color,
			when: `${yearLabel(Math.floor(b.start))} – ${yearLabel(Math.floor(b.end))}`,
			length: spanLength(b.start, b.end),
			summary: summaryOf(b.description),
		});
	};

	const setScale = (next: number, anchorPx?: number) => {
		const box = scroller.clientWidth;
		const at = anchorPx ?? box / 2;
		const year = from + (scroller.scrollLeft + at - LABEL_W) / ppy;
		const was = ppy;
		ppy = Math.min(2000, Math.max(fitScale() * 0.5, next));
		if (ppy === was) return;
		draw();
		scroller.scrollLeft = LABEL_W + (year - from) * ppy - at;
		o.onScale?.(ppy);
	};
	// Wheel steps add up between frames, so a fast spin is one redraw a frame.
	let pending = 1;
	let anchor = 0;
	let frame = 0;
	scroller.addEventListener(
		'wheel',
		(e) => {
			const pinch = e.ctrlKey || e.metaKey;
			// Sideways scrolling (a trackpad swipe, Shift+wheel) still moves along the line.
			if (!pinch && (!o.wheelZoom || e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY))) return;
			// At the zoom limit the wheel scrolls the page again, so a tall timeline never traps it.
			const zoomIn = e.deltaY < 0;
			if (!pinch && ((zoomIn && ppy >= 2000) || (!zoomIn && ppy <= fitScale() * 0.5 + 1e-9))) return;
			e.preventDefault();
			const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
			pending *= Math.exp(-Math.max(-120, Math.min(120, dy)) * (pinch ? 0.01 : 0.0025));
			anchor = e.clientX - scroller.getBoundingClientRect().left;
			if (frame) return;
			frame = window.requestAnimationFrame(() => {
				frame = 0;
				const f = pending;
				pending = 1;
				if (scroller.isConnected) setScale(ppy * f, anchor);
			});
		},
		{ passive: false },
	);
	draw();
	if (o.ppy == null) window.requestAnimationFrame(() => {
		if (!scroller.isConnected) return;
		ppy = fitScale();
		draw();
	});
	return {
		zoom: (f) => setScale(ppy * f),
		fit: () => {
			ppy = fitScale();
			draw();
			scroller.scrollLeft = 0;
			o.onScale?.(ppy);
		},
		scale: () => ppy,
	};
}
