import { Menu, setIcon, setTooltip, type TFile } from 'obsidian';
import type { WorldsmithContext } from '../../app/context';
import { folderOf } from '../../core/util/media';
import { ROLE_LABELS, type MediaUsage } from '../../services/MediaRefs';
import { button, cx, emptyState, icon, nameRegion } from '../components/dom';
import { WorldsmithModal } from '../components/modals';
import { imageDropTarget } from './drop';

export interface ImageBrowserOptions {
	title?: string;
	/** Pick several images at once (galleries). */
	multiple?: boolean;
	/** Path of the image currently in use — highlighted and listed first. */
	current?: string | null;
	/** For Obsidian's "same folder as current file" attachment setting. */
	sourcePath?: string;
	onPick: (files: TFile[]) => void;
}

type Show = 'all' | 'used' | 'unused';
type Sort = 'recent' | 'name' | 'folder';

const PAGE = 90;
const SORTS: ReadonlyArray<readonly [Sort, string]> = [
	['recent', 'Newest first'],
	['name', 'Name'],
	['folder', 'Folder'],
];

/**
 * Browse the vault's images as a grid of thumbnails. Search, filter by folder or by use in
 * this world, and add new images by uploading, pasting, dropping or downloading a link.
 */
export class ImageBrowser extends WorldsmithModal {
	private query = '';
	private folder = '';
	private show: Show = 'all';
	private sort: Sort = 'recent';
	private limit = PAGE;
	private selected: TFile[] = [];
	private files: TFile[] = [];
	private usage = new Map<string, MediaUsage[]>();
	private grid!: HTMLElement;
	private footCount!: HTMLElement;
	private addBtn: HTMLButtonElement | null = null;
	private folderSel!: HTMLSelectElement;
	private linkRow!: HTMLElement;
	private observer: IntersectionObserver | null = null;
	private picked = false;
	private total = 0;

	constructor(
		private readonly ws: WorldsmithContext,
		private readonly o: ImageBrowserOptions,
	) {
		super(ws.app);
		this.modalEl.addClass('ws-ib-modal');
	}

