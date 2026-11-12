/**
 * Pan and zoom for a canvas (trees, the relationship graph, maps): drag the background
 * to move, the scroll wheel (or a pinch) zooms, Shift + scroll moves, two fingers on a
 * phone. In a widget (`scrollPage`) the wheel scrolls the page and Ctrl/⌘ + scroll zooms.
 * The stage gets `transform: translate() scale()`, and `--ws-k` holds the zoom so pins
 * and labels can keep their size.
 */
export interface PanZoom {
	readonly k: number;
	readonly x: number;
	readonly y: number;
	set(k: number, x: number, y: number): void;
	/** Zoom by a factor around a point of the viewport (default: its centre). */
	zoomBy(f: number, at?: { x: number; y: number }): void;
	/** Show the box [x0, y0, x1, y1] (stage coordinates) with some room around it. */
	fit(box: [number, number, number, number], o?: { pad?: number; max?: number; animate?: boolean }): void;
	/** Centre on a stage point. */
	centre(x: number, y: number, k?: number): void;
	/** Viewport pixels → stage coordinates. */
	toStage(clientX: number, clientY: number): { x: number; y: number };
	destroy(): void;
}

export interface PanZoomOptions {
	min?: number;
	max?: number;
	onChange?: (pz: PanZoom) => void;
	/** Pointer-downs that start on these don't pan (cards, pins, handles). */
	ignore?: string;
	/** Called on a click on the background that didn't move. */
	onBackgroundClick?: (e: PointerEvent) => void;
	/** In a widget: plain scrolling scrolls the page; only Ctrl/⌘ + scroll zooms. */
	scrollPage?: boolean;
}

