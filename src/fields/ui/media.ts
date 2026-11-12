import { FuzzySuggestModal, TFile, type App } from 'obsidian';
import type { GalleryItem, ImageRef } from '../../core/types';
import { uuid } from '../../core/util/ids';
import { refStyle } from '../../core/util/media';
import { button, icon } from '../../ui/components/dom';
import { renderGallery } from '../../ui/media/gallery';
import { imageDropTarget } from '../../ui/media/drop';
import { ImageBrowser } from '../../ui/media/ImageBrowser';
import { adjustImage } from '../../ui/media/ImageAdjust';
import type { FieldTypeUI } from '../FieldType';
import { textDisplay } from './shared';

const isRef = (v: unknown): v is ImageRef => typeof v === 'object' && v !== null && typeof (v as ImageRef).path === 'string';

export function resourceUrl(app: App, path: string): string | null {
	const f = app.vault.getFileByPath(path);
	return f ? app.vault.getResourcePath(f) : null;
}

/**
 * <img> for a vault image, framed by its focal point, zoom and fit — or a tasteful
 * "missing file" state if it was moved or deleted. The parent must clip (overflow hidden)
 * for zoom to stay inside the frame.
 */
export function vaultImage(parent: HTMLElement, app: App, ref: ImageRef, cls: string): HTMLElement {
	const url = resourceUrl(app, ref.path);
	if (!url) {
		const miss = parent.createDiv({ cls: [cls, 'ws-img-missing'], attr: { title: `Missing image: ${ref.path}`, 'data-missing': ref.path } });
		icon(miss, 'image-off');
		return miss;
	}
	const img = parent.createEl('img', { cls: [cls, 'ws-img'], attr: { src: url, alt: ref.caption ?? '', loading: 'lazy', draggable: 'false' } });
	applyRef(img, ref);
	return img;
}

/** Apply focal point / zoom / fit to an existing <img>. */
export function applyRef(img: HTMLElement, ref: ImageRef): void {
	const st = refStyle(ref);
	img.style.objectFit = st.objectFit;
	img.style.objectPosition = st.objectPosition;
	img.style.transform = st.transform;
	img.style.transformOrigin = st.transformOrigin;
}

export const imageUI: FieldTypeUI = {
	renderDisplay(el, v, ctx) {
		if (!isRef(v)) return textDisplay(el, '');
		const frame = el.createDiv({ cls: 'ws-field-thumb-frame' });
		vaultImage(frame, ctx.app, v, 'ws-field-thumb');
	},
	createEditor(el, ctx) {
		let value: ImageRef | null = isRef(ctx.value) ? ctx.value : null;
		const ws = ctx.host?.ws;
		const box = el.createDiv({ cls: 'ws-image-field' });
		const set = (next: ImageRef | null) => {
			value = next;
			paint();
			ctx.onChange(next);
		};
		const pick = () => {
			if (!ws) return;
			new ImageBrowser(ws, { title: `Choose ${ctx.field.label.toLowerCase()}`, current: value?.path, sourcePath: ctx.entity?.linkedNote?.path, onPick: ([f]) => f && set({ ...(value ?? {}), path: f.path }) }).open();
		};
		const paint = () => {
			box.empty();
			if (value) {
				const v = value;
				const frame = box.createDiv({ cls: 'ws-image-field__frame' });
				vaultImage(frame, ctx.app, v, 'ws-image-field__img');
				if (ctx.readOnly || !ws) return;
				const tools = box.createDiv({ cls: 'ws-image-field__tools' });
				button(tools, { icon: 'replace', variant: 'quiet', size: 'sm', tooltip: 'Change image', onClick: pick });
				button(tools, { icon: 'crop', variant: 'quiet', size: 'sm', tooltip: 'Adjust framing', onClick: () => adjustImage(ws, v, (r) => set(r), ['square', 'landscape', 'portrait'], `Adjust ${ctx.field.label.toLowerCase()}`) });
				button(tools, { icon: 'x', variant: 'quiet', size: 'sm', tooltip: 'Remove image', onClick: () => set(null) });
			} else if (!ctx.readOnly && ws) {
				const add = box.createEl('button', { cls: 'ws-image-field__add', attr: { type: 'button' } });
				icon(add, 'image-plus');
				add.createSpan({ text: 'Choose image' });
				add.addEventListener('click', pick);
			} else textDisplay(box, '');
		};
		if (ws && !ctx.readOnly) {
			const off = imageDropTarget(box, ws, { label: 'Drop to use this image', single: true, onImages: ([f]) => f && set({ path: f.path }), sourcePath: () => ctx.entity?.linkedNote?.path });
			ctx.component.register(off);
		}
		paint();
		return {
			setValue(v) {
				value = isRef(v) ? v : null;
				paint();
			},
			focus: () => (box.querySelector('button'))?.focus(),
		};
	},
};

