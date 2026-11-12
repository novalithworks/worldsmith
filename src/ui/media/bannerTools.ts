import { Menu } from 'obsidian';
import type { WorldsmithContext } from '../../app/context';
import type { BannerRef } from '../../core/types';
import { BANNER_PRESETS, fileNameOf } from '../../core/util/media';
import { button, icon } from '../components/dom';
import { adjustBanner } from './ImageAdjust';
import { Lightbox } from './Lightbox';

/**
 * The Banner button's menu and the drag-to-reposition tool, shared by every banner (0.12.2):
 * entries, Home's world banner, and pages (Tasks, dashboards, type databases, the tools).
 */
export interface BannerMenuOptions {
	ws: WorldsmithContext;
	/** The banner now, or null when there isn't one. */
	current: () => BannerRef | null;
	pick: () => void;
	save: (ref: BannerRef) => void;
	remove: () => void;
	/** The banner's frame, for Reposition and the width the adjust dialog previews at. */
	frame?: () => HTMLElement | null;
	/** "the Tasks page", "Characters": used in titles. */
	label: string;
	/** The page, so a reposition under way ends when it goes away. */
	owner?: { register(fn: () => void): void };
	/** Entry banners do their own reposition (they re-render on save); the default works on `frame`. */
	reposition?: () => void;
	/** The height a banner without one is drawn at, so the right preset is ticked. */
	defaultHeight?: number;
}

export function showBannerMenu(evt: MouseEvent, o: BannerMenuOptions): void {
	const b = o.current();
	const m = new Menu();
	m.addItem((i) => i.setTitle(b ? 'Change banner…' : 'Add banner…').setIcon('image-plus').onClick(o.pick));
	if (b) {
		const frame = o.frame?.();
		// Only with an image to drag (not the missing-image placeholder).
		const reposition = o.reposition ?? (frame?.querySelector('img') ? () => repositionBanner(frame, b, (p) => o.save({ ...b, ...p }), o.owner) : null);
		if (reposition) m.addItem((i) => i.setTitle('Reposition').setIcon('move').onClick(reposition));
		m.addItem((i) => i.setTitle('Adjust height & framing…').setIcon('crop').onClick(() => adjustBanner(o.ws, b, o.save, `Adjust the banner of ${o.label}`, frame?.clientWidth || undefined)));
		m.addSeparator();
		for (const [label, h] of Object.entries(BANNER_PRESETS)) {
			m.addItem((i) =>
				i
					.setTitle(`${label[0]?.toUpperCase()}${label.slice(1)} height`)
					.setChecked((b.height ?? o.defaultHeight ?? BANNER_PRESETS.standard) === h)
					.onClick(() => o.save({ ...b, height: h })),
			);
		}
		m.addSeparator();
		m.addItem((i) => i.setTitle('View full size').setIcon('maximize-2').onClick(() => new Lightbox(o.ws, { items: () => [b], index: 0, title: `Banner of ${o.label} — ${fileNameOf(b.path)}` }).open()));
		m.addItem((i) => i.setTitle('Remove banner').setIcon('x').onClick(o.remove));
	}
	m.showAtMouseEvent(evt);
}

/**
 * Drag the image to choose what shows; Done or Enter keeps it, Escape puts it back. Arrow
 * keys nudge (Shift for bigger steps).
 */
/** The reposition under way, if any (one at a time), and the pages already told to end it. */
let active: (() => void) | null = null;
let activeOwner: object | null = null;
const registered = new WeakSet<object>();

