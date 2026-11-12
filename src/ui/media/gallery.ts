import { masonry } from '../components/masonry';
import { Menu, setIcon, setTooltip } from 'obsidian';
import type { WorldsmithContext } from '../../app/context';
import type { GalleryItem, ImageRef } from '../../core/types';
import { uuid } from '../../core/util/ids';
import { fileNameOf } from '../../core/util/media';
import { vaultImage } from '../../fields/ui/media';
import { cx, emptyState, icon, nameRegion } from '../components/dom';
import { actionNotice } from '../components/notice';
import { imageDropTarget, imagePasteTarget } from './drop';
import { ImageBrowser } from './ImageBrowser';
import { adjustImage, type FrameKind } from './ImageAdjust';
import { Lightbox, type LightboxAction } from './Lightbox';

export type GalleryLayout = 'grid' | 'masonry' | 'strip';
export type GalleryAspect = 'square' | 'landscape' | 'portrait' | 'original';

export interface GalleryOptions {
	layout: GalleryLayout;
	columns: number;
	aspect: GalleryAspect;
	fit: 'cover' | 'contain';
	editable: boolean;
	/** Limit tiles shown (the rest via the lightbox). 0 = all. */
	limit?: number;
	/** Name for dialogs and notices ("Auron’s gallery"). */
	title?: string;
}

export interface GalleryHost {
	ws: WorldsmithContext;
	get(): GalleryItem[];
	set(items: GalleryItem[]): void;
	sourcePath?: () => string | undefined;
	/** Extra per-image actions (Set as portrait / banner). */
	extraActions?: Array<{ label: string; icon: string; run: (item: GalleryItem) => void }>;
}

const DRAG_TYPE = 'text/x-worldsmith-item';
const ASPECT_FRAME: Record<GalleryAspect, FrameKind> = { square: 'square', landscape: 'landscape', portrait: 'portrait', original: 'square' };

/**
 * A gallery of vault images: add (browse, upload, drop, paste), reorder by dragging (or
 * Alt+←/→), caption, adjust framing, view full size, remove with Undo.
 */