export function panZoom(viewport: HTMLElement, stage: HTMLElement, o: PanZoomOptions = {}): PanZoom {
	const min = o.min ?? 0.1;
	const max = o.max ?? 4;
	let k = 1;
	let x = 0;
	let y = 0;
	const apply = () => {
		stage.style.transform = `translate(${x}px, ${y}px) scale(${k})`;
		viewport.style.setProperty('--ws-k', String(k));
		viewport.style.setProperty('--ws-ik', String(1 / k));
		o.onChange?.(api);
	};
	const clamp = (v: number) => Math.min(max, Math.max(min, v));
	const rect = () => viewport.getBoundingClientRect();

	const pointers = new Map<number, { x: number; y: number }>();
	let drag: { x: number; y: number; ox: number; oy: number; moved: boolean } | null = null;
	let pinch: { d: number; k: number; cx: number; cy: number; ox: number; oy: number } | null = null;

	const down = (e: PointerEvent) => {
		if (e.button !== 0 && e.pointerType === 'mouse') return;
		// Inside a page (widgets), a finger scrolls the page; taps still reach the content.
		if (o.scrollPage && e.pointerType === 'touch') return;
		const t = e.target as HTMLElement;
		if (o.ignore && t.closest(o.ignore)) return;
		pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
		try {
			viewport.setPointerCapture(e.pointerId);
		} catch {
			/* not supported */
		}
		if (pointers.size === 1) drag = { x: e.clientX, y: e.clientY, ox: x, oy: y, moved: false };
		else if (pointers.size === 2) {
			const [a, b] = [...pointers.values()] as [{ x: number; y: number }, { x: number; y: number }];
			const r = rect();
			pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, k, cx: (a.x + b.x) / 2 - r.left, cy: (a.y + b.y) / 2 - r.top, ox: x, oy: y };
			drag = null;
		}
		viewport.addClass('is-panning');
	};
	const move = (e: PointerEvent) => {
		if (!pointers.has(e.pointerId)) return;
		pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
		if (pinch && pointers.size >= 2) {
			const [a, b] = [...pointers.values()] as [{ x: number; y: number }, { x: number; y: number }];
			const nk = clamp((pinch.k * Math.hypot(a.x - b.x, a.y - b.y)) / pinch.d);
			const sx = (pinch.cx - pinch.ox) / pinch.k;
			const sy = (pinch.cy - pinch.oy) / pinch.k;
			k = nk;
			x = pinch.cx - sx * k;
			y = pinch.cy - sy * k;
			apply();
		} else if (drag) {
			const dx = e.clientX - drag.x;
			const dy = e.clientY - drag.y;
			if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
			x = drag.ox + dx;
			y = drag.oy + dy;
			apply();
		}
	};
	const up = (e: PointerEvent) => {
		if (!pointers.has(e.pointerId)) return;
		pointers.delete(e.pointerId);
		if (pointers.size < 2) pinch = null;
		if (!pointers.size) {
			if (drag && !drag.moved) o.onBackgroundClick?.(e);
			drag = null;
			viewport.removeClass('is-panning');
		}
	};
	const wheel = (e: WheelEvent) => {
		if (o.scrollPage && !(e.ctrlKey || e.metaKey)) return;
		e.preventDefault();
		const r = rect();
		const mod = e.ctrlKey || e.metaKey;
		// Only a trackpad moves sideways; a mouse wheel (even a smooth one, at any zoom) never does.
		const swipe = !mod && e.deltaMode === 0 && e.deltaX !== 0;
		if (swipe && !e.shiftKey) {
			x -= e.deltaX;
			y -= e.deltaY;
			apply();
			return;
		}
		if (e.shiftKey && !mod) {
			// Shift + scroll moves (browsers turn a vertical Shift-scroll into a sideways one).
			x -= (e.deltaX || 0) * (e.deltaMode === 1 ? 16 : 1);
			y -= (e.deltaX ? 0 : e.deltaY) * (e.deltaMode === 1 ? 16 : 1);
			apply();
			return;
		}
		// A pinch on a trackpad arrives as Ctrl + scroll in small steps: zoom a little faster.
		const dy = Math.max(-120, Math.min(120, e.deltaY));
		const rate = e.deltaMode === 1 ? 0.05 : e.ctrlKey && Math.abs(dy) < 30 ? 0.01 : 0.0025;
		api.zoomBy(Math.exp(-dy * rate), { x: e.clientX - r.left, y: e.clientY - r.top });
	};
	viewport.addEventListener('pointerdown', down);
	viewport.addEventListener('pointermove', move);
	viewport.addEventListener('pointerup', up);
	viewport.addEventListener('pointercancel', up);
	viewport.addEventListener('wheel', wheel, { passive: false });

	let anim = 0;
	const api: PanZoom = {
		get k() {
			return k;
		},
		get x() {
			return x;
		},
		get y() {
			return y;
		},
		set(nk, nx, ny) {
			k = clamp(nk);
			x = nx;
			y = ny;
			apply();
		},
		zoomBy(f, at) {
			const r = rect();
			const px = at?.x ?? r.width / 2;
			const py = at?.y ?? r.height / 2;
			const nk = clamp(k * f);
			const sx = (px - x) / k;
			const sy = (py - y) / k;
			k = nk;
			x = px - sx * k;
			y = py - sy * k;
			apply();
		},
		fit(box, fo = {}) {
			const r = rect();
			const w = Math.max(1, r.width || viewport.clientWidth || 800);
			const h = Math.max(1, r.height || viewport.clientHeight || 500);
			const pad = fo.pad ?? 40;
			const bw = Math.max(1, box[2] - box[0]);
			const bh = Math.max(1, box[3] - box[1]);
			const nk = clamp(Math.min((w - pad * 2) / bw, (h - pad * 2) / bh, fo.max ?? 1.2));
			const nx = w / 2 - ((box[0] + box[2]) / 2) * nk;
			const ny = h / 2 - ((box[1] + box[3]) / 2) * nk;
			if (!fo.animate) return api.set(nk, nx, ny);
			const [k0, x0, y0] = [k, x, y];
			const t0 = performance.now();
			window.cancelAnimationFrame(anim);
			const step = (t: number) => {
				const p = Math.min(1, (t - t0) / 260);
				const e = 1 - Math.pow(1 - p, 3);
				api.set(k0 + (nk - k0) * e, x0 + (nx - x0) * e, y0 + (ny - y0) * e);
				if (p < 1) anim = window.requestAnimationFrame(step);
			};
			anim = window.requestAnimationFrame(step);
		},
		centre(cx, cy, nk) {
			const r = rect();
			const kk = clamp(nk ?? k);
			api.set(kk, (r.width || 800) / 2 - cx * kk, (r.height || 500) / 2 - cy * kk);
		},
		toStage(clientX, clientY) {
			const r = rect();
			return { x: (clientX - r.left - x) / k, y: (clientY - r.top - y) / k };
		},
		destroy() {
			window.cancelAnimationFrame(anim);
			viewport.removeEventListener('pointerdown', down);
			viewport.removeEventListener('pointermove', move);
			viewport.removeEventListener('pointerup', up);
			viewport.removeEventListener('pointercancel', up);
			viewport.removeEventListener('wheel', wheel);
		},
	};
	stage.setCssStyles({ transformOrigin: '0 0' });
	apply();
	return api;
}