export function repositionBanner(frame: HTMLElement, start: BannerRef, onSave: (p: { focalX: number; focalY: number }) => void, owner?: { register(fn: () => void): void }): void {
	const img = frame.querySelector('img');
	if (!img || frame.hasClass('is-repositioning')) return;
	active?.();
	const win = frame.ownerDocument.defaultView ?? window;
	frame.addClass('is-repositioning', 'ws-banner-frame');
	const hint = frame.createDiv({ cls: 'ws-hero__reposition' });
	icon(hint, 'move');
	hint.createSpan({ text: 'Drag the image to reposition' });
	const done = button(hint, { label: 'Done', variant: 'primary', size: 'sm' });
	const oldPos = img.style.objectPosition;
	const oldOrigin = img.style.transformOrigin;
	let fx = start.focalX ?? 0.5;
	let fy = start.focalY ?? 0.5;
	const z = start.zoom ?? 1;
	let sx = 0;
	let sy = 0;
	let sfx = fx;
	let sfy = fy;
	// How far (px) the image can travel inside the frame on each axis.
	const travel = () => {
		const fw = frame.clientWidth;
		const fh = frame.clientHeight;
		const iw = img.naturalWidth || fw;
		const ih = img.naturalHeight || fh;
		const sc = Math.max(fw / iw, fh / ih) * z;
		return { x: Math.max(1, iw * sc - fw), y: Math.max(1, ih * sc - fh) };
	};
	const apply = () => {
		img.style.objectPosition = `${fx * 100}% ${fy * 100}%`;
		img.style.transformOrigin = `${fx * 100}% ${fy * 100}%`;
	};
	const onMove = (ev: PointerEvent) => {
		const t = travel();
		fx = Math.max(0, Math.min(1, sfx - (ev.clientX - sx) / t.x));
		fy = Math.max(0, Math.min(1, sfy - (ev.clientY - sy) / t.y));
		apply();
	};
	const onUp = () => {
		win.removeEventListener('pointermove', onMove);
		win.removeEventListener('pointerup', onUp);
		frame.removeClass('is-grabbing');
	};
	const onDown = (ev: PointerEvent) => {
		if ((ev.target as HTMLElement).closest('button')) return;
		ev.preventDefault();
		sx = ev.clientX;
		sy = ev.clientY;
		sfx = fx;
		sfy = fy;
		frame.addClass('is-grabbing');
		win.addEventListener('pointermove', onMove);
		win.addEventListener('pointerup', onUp);
	};
	const finish = (save: boolean) => {
		if (active === cancel) active = activeOwner = null;
		frame.removeEventListener('pointerdown', onDown);
		win.removeEventListener('keydown', onKey, true);
		onUp();
		frame.removeClass('is-repositioning');
		hint.remove();
		if (save) onSave({ focalX: Math.round(fx * 1000) / 1000, focalY: Math.round(fy * 1000) / 1000 });
		else {
			img.style.objectPosition = oldPos;
			img.style.transformOrigin = oldOrigin;
		}
	};
	const onKey = (ev: KeyboardEvent) => {
		if (!frame.isConnected) return finish(false);
		// Typing somewhere else (a search box, a note) isn't for the banner.
		const t = ev.target as HTMLElement | null;
		if (t?.closest?.('input, textarea, select, [contenteditable="true"]') && !frame.contains(t)) return;
		if (ev.key === 'Enter') {
			ev.preventDefault();
			ev.stopPropagation();
			finish(true);
		} else if (ev.key === 'Escape') {
			ev.stopPropagation();
			finish(false);
		} else if (ev.key.startsWith('Arrow')) {
			const st = ev.shiftKey ? 0.1 : 0.02;
			if (ev.key === 'ArrowLeft') fx = Math.max(0, fx - st);
			if (ev.key === 'ArrowRight') fx = Math.min(1, fx + st);
			if (ev.key === 'ArrowUp') fy = Math.max(0, fy - st);
			if (ev.key === 'ArrowDown') fy = Math.min(1, fy + st);
			ev.preventDefault();
			apply();
		}
	};
	const cancel = () => finish(false);
	frame.addEventListener('pointerdown', onDown);
	win.addEventListener('keydown', onKey, true);
	done.addEventListener('click', () => finish(true));
	active = cancel;
	activeOwner = owner ?? null;
	// One clean-up per page, whatever the number of repositions: end the one under way.
	if (owner && !registered.has(owner)) {
		registered.add(owner);
		owner.register(() => activeOwner === owner && active?.());
	}
}
