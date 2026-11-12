import type { BannerRef, ImageRef } from '../../core/types';
import { BANNER_MAX, BANNER_MIN, BANNER_PRESETS, MAX_ZOOM, MIN_ZOOM, fileNameOf } from '../../core/util/media';
import type { WorldsmithContext } from '../../app/context';
import { applyRef, resourceUrl } from '../../fields/ui/media';
import { button, cx, icon, nameRegion } from '../components/dom';
import { WorldsmithModal } from '../components/modals';

/** Places an image is shown, previewed while adjusting. */
export type FrameKind = 'arch' | 'arch-sm' | 'circle' | 'banner' | 'card-banner' | 'square' | 'landscape' | 'portrait';

interface FrameSpec {
	label: string;
	/** width / height; banners derive it from their height. */
	aspect: number | ((ref: ImageRef & { height?: number }, bannerWidth: number) => number);
	shape?: 'arch' | 'circle';
}

const FRAMES: Record<FrameKind, FrameSpec> = {
	arch: { label: 'Entry page', aspect: 3 / 4, shape: 'arch' },
	'arch-sm': { label: 'Card', aspect: 3 / 4, shape: 'arch' },
	circle: { label: 'Links & lists', aspect: 1, shape: 'circle' },
	banner: { label: 'Banner', aspect: (r, w) => w / (r.height ?? BANNER_PRESETS.standard) },
	'card-banner': { label: 'Card', aspect: 260 / 110 },
	square: { label: 'Gallery tile', aspect: 1 },
	landscape: { label: 'Wide tile', aspect: 4 / 3 },
	portrait: { label: 'Tall tile', aspect: 3 / 4 },
};

const aspectOf = (k: FrameKind, ref: ImageRef & { height?: number }, bannerWidth = 1000) => {
	const a = FRAMES[k].aspect;
	return typeof a === 'function' ? a(ref, bannerWidth) : a;
};

/**
 * How wide the banner really is on screen: the widest visible page or world banner (the
 * dialog is opened from that page). A banner is cropped to the pane's width, so the frame
 * here must use the same shape or the preview won't match the page.
 */
function visibleBannerWidth(): number | undefined {
	let best = 0;
	for (const el of Array.from(activeDocument.querySelectorAll<HTMLElement>('.worldsmith .ws-hero__banner, .worldsmith .ws-world-hero__banner'))) {
		const w = el.getBoundingClientRect().width;
		if (el.offsetParent && w > best) best = w;
	}
	return best > 200 ? Math.round(best) : undefined;
}

export interface ImageAdjustOptions<T extends ImageRef> {
	title: string;
	ref: T;
	/** Previews, first one is outlined on the image. */
	frames: FrameKind[];
	/** Show banner height controls. */
	height?: boolean;
	/** Offer "Show whole image" (contain). Default true. */
	fit?: boolean;
	/** Called with every committed change (live). */
	onChange: (ref: T) => void;
	/** The banner's real width in px (frames a banner exactly as the page shows it). */
	bannerWidth?: number;
}

const r3 = (n: number) => Math.round(n * 1000) / 1000;

/**
 * Choose what part of an image shows in its frames: click or drag on the image to set the
 * focal point, zoom in, switch between filling the frame and showing the whole image, and
 * (for banners) set the height. Changes apply live; Cancel puts everything back.
 */
export class ImageAdjust<T extends ImageRef & { height?: number }> extends WorldsmithModal {
	private ref: T;
	private readonly initial: T;
	private img!: HTMLImageElement;
	private stage!: HTMLElement;
	private rect!: HTMLElement;
	private dot!: HTMLElement;
	private previews: Array<{ kind: FrameKind; frame: HTMLElement; img: HTMLElement | null }> = [];
	private controls!: HTMLElement;
	private readonly bannerWidth: number;

	constructor(
		ws: WorldsmithContext,
		private readonly o: ImageAdjustOptions<T>,
	) {
		super(ws.app);
		this.ref = { ...o.ref };
		this.initial = { ...o.ref };
		this.bannerWidth = o.bannerWidth ?? (o.frames.includes('banner') ? visibleBannerWidth() : undefined) ?? 1000;
		this.modalEl.addClass('ws-adjust-modal');
	}

