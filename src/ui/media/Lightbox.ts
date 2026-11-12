import { Menu, setIcon } from 'obsidian';
import type { ImageRef } from '../../core/types';
import { fileNameOf } from '../../core/util/media';
import type { WorldsmithContext } from '../../app/context';
import { resourceUrl } from '../../fields/ui/media';
import { icon, pinStyles } from '../components/dom';
import { WorldsmithModal } from '../components/modals';

export interface LightboxAction {
	label: string;
	icon: string;
	warning?: boolean;
	run: (index: number) => void;
}

export interface LightboxOptions {
	items: () => ImageRef[];
	index: number;
	title?: string;
	/** Save an edited caption. Omit to make captions read-only. */
	onCaption?: (index: number, caption: string) => void;
	/** Extra actions in the ⋯ menu (set as portrait, remove…). */
	actions?: LightboxAction[];
}

/**
 * Full-size image viewer: ← / → to move, Escape to close, captions editable in place.
 * Reads `items()` on every move so edits made from the menu show immediately.
 */
export class Lightbox extends WorldsmithModal {
	private i: number;
	private stage!: HTMLElement;
	private caption!: HTMLElement;
	private counter!: HTMLElement;
	private nameEl!: HTMLElement;
	private keyHandler = (ev: KeyboardEvent) => this.onKey(ev);

	constructor(
		ws: WorldsmithContext,
		private readonly o: LightboxOptions,
	) {
		super(ws.app);
		this.i = o.index;
		this.modalEl.addClass('ws-lightbox-modal');
		this.containerEl.addClass('ws-lightbox-container');
		// Obsidian dims the backdrop with an inline opacity; the lightbox wants it solid.
		pinStyles(this.containerEl, '.modal-bg', { opacity: '1' });
	}

	override onOpen(): void {
		const c = this.contentEl;
		c.addClass('ws-lightbox');
		// One close button: the viewer's own (top right, with the other tools).
		// (Newer Obsidian draws it as a header button.)
		this.containerEl.querySelectorAll<HTMLElement>('.modal-close-button, .modal-header-button').forEach((b) => b.hide());
		const bar = windowBarBottom(this.containerEl.ownerDocument);
		if (bar) this.containerEl.style.setProperty('--ws-lightbox-top', `${bar}px`);
		const top = c.createDiv({ cls: 'ws-lightbox__top' });
		this.counter = top.createDiv({ cls: 'ws-lightbox__counter' });
		this.nameEl = top.createDiv({ cls: 'ws-lightbox__name' });
		const tools = top.createDiv({ cls: 'ws-lightbox__tools' });
		const open = tools.createEl('button', { cls: 'ws-lightbox__btn', attr: { type: 'button', 'aria-label': 'Open in Obsidian' } });
		setIcon(open, 'external-link');
		open.addEventListener('click', () => {
			const ref = this.current();
			const f = ref ? this.app.vault.getFileByPath(ref.path) : null;
			if (f) {
				this.close();
				void this.app.workspace.getLeaf('tab').openFile(f);
			}
		});
		if (this.o.actions?.length) {
			const more = tools.createEl('button', { cls: 'ws-lightbox__btn', attr: { type: 'button', 'aria-label': 'Image options' } });
			setIcon(more, 'more-horizontal');
			more.addEventListener('click', (ev) => {
				const m = new Menu();
				for (const a of this.o.actions ?? []) {
					m.addItem((it) => {
						it.setTitle(a.label).setIcon(a.icon).onClick(() => {
							a.run(this.i);
							window.setTimeout(() => this.afterAction(), 50);
						});
						if (a.warning) it.setWarning(true);
					});
				}
				m.showAtMouseEvent(ev);
			});
		}
		const close = tools.createEl('button', { cls: 'ws-lightbox__btn', attr: { type: 'button', 'aria-label': 'Close' } });
		setIcon(close, 'x');
		close.addEventListener('click', () => this.close());

		const body = c.createDiv({ cls: 'ws-lightbox__body' });
		const prev = body.createEl('button', { cls: 'ws-lightbox__nav ws-lightbox__nav--prev', attr: { type: 'button', 'aria-label': 'Previous image' } });
		setIcon(prev, 'chevron-left');
		prev.addEventListener('click', () => this.go(-1));
		this.stage = body.createDiv({ cls: 'ws-lightbox__stage' });
		this.stage.addEventListener('click', (ev) => {
			if (ev.target === this.stage) this.close();
		});
		const next = body.createEl('button', { cls: 'ws-lightbox__nav ws-lightbox__nav--next', attr: { type: 'button', 'aria-label': 'Next image' } });
		setIcon(next, 'chevron-right');
		next.addEventListener('click', () => this.go(1));
		this.caption = c.createDiv({ cls: 'ws-lightbox__caption' });

		this.modalEl.addEventListener('keydown', this.keyHandler);
		this.paint();
	}