	override onOpen(): void {
		this.setTitle(this.o.title ?? (this.o.multiple ? 'Add images' : 'Choose an image'));
		this.usage = this.ws.worlds.session?.media.byPath() ?? new Map<string, MediaUsage[]>();
		this.files = this.ws.media.images();
		const c = this.contentEl;
		c.addClass('ws-ib');

		// ── toolbar ──
		const bar = c.createDiv({ cls: 'ws-ib__bar' });
		const searchWrap = bar.createDiv({ cls: 'ws-ib__search' });
		icon(searchWrap, 'search');
		const search = searchWrap.createEl('input', { cls: 'ws-input', attr: { type: 'search', placeholder: 'Search images…', 'aria-label': 'Search images' } });
		search.addEventListener('input', () => {
			this.query = search.value.trim().toLowerCase();
			this.limit = PAGE;
			this.paint();
		});
		search.addEventListener('keydown', (ev) => {
			if (ev.key === 'ArrowDown') {
				ev.preventDefault();
				(this.grid.querySelector('.ws-ib__tile'))?.focus();
			}
			if (ev.key === 'Enter' && !this.o.multiple) {
				const first = this.visible()[0];
				if (first) this.choose(first);
			}
		});

		// Desktop: two dropdowns. Phones: one "Filter" button with the same choices.
		const filters = bar.createDiv({ cls: 'ws-ib__filters' });
		const filterBtn = button(bar, {
			label: 'Filter',
			icon: 'sliders-horizontal',
			variant: 'ghost',
			size: 'sm',
			cls: 'ws-ib__filter-btn',
			onClick: (evt) => {
				const m = new Menu();
				m.addItem((i) => i.setTitle('Sort').setIsLabel(true));
				for (const [id, label] of SORTS) {
					m.addItem((i) =>
						i.setTitle(label).setChecked(this.sort === id).onClick(() => {
							this.sort = id;
							sortSel.value = id;
							syncFilterBtn();
							this.paint();
						}),
					);
				}
				m.addSeparator();
				m.addItem((i) => i.setTitle('Folder').setIsLabel(true));
				for (const opt of Array.from(this.folderSel.options)) {
					m.addItem((i) =>
						i.setTitle(opt.text).setChecked(this.folder === opt.value).onClick(() => {
							this.folder = opt.value;
							this.folderSel.value = opt.value;
							this.limit = PAGE;
							syncFilterBtn();
							this.paint();
						}),
					);
				}
				m.showAtMouseEvent(evt);
			},
		});
		const syncFilterBtn = () => filterBtn.toggleClass('is-active', !!this.folder || this.sort !== 'recent');
		this.folderSel = filters.createEl('select', { cls: 'dropdown ws-ib__folder', attr: { 'aria-label': 'Folder' } });
		this.fillFolders();
		this.folderSel.addEventListener('change', () => {
			this.folder = this.folderSel.value;
			this.limit = PAGE;
			syncFilterBtn();
			this.paint();
		});
		const sortSel = filters.createEl('select', { cls: 'dropdown', attr: { 'aria-label': 'Sort' } });
		for (const [id, label] of SORTS) sortSel.createEl('option', { value: id, text: label });
		sortSel.addEventListener('change', () => {
			this.sort = sortSel.value as Sort;
			syncFilterBtn();
			this.paint();
		});

		bar.createDiv({ cls: 'ws-ib__spacer' });
		const fileInput = bar.createEl('input', { cls: 'ws-visually-hidden', attr: { type: 'file', accept: 'image/*', tabindex: '-1', 'aria-hidden': 'true' } });
		fileInput.multiple = !!this.o.multiple;
		fileInput.addEventListener('change', () => void (async () => {
			const list = Array.from(fileInput.files ?? []);
			fileInput.value = '';
			if (!list.length) return;
			const incoming = await Promise.all(list.map(async (f) => ({ name: f.name, type: f.type, data: await f.arrayBuffer() })));
			this.added(await this.ws.media.import(incoming, this.o.sourcePath));
		})());
		button(bar, { label: 'Upload', icon: 'upload', variant: 'ghost', size: 'sm', tooltip: `Copy images from your computer into ${this.ws.media.describeTarget()}`, onClick: () => fileInput.click() });
		button(bar, {
			label: 'From link',
			icon: 'link',
			variant: 'ghost',
			size: 'sm',
			onClick: () => {
				this.linkRow.toggleClass('is-open', !this.linkRow.hasClass('is-open'));
				(this.linkRow.querySelector('input'))?.focus();
			},
		});

		// ── link row ──
		this.linkRow = c.createDiv({ cls: 'ws-ib__link' });
		const url = this.linkRow.createEl('input', { cls: 'ws-input', attr: { type: 'url', placeholder: 'https://… image address', 'aria-label': 'Image link' } });
		const fetchLink = async () => {
			if (!url.value.trim()) return;
			dl.disabled = true;
			dl.addClass('is-loading');
			const f = await this.ws.media.importUrl(url.value, this.o.sourcePath);
			dl.disabled = false;
			dl.removeClass('is-loading');
			if (f) {
				url.value = '';
				this.linkRow.removeClass('is-open');
				this.added([f]);
			}
		};
		url.addEventListener('keydown', (ev) => ev.key === 'Enter' && void fetchLink());
		const dl = button(this.linkRow, { label: 'Download', icon: 'download', variant: 'primary', size: 'sm', onClick: () => void fetchLink() });

		// ── show filter ──
		if (this.ws.worlds.session) {
			const tabs = c.createDiv({ cls: 'ws-ib__tabs', attr: { role: 'tablist'} });
			nameRegion(tabs, 'Show' );
			for (const [id, label] of [
				['all', 'All images'],
				['used', 'Used in this world'],
				['unused', 'Not used yet'],
			] as const) {
				const t = tabs.createEl('button', { cls: cx('ws-ib__tab', id === this.show && 'is-active'), text: label, attr: { type: 'button', role: 'tab', 'aria-selected': String(id === this.show) } });
				t.addEventListener('click', () => {
					this.show = id;
					tabs.querySelectorAll('.ws-ib__tab').forEach((x) => {
						x.toggleClass('is-active', x === t);
						x.setAttr('aria-selected', String(x === t));
					});
					this.limit = PAGE;
					this.paint();
				});
			}
		}

		// ── grid ──
		this.grid = c.createDiv({ cls: 'ws-ib__grid', attr: { role: 'listbox', 'aria-multiselectable': String(!!this.o.multiple) } });
		nameRegion(this.grid, 'Images');
		this.grid.addEventListener('keydown', (ev) => this.onGridKey(ev));

		// ── footer ──
		const foot = c.createDiv({ cls: 'ws-ib__foot' });
		const hint = foot.createDiv({ cls: 'ws-ib__hint' });
		icon(hint, 'mouse-pointer-click');
		hint.createSpan({ text: 'Drop images here, or paste one, to add it to your vault.' });
		this.footCount = foot.createDiv({ cls: 'ws-ib__count' });
		button(foot, { label: 'Cancel', variant: 'ghost', onClick: () => this.close() });
		if (this.o.multiple) {
			this.addBtn = button(foot, { label: 'Add images', icon: 'plus', variant: 'primary', onClick: () => this.finish() });
			this.addBtn.disabled = true;
		}

		// Drop & paste anywhere in the dialog.
		this.register(imageDropTarget(this.modalEl, this.ws, { label: 'Drop to add to your vault', onImages: (f) => this.added(f), sourcePath: () => this.o.sourcePath }));
		const onPaste = async (ev: ClipboardEvent) => {
			const dt = ev.clipboardData;
			if (!dt || !Array.from(dt.files ?? []).some((f) => f.type.startsWith('image/'))) return;
			ev.preventDefault();
			this.added(await this.ws.media.fromTransfer(dt, this.o.sourcePath));
		};
		const onPasteNow = (e: ClipboardEvent): void => void onPaste(e);
		this.modalEl.addEventListener('paste', onPasteNow);
		this.register(() => this.modalEl.removeEventListener('paste', onPasteNow));

		this.paint();
		window.setTimeout(() => search.focus(), 0);
	}