	override onOpen(): void {
		this.setTitle(this.o.title);
		const c = this.contentEl;
		c.addClass('ws-adjust');
		const url = resourceUrl(this.app, this.ref.path);
		const main = c.createDiv({ cls: 'ws-adjust__main' });
		const left = main.createDiv({ cls: 'ws-adjust__left' });
		this.stage = left.createDiv({ cls: 'ws-adjust__stage', attr: { tabindex: '0', role: 'slider', 'aria-label': 'Focal point — click or drag on the image, or use the arrow keys' } });
		if (!url) {
			const miss = this.stage.createDiv({ cls: 'ws-adjust__missing' });
			icon(miss, 'image-off');
			miss.createSpan({ text: `This image is missing: ${this.ref.path}` });
		} else {
			const box = this.stage.createDiv({ cls: 'ws-adjust__box' });
			this.img = box.createEl('img', { cls: 'ws-adjust__img', attr: { src: url, alt: '', draggable: 'false' } });
			this.rect = box.createDiv({ cls: 'ws-adjust__rect' });
			this.dot = box.createDiv({ cls: 'ws-adjust__dot' });
			this.img.addEventListener('load', () => this.paint());
			this.wireStage(box);
		}
		left.createDiv({ cls: 'ws-adjust__file', text: fileNameOf(this.ref.path) });
		this.controls = left.createDiv({ cls: 'ws-adjust__controls' });

		const side = main.createDiv({ cls: 'ws-adjust__previews', attr: { } });
		nameRegion(side, 'Previews' );
		side.createDiv({ cls: 'ws-adjust__previews-title', text: 'Preview' });
		for (const kind of this.o.frames) {
			const wrap = side.createDiv({ cls: cx('ws-adjust__pv', `ws-adjust__pv--${kind}`) });
			const frame = wrap.createDiv({ cls: cx('ws-adjust__pv-frame', FRAMES[kind].shape && `is-${FRAMES[kind].shape}`) });
			const pimg = url ? frame.createEl('img', { attr: { src: url, alt: '', draggable: 'false' } }) : null;
			wrap.createDiv({ cls: 'ws-adjust__pv-label', text: FRAMES[kind].label });
			this.previews.push({ kind, frame, img: pimg });
		}

		const foot = c.createDiv({ cls: 'ws-modal-actions ws-adjust__foot' });
		button(foot, {
			label: 'Reset',
			icon: 'rotate-ccw',
			variant: 'ghost',
			onClick: () => {
				// Explicit values, not missing keys: callers may merge the change into what they
				// have, and a missing key would leave the old zoom or fit in place.
				const reset = { ...this.ref, focalX: 0.5, focalY: 0.5, zoom: 1, ...(this.o.fit === false ? {} : { fit: 'cover' }) } as T;
				this.set(reset, true);
			},
		});
		foot.createDiv({ cls: 'ws-adjust__spacer' });
		button(foot, { label: 'Cancel', variant: 'ghost', onClick: () => this.cancel() });
		button(foot, {
			label: 'Done',
			variant: 'primary',
			onClick: () => {
				this.close();
			},
		});
		this.renderControls();
		this.paint();
		window.setTimeout(() => this.stage.focus(), 0);
	}

	override onClose(): void {
		// Escape / click outside keeps the changes, like every other live dialog.
		this.contentEl.empty();
	}

	private cancel(): void {
		this.o.onChange({ ...this.initial });
		this.close();
	}

	/** Update local state; `commit` writes it to the record. */
	private set(next: T, commit: boolean): void {
		this.ref = next;
		this.paint();
		if (commit) {
			this.renderControls();
			this.o.onChange({ ...next });
		}
	}