export function renderGallery(parent: HTMLElement, host: GalleryHost, o: GalleryOptions): { repaint(): void; add(): void } {
	const { ws } = host;
	const root = parent.createDiv({
		cls: cx('ws-gal', `ws-gal--${o.layout}`, `ws-gal--${o.aspect}`, o.fit === 'contain' && 'ws-gal--contain', o.editable && 'is-editable'),
		attr: { tabindex: o.editable ? '0' : '-1'},
	});
	nameRegion(root, o.title ?? 'Gallery' );
	if (o.layout === 'masonry') masonry(root);
	root.style.setProperty('--ws-gal-cols', String(Math.max(1, Math.min(8, o.columns || 3))));

	const commit = (items: GalleryItem[]) => host.set(items);

	const add = () =>
		new ImageBrowser(ws, {
			title: 'Add images to the gallery',
			multiple: true,
			sourcePath: host.sourcePath?.(),
			onPick: (files) => addPaths(files.map((f) => f.path)),
		}).open();

	const addPaths = (paths: string[]) => {
		if (!paths.length) return;
		commit([...host.get(), ...paths.map((path) => ({ id: uuid(), path }))]);
	};

	const remove = (id: string) => {
		const before = host.get();
		const item = before.find((g) => g.id === id);
		if (!item) return;
		commit(before.filter((g) => g.id !== id));
		actionNotice(`Removed ${fileNameOf(item.path)} from the gallery. The file stays in your vault.`, { label: 'Undo', run: () => commit(before) });
	};

	const move = (id: string, to: number) => {
		const items = [...host.get()];
		const from = items.findIndex((g) => g.id === id);
		if (from === -1) return;
		const [it] = items.splice(from, 1);
		items.splice(Math.max(0, Math.min(items.length, to)), 0, it as GalleryItem);
		commit(items);
	};

	const update = (id: string, patch: Partial<GalleryItem>) => commit(host.get().map((g) => (g.id === id ? { ...g, ...patch } : g)));

	const open = (index: number) => {
		const actions: LightboxAction[] = [];
		if (o.editable) {
			actions.push({
				label: 'Adjust framing',
				icon: 'crop',
				run: (i) => {
					const it = host.get()[i];
					if (it) adjustImage(ws, it, (r) => update(it.id, r), [ASPECT_FRAME[o.aspect], 'square', 'landscape']);
				},
			});
			for (const x of host.extraActions ?? []) actions.push({ label: x.label, icon: x.icon, run: (i) => host.get()[i] && x.run(host.get()[i] as GalleryItem) });
			actions.push({ label: 'Remove from gallery', icon: 'trash-2', warning: true, run: (i) => host.get()[i] && remove((host.get()[i] as GalleryItem).id) });
		}
		new Lightbox(ws, {
			items: () => host.get(),
			index,
			title: o.title,
			onCaption: o.editable ? (i, caption) => host.get()[i] && update((host.get()[i] as GalleryItem).id, { caption: caption || undefined }) : undefined,
			actions,
		}).open();
	};

	const tileMenu = (ev: MouseEvent, it: GalleryItem, index: number) => {
		const m = new Menu();
		m.addItem((i) => i.setTitle('View').setIcon('maximize-2').onClick(() => open(index)));
		if (o.editable) {
			m.addItem((i) => i.setTitle(it.caption ? 'Edit caption' : 'Add caption').setIcon('text-cursor-input').onClick(() => open(index)));
			m.addItem((i) => i.setTitle('Adjust framing').setIcon('crop').onClick(() => adjustImage(ws, it, (r) => update(it.id, r), [ASPECT_FRAME[o.aspect], 'square', 'landscape'])));
			if (host.extraActions?.length) {
				m.addSeparator();
				for (const x of host.extraActions) m.addItem((i) => i.setTitle(x.label).setIcon(x.icon).onClick(() => x.run(it)));
			}
			m.addSeparator();
			m.addItem((i) => i.setTitle('Move to start').setIcon('arrow-left-to-line').setDisabled(index === 0).onClick(() => move(it.id, 0)));
			m.addItem((i) => i.setTitle('Move to end').setIcon('arrow-right-to-line').setDisabled(index === host.get().length - 1).onClick(() => move(it.id, host.get().length)));
		}
		m.addItem((i) =>
			i.setTitle('Open in Obsidian').setIcon('external-link').onClick(() => {
				const f = ws.app.vault.getFileByPath(it.path);
				if (f) void ws.app.workspace.getLeaf('tab').openFile(f);
			}),
		);
		if (o.editable) {
			m.addSeparator();
			m.addItem((i) => i.setTitle('Remove from gallery').setIcon('trash-2').setWarning(true).onClick(() => remove(it.id)));
		}
		m.showAtMouseEvent(ev);
	};

	let dragId: string | null = null;
	const paint = () => {
		root.empty();
		const items = host.get();
		root.toggleClass('is-empty', !items.length);
		if (!items.length) {
			const e = emptyState(root, {
				icon: 'images',
				title: 'No images yet',
				body: o.editable ? 'Add images from your vault, or drop them here.' : undefined,
				actionLabel: o.editable ? 'Add images' : undefined,
				onAction: o.editable ? add : undefined,
				compact: true,
			});
			e.addClass('ws-gal__empty');
			return;
		}
		const shown = o.limit && items.length > o.limit ? items.slice(0, o.limit) : items;
		shown.forEach((it, index) => {
			const tile = root.createDiv({
				cls: 'ws-gal__tile',
				attr: { tabindex: '0', role: 'button', 'aria-label': it.caption || fileNameOf(it.path), 'data-item': it.id, draggable: o.editable ? 'true' : 'false' },
			});
			const frame = tile.createDiv({ cls: 'ws-gal__frame' });
			const ref: ImageRef = o.aspect === 'original' ? { path: it.path, caption: it.caption } : { ...it, fit: o.fit === 'contain' ? 'contain' : it.fit };
			vaultImage(frame, ws.app, ref, 'ws-gal__img');
			if (it.caption) tile.createDiv({ cls: 'ws-gal__caption', text: it.caption });
			if (o.limit && index === shown.length - 1 && items.length > shown.length) {
				const more = frame.createDiv({ cls: 'ws-gal__more', text: `+${items.length - shown.length}` });
				setTooltip(more, 'Show all', { delay: 300 });
			}
			const menuBtn = tile.createEl('button', { cls: 'ws-gal__menu', attr: { type: 'button', 'aria-label': 'Image options' } });
			setIcon(menuBtn, 'more-horizontal');
			menuBtn.addEventListener('click', (ev) => {
				ev.stopPropagation();
				tileMenu(ev, it, index);
			});
			tile.addEventListener('click', () => open(index));
			tile.addEventListener('contextmenu', (ev) => {
				ev.preventDefault();
				tileMenu(ev, it, index);
			});
			tile.addEventListener('keydown', (ev) => {
				if (ev.key === 'Enter' || ev.key === ' ') {
					ev.preventDefault();
					open(index);
				} else if (o.editable && ev.altKey && (ev.key === 'ArrowLeft' || ev.key === 'ArrowRight')) {
					ev.preventDefault();
					move(it.id, index + (ev.key === 'ArrowLeft' ? -1 : 1));
					window.setTimeout(() => (root.querySelector(`[data-item="${it.id}"]`))?.focus(), 0);
				} else if (o.editable && (ev.key === 'Delete' || ev.key === 'Backspace')) {
					ev.preventDefault();
					remove(it.id);
				}
			});
			if (o.editable) {
				tile.addEventListener('dragstart', (ev) => {
					dragId = it.id;
					ev.dataTransfer?.setData(DRAG_TYPE, it.id);
					if (ev.dataTransfer) ev.dataTransfer.effectAllowed = 'move';
					tile.addClass('is-dragging');
				});
				tile.addEventListener('dragend', () => {
					dragId = null;
					tile.removeClass('is-dragging');
					root.querySelectorAll('.is-drop-before, .is-drop-after').forEach((x) => x.removeClass('is-drop-before', 'is-drop-after'));
				});
				tile.addEventListener('dragover', (ev) => {
					if (!dragId || dragId === it.id) return;
					ev.preventDefault();
					const r = tile.getBoundingClientRect();
					const after = o.layout === 'strip' || r.width > r.height * 0.6 ? ev.clientX > r.left + r.width / 2 : ev.clientY > r.top + r.height / 2;
					tile.toggleClass('is-drop-after', after);
					tile.toggleClass('is-drop-before', !after);
				});
				tile.addEventListener('dragleave', () => tile.removeClass('is-drop-before', 'is-drop-after'));
				tile.addEventListener('drop', (ev) => {
					if (!dragId) return;
					ev.preventDefault();
					ev.stopPropagation();
					const after = tile.hasClass('is-drop-after');
					const list = host.get();
					const from = list.findIndex((g) => g.id === dragId);
					let to = list.findIndex((g) => g.id === it.id) + (after ? 1 : 0);
					if (from < to) to--;
					const id = dragId;
					dragId = null;
					move(id, to);
				});
			}
		});
		if (o.editable) {
			const addTile = root.createEl('button', { cls: 'ws-gal__add', attr: { type: 'button', 'aria-label': 'Add images' } });
			icon(addTile, 'image-plus');
			addTile.createSpan({ text: 'Add' });
			addTile.addEventListener('click', add);
		}
	};

	if (o.editable) {
		imageDropTarget(root, ws, { label: 'Drop to add to the gallery', onImages: (f) => addPaths(f.map((x) => x.path)), sourcePath: host.sourcePath, ignoreTypes: [DRAG_TYPE] });
		imagePasteTarget(root, ws, (f) => addPaths(f.map((x) => x.path)), host.sourcePath);
	}
	paint();
	return { repaint: paint, add };
}