	private cleanups: Array<() => void> = [];
	private register(fn: () => void): void {
		this.cleanups.push(fn);
	}

	override onClose(): void {
		this.observer?.disconnect();
		for (const f of this.cleanups.splice(0)) f();
		this.contentEl.empty();
	}

	private fillFolders(): void {
		const counts = new Map<string, number>();
		for (const f of this.files) {
			const d = folderOf(f.path);
			counts.set(d, (counts.get(d) ?? 0) + 1);
		}
		this.folderSel.empty();
		this.folderSel.createEl('option', { value: '', text: `All folders (${this.files.length})` });
		for (const d of [...counts.keys()].sort((a, b) => a.localeCompare(b))) {
			this.folderSel.createEl('option', { value: d || '/', text: `${d || 'Vault root'} (${counts.get(d)})` });
		}
		this.folderSel.value = this.folder;
	}

	/** New files arrived (upload, paste, drop, link). */
	private added(files: TFile[]): void {
		if (!files.length) return;
		if (!this.o.multiple) {
			const first = files[0];
			if (first) this.choose(first);
			return;
		}
		this.files = this.ws.media.images();
		for (const f of files) if (!this.selected.includes(f)) this.selected.push(f);
		this.fillFolders();
		this.show = 'all';
		this.paint();
	}

	private visible(): TFile[] {
		const q = this.query;
		let list = this.files.filter((f) => {
			if (this.folder && (this.folder === '/' ? folderOf(f.path) !== '' : folderOf(f.path) !== this.folder)) return false;
			if (q && !f.path.toLowerCase().includes(q)) return false;
			if (this.show === 'used' && !this.usage.has(f.path)) return false;
			if (this.show === 'unused' && this.usage.has(f.path)) return false;
			return true;
		});
		if (this.sort === 'name') list = [...list].sort((a, b) => a.basename.localeCompare(b.basename));
		if (this.sort === 'folder') list = [...list].sort((a, b) => a.path.localeCompare(b.path));
		const cur = this.o.current;
		if (cur) {
			const i = list.findIndex((f) => f.path === cur);
			const hit = list[i];
			if (i > 0 && hit) list = [hit, ...list.slice(0, i), ...list.slice(i + 1)];
		}
		return list;
	}

	private paint(): void {
		this.observer?.disconnect();
		this.grid.empty();
		const all = this.visible();
		this.updateFoot(all.length);
		if (!this.files.length) {
			emptyState(this.grid, {
				icon: 'image-plus',
				title: 'No images in your vault yet',
				body: 'Upload, paste or drop images here — they’re copied into your vault.',
				actionLabel: 'Upload images',
				actionIcon: 'upload',
				onAction: () => (this.contentEl.querySelector('input[type=file]'))?.click(),
			});
			this.grid.addClass('is-empty');
			return;
		}
		this.grid.removeClass('is-empty');
		if (!all.length) {
			emptyState(this.grid, { icon: 'search-x', title: 'No images match', body: this.show === 'unused' ? 'Every image here is already used in this world.' : 'Try another search or folder.', compact: true });
			this.grid.addClass('is-empty');
			return;
		}
		const shown = all.slice(0, this.limit);
		for (const f of shown) this.tile(f);
		if (all.length > shown.length) {
			const more = this.grid.createEl('button', { cls: 'ws-ib__more', text: `Show more (${all.length - shown.length})`, attr: { type: 'button' } });
			more.addEventListener('click', () => {
				this.limit += PAGE * 2;
				this.paint();
			});
			if (typeof IntersectionObserver !== 'undefined') {
				this.observer = new IntersectionObserver((entries) => {
					if (entries.some((e) => e.isIntersecting)) {
						this.limit += PAGE;
						this.paint();
					}
				}, { root: this.grid, rootMargin: '200px' });
				this.observer.observe(more);
			}
		}
	}