class AnyFilePicker extends FuzzySuggestModal<TFile> {
	constructor(
		app: App,
		private readonly onPick: (f: TFile) => void,
	) {
		super(app);
		this.modalEl.addClass('worldsmith-modal');
		this.setPlaceholder('Choose a file from your vault…');
	}
	getItems() {
		return this.app.vault.getFiles();
	}
	getItemText(f: TFile) {
		return f.path;
	}
	onChooseItem(f: TFile) {
		this.onPick(f);
	}
}

export const fileUI: FieldTypeUI = {
	renderDisplay(el, v) {
		textDisplay(el, isRef(v) ? (v.path.split('/').pop() ?? '') : '');
	},
	createEditor(el, ctx) {
		let value: ImageRef | null = isRef(ctx.value) ? ctx.value : null;
		const row = el.createDiv({ cls: 'ws-field-row' });
		const paint = () => {
			row.empty();
			if (value) {
				const v = value;
				const link = row.createEl('a', { cls: 'ws-field-link', text: v.path.split('/').pop() ?? v.path, attr: { href: '#' } });
				link.addEventListener('click', (e) => {
					e.preventDefault();
					void ctx.app.workspace.openLinkText(v.path, '', false);
				});
				button(row, { icon: 'x', variant: 'quiet', size: 'sm', tooltip: 'Remove', onClick: () => { value = null; paint(); ctx.onChange(null); } });
			} else {
				button(row, {
					icon: 'paperclip',
					label: 'Choose file',
					variant: 'ghost',
					size: 'sm',
					onClick: () =>
						new AnyFilePicker(ctx.app, (f) => {
							value = { path: f.path };
							paint();
							ctx.onChange(value);
						}).open(),
				});
			}
		};
		paint();
		return { setValue(v) { value = isRef(v) ? v : null; paint(); }, focus() {} };
	},
};

export const galleryUI: FieldTypeUI = {
	renderDisplay(el, v, ctx) {
		const items = Array.isArray(v) ? v.filter(isRef) : [];
		if (!items.length) return textDisplay(el, '');
		const strip = el.createDiv({ cls: 'ws-thumb-strip' });
		for (const it of items.slice(0, 6)) vaultImage(strip.createDiv({ cls: 'ws-field-thumb-frame' }), ctx.app, it, 'ws-field-thumb');
	},
	createEditor(el, ctx) {
		const norm = (v: unknown): GalleryItem[] => (Array.isArray(v) ? v.filter(isRef).map((x) => ({ ...(x as GalleryItem), id: (x as GalleryItem).id || uuid() })) : []);
		let items = norm(ctx.value);
		const ws = ctx.host?.ws;
		if (!ws || ctx.readOnly) {
			const holder = el.createDiv();
			galleryUI.renderDisplay(holder, items, ctx);
			return {
				setValue(v) {
					items = norm(v);
					holder.empty();
					galleryUI.renderDisplay(holder, items, ctx);
				},
				focus() {},
			};
		}
		const wrap = el.createDiv({ cls: 'ws-gallery-field' });
		const g = renderGallery(
			wrap,
			{
				ws,
				get: () => items,
				set: (next) => {
					items = next;
					g.repaint();
					ctx.onChange(next.length ? next.map((i) => ({ ...i })) : null);
				},
				sourcePath: () => ctx.entity?.linkedNote?.path,
			},
			{ layout: 'grid', columns: 4, aspect: 'square', fit: 'cover', editable: true, title: ctx.field.label },
		);
		return {
			setValue(v) {
				items = norm(v);
				g.repaint();
			},
			focus: () => (wrap.querySelector('button, [tabindex="0"]'))?.focus(),
		};
	},
};