	private wireStage(box: HTMLElement): void {
		let dragging = false;
		const at = (ev: PointerEvent) => {
			const r = this.img.getBoundingClientRect();
			const fx = Math.max(0, Math.min(1, (ev.clientX - r.left) / Math.max(1, r.width)));
			const fy = Math.max(0, Math.min(1, (ev.clientY - r.top) / Math.max(1, r.height)));
			this.set({ ...this.ref, focalX: r3(fx), focalY: r3(fy) }, false);
		};
		box.addEventListener('pointerdown', (ev) => {
			if (ev.button !== 0) return;
			dragging = true;
			box.setPointerCapture?.(ev.pointerId);
			box.addClass('is-dragging');
			at(ev);
		});
		box.addEventListener('pointermove', (ev) => dragging && at(ev));
		const end = () => {
			if (!dragging) return;
			dragging = false;
			box.removeClass('is-dragging');
			this.set(this.ref, true);
		};
		box.addEventListener('pointerup', end);
		box.addEventListener('pointercancel', end);
		this.stage.addEventListener('keydown', (ev) => {
			const step = ev.shiftKey ? 0.1 : 0.02;
			const fx = this.ref.focalX ?? 0.5;
			const fy = this.ref.focalY ?? 0.5;
			const z = this.ref.zoom ?? 1;
			let next: T | null = null;
			if (ev.key === 'ArrowLeft') next = { ...this.ref, focalX: r3(Math.max(0, fx - step)) };
			if (ev.key === 'ArrowRight') next = { ...this.ref, focalX: r3(Math.min(1, fx + step)) };
			if (ev.key === 'ArrowUp') next = { ...this.ref, focalY: r3(Math.max(0, fy - step)) };
			if (ev.key === 'ArrowDown') next = { ...this.ref, focalY: r3(Math.min(1, fy + step)) };
			if (ev.key === '+' || ev.key === '=') next = { ...this.ref, zoom: r3(Math.min(MAX_ZOOM, z + 0.1)) };
			if (ev.key === '-' || ev.key === '_') next = { ...this.ref, zoom: r3(Math.max(MIN_ZOOM, z - 0.1)) };
			if (!next) return;
			ev.preventDefault();
			this.set(next, true);
		});
	}

	private renderControls(): void {
		const c = this.controls;
		c.empty();
		const row = (label: string) => {
			const r = c.createDiv({ cls: 'ws-adjust__row' });
			r.createDiv({ cls: 'ws-adjust__label', text: label });
			return r.createDiv({ cls: 'ws-adjust__ctl' });
		};

		const contain = this.ref.fit === 'contain';
		if (this.o.fit !== false) {
			const seg = row('Fit').createDiv({ cls: 'ws-segmented ws-segmented--labels', attr: { role: 'radiogroup'} });
			nameRegion(seg, 'Fit' );
			for (const [id, label] of [
				['cover', 'Fill the frame'],
				['contain', 'Show whole image'],
			] as const) {
				const on = (id === 'contain') === contain;
				const b = seg.createEl('button', { cls: cx('ws-segmented__item', on && 'is-active'), text: label, attr: { type: 'button', role: 'radio', 'aria-checked': String(on) } });
				b.addEventListener('click', () => {
					// 'cover' is written out (not left unset) so a gallery that merges the change
					// switches back from "Show whole image".
					this.set({ ...this.ref, fit: id }, true);
				});
			}
		}

		if (!contain) {
			const z = row('Zoom');
			const minus = button(z, { icon: 'zoom-out', variant: 'quiet', size: 'sm', tooltip: 'Zoom out', onClick: () => this.set({ ...this.ref, zoom: r3(Math.max(MIN_ZOOM, (this.ref.zoom ?? 1) - 0.25)) }, true) });
			const slider = z.createEl('input', { cls: 'ws-range', attr: { type: 'range', min: String(MIN_ZOOM), max: String(MAX_ZOOM), step: '0.05', 'aria-label': 'Zoom' } });
			slider.value = String(this.ref.zoom ?? 1);
			const plus = button(z, { icon: 'zoom-in', variant: 'quiet', size: 'sm', tooltip: 'Zoom in', onClick: () => this.set({ ...this.ref, zoom: r3(Math.min(MAX_ZOOM, (this.ref.zoom ?? 1) + 0.25)) }, true) });
			const val = z.createSpan({ cls: 'ws-adjust__val', text: `${Math.round((this.ref.zoom ?? 1) * 100)}%` });
			slider.addEventListener('input', () => {
				this.set({ ...this.ref, zoom: r3(Number(slider.value)) }, false);
				val.setText(`${Math.round(Number(slider.value) * 100)}%`);
			});
			slider.addEventListener('change', () => this.set({ ...this.ref, zoom: r3(Number(slider.value)) }, true));
			minus.disabled = (this.ref.zoom ?? 1) <= MIN_ZOOM;
			plus.disabled = (this.ref.zoom ?? 1) >= MAX_ZOOM;
		}

		if (this.o.height) {
			const h = row('Height');
			const presets = h.createDiv({ cls: 'ws-segmented ws-segmented--labels', attr: { role: 'radiogroup'} });
			nameRegion(presets, 'Banner height' );
			const cur = this.ref.height ?? BANNER_PRESETS.standard;
			for (const [name, px] of Object.entries(BANNER_PRESETS)) {
				const on = cur === px;
				const b = presets.createEl('button', { cls: cx('ws-segmented__item', on && 'is-active'), text: name[0]!.toUpperCase() + name.slice(1), attr: { type: 'button', role: 'radio', 'aria-checked': String(on) } });
				b.addEventListener('click', () => this.set({ ...this.ref, height: px }, true));
			}
			const slider = h.createEl('input', { cls: 'ws-range', attr: { type: 'range', min: String(BANNER_MIN), max: String(BANNER_MAX), step: '10', 'aria-label': 'Banner height in pixels' } });
			slider.value = String(cur);
			const val = h.createSpan({ cls: 'ws-adjust__val', text: `${cur}px` });
			slider.addEventListener('input', () => {
				this.set({ ...this.ref, height: Number(slider.value) }, false);
				val.setText(`${slider.value}px`);
			});
			slider.addEventListener('change', () => this.set({ ...this.ref, height: Number(slider.value) }, true));
		}

		const tip = c.createDiv({ cls: 'ws-adjust__tip' });
		icon(tip, 'crosshair');
		tip.createSpan({ text: contain ? 'The whole image is shown; the focal point decides where it sits.' : 'Click or drag on the image to choose what stays in view. Arrow keys nudge it.' });
		if (this.o.frames[0] === 'banner') {
			const note = c.createDiv({ cls: 'ws-adjust__tip ws-adjust__tip--note' });
			icon(note, 'monitor');
			note.createSpan({ text: `The outline matches the banner at its current width (${this.bannerWidth.toLocaleString()} px). In a wider window it shows a thinner strip around the same point.` });
		}
	}