	private tile(f: TFile): void {
		const sel = this.selected.includes(f);
		const isCurrent = f.path === this.o.current;
		const uses = this.usage.get(f.path) ?? [];
		const t = this.grid.createEl('button', {
			cls: cx('ws-ib__tile', sel && 'is-selected', isCurrent && 'is-current'),
			attr: { type: 'button', role: 'option', 'aria-selected': String(sel || isCurrent), 'aria-label': f.basename, 'data-path': f.path },
		});
		const frame = t.createDiv({ cls: 'ws-ib__thumb' });
		frame.createEl('img', { attr: { src: this.app.vault.getResourcePath(f), alt: '', loading: 'lazy', draggable: 'false' } });
		if (this.o.multiple) {
			const check = frame.createSpan({ cls: 'ws-ib__check' });
			setIcon(check, 'check');
		}
		if (isCurrent) frame.createSpan({ cls: 'ws-ib__badge ws-ib__badge--current', text: 'Current' });
		else if (uses.length) {
			const b = frame.createSpan({ cls: 'ws-ib__badge', text: `Used ×${uses.length}` });
			setTooltip(b, this.describeUses(uses), { delay: 300 });
		}
		const meta = t.createDiv({ cls: 'ws-ib__meta' });
		meta.createDiv({ cls: 'ws-ib__name', text: f.basename });
		meta.createDiv({ cls: 'ws-ib__path', text: folderOf(f.path) || 'Vault root' });
		t.addEventListener('click', () => {
			if (this.o.multiple) this.toggle(f, t);
			else this.choose(f);
		});
	}

	private describeUses(uses: MediaUsage[]): string {
		const s = this.ws.worlds.session;
		const lines = uses.slice(0, 6).map((u) => {
			const who = u.entityId ? (s?.entities.get(u.entityId)?.name ?? 'An entry') : (s?.world.name ?? 'World');
			const what = u.role === 'field' && u.entityId ? (s?.schemas.get(s.entities.get(u.entityId)?.typeId ?? '')?.fields.find((x) => x.id === u.fieldId)?.label ?? 'Field') : ROLE_LABELS[u.role];
			return `${who} — ${what}`;
		});
		if (uses.length > 6) lines.push(`and ${uses.length - 6} more`);
		return lines.join('\n');
	}

	private toggle(f: TFile, el: HTMLElement): void {
		const i = this.selected.indexOf(f);
		if (i === -1) this.selected.push(f);
		else this.selected.splice(i, 1);
		const on = i === -1;
		el.toggleClass('is-selected', on);
		el.setAttr('aria-selected', String(on));
		this.updateFoot();
	}

	private updateFoot(total?: number): void {
		const n = this.selected.length;
		if (total !== undefined) this.total = total;
		const tot = this.total;
		this.footCount.setText(this.o.multiple && n ? `${n} selected` : `${tot.toLocaleString()} image${tot === 1 ? '' : 's'}`);
		if (this.addBtn) {
			this.addBtn.disabled = n === 0;
			(this.addBtn.querySelector('.ws-btn__label') ?? this.addBtn).setText(n > 1 ? `Add ${n} images` : n === 1 ? 'Add 1 image' : 'Add images');
		}
	}

	private choose(f: TFile): void {
		if (this.picked) return;
		this.picked = true;
		this.close();
		this.o.onPick([f]);
	}

	private finish(): void {
		if (!this.selected.length || this.picked) return;
		this.picked = true;
		const files = [...this.selected];
		this.close();
		this.o.onPick(files);
	}

	/** Arrow keys move through the grid by rows and columns. */
	private onGridKey(ev: KeyboardEvent): void {
		const tiles = Array.from(this.grid.querySelectorAll<HTMLElement>('.ws-ib__tile'));
		const i = tiles.indexOf(document.activeElement as HTMLElement);
		if (i === -1) return;
		const top = tiles[0]?.offsetTop ?? 0;
		let cols = tiles.findIndex((t) => t.offsetTop !== top);
		if (cols <= 0) cols = tiles.length;
		const go = (j: number) => {
			const t = tiles[Math.max(0, Math.min(tiles.length - 1, j))];
			t?.focus();
			t?.scrollIntoView({ block: 'nearest' });
		};
		switch (ev.key) {
			case 'ArrowRight':
				go(i + 1);
				break;
			case 'ArrowLeft':
				go(i - 1);
				break;
			case 'ArrowDown':
				go(i + cols);
				break;
			case 'ArrowUp':
				if (i < cols) (this.contentEl.querySelector('.ws-ib__search input'))?.focus();
				else go(i - cols);
				break;
			case 'Home':
				go(0);
				break;
			case 'End':
				go(tiles.length - 1);
				break;
			case 'Enter':
				if (this.o.multiple && (ev.metaKey || ev.ctrlKey)) this.finish();
				else return;
				break;
			default:
				return;
		}
		ev.preventDefault();
	}
}