	override onClose(): void {
		this.modalEl.removeEventListener('keydown', this.keyHandler);
		this.contentEl.empty();
	}

	private current(): ImageRef | undefined {
		return this.o.items()[this.i];
	}

	private afterAction(): void {
		const n = this.o.items().length;
		if (!n) return this.close();
		this.i = Math.min(this.i, n - 1);
		this.paint();
	}

	private go(d: number): void {
		const n = this.o.items().length;
		if (n < 2) return;
		this.i = (this.i + d + n) % n;
		this.paint();
	}

	private onKey(ev: KeyboardEvent): void {
		const t = ev.target as HTMLElement;
		if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA') return;
		if (ev.key === 'ArrowLeft') this.go(-1);
		else if (ev.key === 'ArrowRight') this.go(1);
		else return;
		ev.preventDefault();
	}

	private paint(): void {
		const items = this.o.items();
		const ref = items[this.i];
		this.stage.empty();
		this.caption.empty();
		this.modalEl.toggleClass('is-single', items.length < 2);
		if (!ref) return;
		this.counter.setText(items.length > 1 ? `${this.i + 1} / ${items.length}` : '');
		this.nameEl.setText(this.o.title ? `${this.o.title} · ${fileNameOf(ref.path)}` : fileNameOf(ref.path));
		const url = resourceUrl(this.app, ref.path);
		if (url) this.stage.createEl('img', { cls: 'ws-lightbox__img', attr: { src: url, alt: ref.caption ?? '' } });
		else {
			const miss = this.stage.createDiv({ cls: 'ws-lightbox__missing' });
			icon(miss, 'image-off');
			miss.createSpan({ text: `Missing: ${ref.path}` });
		}
		if (this.o.onCaption) {
			const input = this.caption.createEl('input', { cls: 'ws-lightbox__caption-input', attr: { type: 'text', placeholder: 'Add a caption…', 'aria-label': 'Caption' } });
			input.value = ref.caption ?? '';
			const save = () => {
				if ((ref.caption ?? '') !== input.value.trim()) this.o.onCaption?.(this.i, input.value.trim());
			};
			input.addEventListener('blur', save);
			input.addEventListener('keydown', (ev) => {
				if (ev.key === 'Enter') input.blur();
				if (ev.key === 'Escape') {
					input.value = ref.caption ?? '';
					input.blur();
					ev.stopPropagation();
				}
			});
		} else if (ref.caption) this.caption.createDiv({ cls: 'ws-lightbox__caption-text', text: ref.caption });
	}
}

/**
 * How far down the window's own buttons reach (Windows and Linux without the system frame),
 * so the viewer's tools sit below them. 0 when nothing is up there (a Mac, full screen, the
 * system frame).
 */
export function windowBarBottom(doc: Document): number {
	const win = doc.defaultView ?? window;
	const body = doc.body;
	if (body.hasClass('is-fullscreen') || !(body.hasClass('mod-windows') || body.hasClass('mod-linux'))) return 0;
	let bottom = 0;
	const near = (r: DOMRect) => r.width > 0 && r.height > 0 && r.top < 8 && r.bottom < 120;
	for (const el of Array.from(doc.querySelectorAll<HTMLElement>('.titlebar-button-container, .titlebar'))) {
		const r = el.getBoundingClientRect();
		if (near(r)) bottom = Math.max(bottom, r.bottom);
	}
	// Buttons drawn by the system over the window (no element of their own).
	const overlay = (navigator as Navigator & { windowControlsOverlay?: { visible: boolean; getTitlebarAreaRect(): DOMRect } }).windowControlsOverlay;
	if (overlay?.visible) bottom = Math.max(bottom, overlay.getTitlebarAreaRect().height);
	// Otherwise the row of tabs along the top right, where those buttons live.
	// (Only without the system's own frame: with it, those buttons aren't in the page at all.)
	if (!bottom && body.hasClass('is-frameless')) {
		for (const el of Array.from(doc.querySelectorAll<HTMLElement>('.workspace-tab-header-container'))) {
			const r = el.getBoundingClientRect();
			if (near(r) && r.right > win.innerWidth - 200) bottom = Math.max(bottom, r.bottom);
		}
	}
	return Math.round(bottom);
}