	/** Position the focal dot, the crop outline and every preview. */
	private paint(): void {
		const ref = this.ref;
		for (const p of this.previews) {
			p.frame.style.aspectRatio = String(aspectOf(p.kind, ref, this.bannerWidth));
			if (p.img) applyRef(p.img, ref);
		}
		if (!this.img) return;
		const fx = ref.focalX ?? 0.5;
		const fy = ref.focalY ?? 0.5;
		this.dot.style.left = `${fx * 100}%`;
		this.dot.style.top = `${fy * 100}%`;
		const iw = this.img.naturalWidth;
		const ih = this.img.naturalHeight;
		const kind = this.o.frames[0];
		if (!iw || !ih || !kind || ref.fit === 'contain') {
			this.rect.setCssStyles({ display: 'none' });
			return;
		}
		// Visible part of the image in a frame of this aspect (cover, zoomed around the
		// focal point), as fractions of the image.
		const A = aspectOf(kind, ref, this.bannerWidth);
		const z = ref.zoom && ref.zoom > 1 ? ref.zoom : 1;
		const fw = A;
		const fh = 1;
		const s = Math.max(fw / iw, fh / ih);
		const ox = (iw * s - fw) * fx;
		const oy = (ih * s - fh) * fy;
		const x0 = (fx * fw * (1 - 1 / z) + ox) / s;
		const y0 = (fy * fh * (1 - 1 / z) + oy) / s;
		const w = fw / (z * s);
		const h = fh / (z * s);
		this.rect.setCssStyles({ display: '' });
		this.rect.style.left = `${(x0 / iw) * 100}%`;
		this.rect.style.top = `${(y0 / ih) * 100}%`;
		this.rect.style.width = `${(w / iw) * 100}%`;
		this.rect.style.height = `${(h / ih) * 100}%`;
		this.rect.toggleClass('is-arch', FRAMES[kind].shape === 'arch');
		this.rect.toggleClass('is-circle', FRAMES[kind].shape === 'circle');
		this.stage.setAttr('aria-valuetext', `Focal point ${Math.round(fx * 100)}% across, ${Math.round(fy * 100)}% down`);
	}
}

/** Typed helpers so callers don't repeat frame lists. */
export const adjustPortrait = (ws: WorldsmithContext, ref: ImageRef, onChange: (r: ImageRef) => void) =>
	new ImageAdjust(ws, { title: 'Adjust portrait', ref, frames: ['arch', 'arch-sm', 'circle'], onChange }).open();

export const adjustBanner = (ws: WorldsmithContext, ref: BannerRef, onChange: (r: BannerRef) => void, title = 'Adjust banner', bannerWidth?: number) =>
	new ImageAdjust(ws, { title, ref, frames: ['banner', 'card-banner'], height: true, fit: false, onChange, bannerWidth }).open();

export const adjustImage = (ws: WorldsmithContext, ref: ImageRef, onChange: (r: ImageRef) => void, frames: FrameKind[] = ['square', 'landscape', 'portrait'], title = 'Adjust image') =>
	new ImageAdjust(ws, { title, ref, frames, onChange }).open();
