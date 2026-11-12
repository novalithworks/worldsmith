import { masonry } from '../components/masonry';
import { FuzzySuggestModal, Menu, Notice, TFile, type App } from 'obsidian';
import type { ResearchItem } from '../../core/types';
import { safeUrl } from '../../core/util/urls';
import { button, cx, icon } from '../components/dom';
import { EntitySuggestModal } from '../components/EntitySuggestModal';
import { NotePickerModal, promptModal } from '../components/modals';
import { actionNotice } from '../components/notice';
import { head, type Studio } from './kit';

/**
 * Research (0.28): a book's library of what it draws on: notes and images from the vault,
 * links, sources, entries of the world, and image boards. Nothing is copied; each card points
 * at the real thing and opens it (beside the manuscript, or a link in the browser).
 */

const IMAGE_EXT = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'avif', 'bmp'];
const KINDS: Array<{ id: ResearchItem['kind'] | 'all'; label: string; icon: string }> = [
	{ id: 'all', label: 'Everything', icon: '' },
	{ id: 'note', label: 'Notes', icon: 'file-text' },
	{ id: 'image', label: 'Images', icon: 'image' },
	{ id: 'link', label: 'Links', icon: 'link' },
	{ id: 'source', label: 'Sources', icon: 'book-marked' },
	{ id: 'entry', label: 'Entries', icon: 'map-pin' },
	{ id: 'board', label: 'Boards', icon: 'layout-grid' },
];
const KIND_ICON: Record<string, string> = { note: 'file-text', image: 'image', link: 'link', source: 'book-marked', entry: 'map-pin', board: 'layout-grid' };

class ImagePicker extends FuzzySuggestModal<TFile> {
	constructor(
		app: App,
		private readonly onPick: (f: TFile) => void,
	) {
		super(app);
		this.setPlaceholder('Choose an image from your vault…');
		this.modalEl.addClass('worldsmith-modal');
	}
	getItems(): TFile[] {
		return this.app.vault.getFiles().filter((f) => IMAGE_EXT.includes(f.extension.toLowerCase()));
	}
	getItemText(f: TFile): string {
		return f.path;
	}
	onChooseItem(f: TFile): void {
		this.onPick(f);
	}
}

export class ResearchScreen {
	private readonly el: HTMLElement;
	private filter: ResearchItem['kind'] | 'all' = 'all';

	constructor(
		private readonly st: Studio,
		parent: HTMLElement,
	) {
		this.el = parent.createDiv({ cls: 'ws-wr-research' });
	}

	mount(): void {
		this.refresh();
	}

	refresh(): void {
		const st = this.st;
		const p = st.project!;
		this.el.empty();
		const tools = head(this.el, { eyebrow: 'Research', title: 'Research and references', sub: `Notes, images, links and sources for ${p.name}. Open any of them beside the manuscript.` });
		button(tools, { label: 'Add', icon: 'plus', variant: 'primary', size: 'sm', cls: 'ws-wr-research-add', onClick: (e) => this.addMenu(e) });
		const items = p.research ?? [];
		const chips = this.el.createDiv({ cls: 'ws-wr-rfilter', attr: { role: 'radiogroup', 'aria-label': 'Show' } });
		for (const k of KINDS) {
			if (k.id !== 'all' && !items.some((x) => x.kind === k.id) && k.id !== this.filter) continue;
			const on = this.filter === k.id;
			const b = chips.createEl('button', { cls: cx('ws-wr-rfilter__chip', on && 'is-active'), text: k.label, attr: { type: 'button', role: 'radio', 'aria-checked': String(on), 'data-kind': k.id } });
			b.addEventListener('click', () => {
				this.filter = k.id;
				this.refresh();
			});
		}
		const shown = items.filter((x) => this.filter === 'all' || x.kind === this.filter).slice().reverse();
		if (!items.length) {
			const empty = this.el.createDiv({ cls: 'ws-wr-research__empty' });
			icon(empty, 'library');
			empty.createDiv({ cls: 'ws-wr-research__emptytitle', text: 'Nothing gathered yet' });
			empty.createDiv({ cls: 'ws-wr-muted', text: 'Add the notes, pictures, links and sources this book draws on. They stay where they are; this is a shelf of pointers.' });
			button(empty, { label: 'Add something', icon: 'plus', variant: 'ghost', size: 'sm', onClick: (e) => this.addMenu(e) });
			return;
		}
		const grid = this.el.createDiv({ cls: 'ws-wr-rgrid' });
		masonry(grid);
		for (const it of shown) this.card(grid, it);
	}

	private resource(path: string | undefined): string | null {
		const f = path ? this.st.ws.app.vault.getFileByPath(path) : null;
		return f ? this.st.ws.app.vault.getResourcePath(f) : null;
	}

	private card(grid: HTMLElement, it: ResearchItem): void {
		const st = this.st;
		const c = grid.createDiv({ cls: cx('ws-wr-rcard', `is-${it.kind}`), attr: { 'data-research': it.id, tabindex: '0', role: 'button', 'aria-label': `${it.kind}: ${it.title}. Open` } });
		// Pictures first, where there are any.
		if (it.kind === 'image') {
			const src = this.resource(it.path);
			if (src) c.createEl('img', { cls: 'ws-wr-rcard__img', attr: { src, alt: it.title, loading: 'lazy' } });
		} else if (it.kind === 'board') {
			const srcs = (it.images ?? []).map((x) => this.resource(x)).filter((x): x is string => !!x).slice(0, 3);
			if (srcs.length) {
				const col = c.createDiv({ cls: cx('ws-wr-rcard__collage', `n-${srcs.length}`) });
				for (const s of srcs) col.createEl('img', { attr: { src: s, alt: '', loading: 'lazy' } });
			}
		} else if (it.kind === 'entry') {
			const e = it.entityId ? st.s.entities.get(it.entityId) : undefined;
			const ref = e?.media?.banner?.path ?? e?.media?.portrait?.path;
			const src = this.resource(ref);
			if (src) c.createEl('img', { cls: 'ws-wr-rcard__img', attr: { src, alt: e?.name ?? '', loading: 'lazy' } });
		} else if (it.kind === 'note') {
			const ex = c.createDiv({ cls: 'ws-wr-rcard__excerpt' });
			const f = it.path ? st.ws.app.vault.getFileByPath(it.path) : null;
			if (f)
				void st.ws.app.vault.cachedRead(f).then((t) => {
					const body = t.replace(/^---\n[\s\S]*?\n---\n?/, '').replace(/[#>*_`[\]]/g, '').trim();
					ex.setText(body.length > 180 ? `${body.slice(0, 180)}…` : body);
				});
		}
		const body = c.createDiv({ cls: 'ws-wr-rcard__body' });
		const kick = body.createDiv({ cls: 'ws-wr-rcard__kind' });
		icon(kick, KIND_ICON[it.kind] ?? 'file');
		kick.createSpan({ text: it.kind === 'entry' ? 'Entry' : it.kind[0]!.toUpperCase() + it.kind.slice(1) });
		body.createDiv({ cls: 'ws-wr-rcard__title', text: it.title });
		const meta: string[] = [];
		if (it.kind === 'link' && it.url) {
			try {
				meta.push(new URL(safeUrl(it.url) ?? it.url).hostname.replace(/^www\./, ''));
			} catch {
				meta.push(it.url);
			}
			meta.push(`saved ${new Date(it.createdAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}`);
		}
		if (it.kind === 'source' && it.citation) meta.push(it.citation);
		if ((it.kind === 'note' || it.kind === 'image') && it.path) meta.push(it.path);
		if (it.kind === 'entry') {
			const e = it.entityId ? st.s.entities.get(it.entityId) : undefined;
			meta.push(e ? `${st.s.schemas.get(e.typeId)?.singular ?? 'Entry'} in ${st.s.world.name}` : 'Entry no longer in the world');
		}
		if (it.kind === 'board') meta.push(`${(it.images ?? []).length} image${(it.images ?? []).length === 1 ? '' : 's'}`);
		const scenes = it.scenes.map((id) => st.w.item(id)).filter((x): x is NonNullable<typeof x> => !!x && !x.trashedAt);
		if (scenes.length) meta.push(scenes.length === 1 ? `used in “${scenes[0]!.title}”` : `${scenes.length} scenes`);
		if (meta.length) body.createDiv({ cls: 'ws-wr-rcard__meta', text: meta.join(' · ') });
		c.addEventListener('click', () => this.open(it));
		c.addEventListener('keydown', (e) => {
			if (e.key === 'Enter') this.open(it);
		});
		c.addEventListener('contextmenu', (e) => {
			e.preventDefault();
			this.cardMenu(e, it);
		});
		const more = c.createEl('button', { cls: 'ws-wr-rcard__more clickable-icon', attr: { type: 'button', 'aria-label': `Menu for ${it.title}` } });
		icon(more, 'more-horizontal');
		more.addEventListener('click', (e) => {
			e.stopPropagation();
			this.cardMenu(e, it);
		});
	}

	private open(it: ResearchItem): void {
		openResearch(this.st, it);
	}

	private cardMenu(e: MouseEvent, it: ResearchItem): void {
		const st = this.st;
		const p = st.project!;
		const m = new Menu();
		m.addItem((i) => i.setTitle('Open').setIcon('external-link').onClick(() => this.open(it)));
		m.addItem((i) =>
			i
				.setTitle('Used in a scene…')
				.setIcon('feather')
				.onClick(() => {
					const sm = new Menu();
					for (const sc of st.w.scenes(p.id).filter((x) => !x.trashedAt))
						sm.addItem((x) =>
							x
								.setTitle(sc.title)
								.setChecked(it.scenes.includes(sc.id))
								.onClick(() => {
									st.w.updateResearch(p.id, it.id, { scenes: it.scenes.includes(sc.id) ? it.scenes.filter((y) => y !== sc.id) : [...it.scenes, sc.id] });
								}),
						);
					sm.showAtMouseEvent(e);
				}),
		);
		if (it.kind === 'board')
			m.addItem((i) =>
				i
					.setTitle('Add an image…')
					.setIcon('image-plus')
					.onClick(() => new ImagePicker(st.ws.app, (f) => st.w.updateResearch(p.id, it.id, { images: [...new Set([...(it.images ?? []), f.path])] })).open()),
			);
		m.addItem((i) =>
			i
				.setTitle('Rename…')
				.setIcon('pencil')
				.onClick(async () => {
					const t = await promptModal(st.ws.app, { title: 'Rename', value: it.title, confirmLabel: 'Rename' });
					if (t?.trim()) st.w.updateResearch(p.id, it.id, { title: t.trim() });
				}),
		);
		m.addSeparator();
		m.addItem((i) =>
			i
				.setTitle('Remove from research')
				.setIcon('trash-2')
				.onClick(() => {
					const { before, after } = st.w.removeResearch(p.id, it.id);
					actionNotice(`“${it.title}” removed from research (the note or file itself is untouched).`, { label: 'Undo', run: () => st.w.restoreProject(before, after) });
				}),
		);
		m.showAtMouseEvent(e);
	}

	private addMenu(e: MouseEvent): void {
		const st = this.st;
		const p = st.project!;
		const add = (item: Parameters<typeof st.w.addResearch>[1]) => {
			const { before, after } = st.w.addResearch(p.id, item);
			actionNotice(`“${item.title}” added to research.`, { label: 'Undo', run: () => st.w.restoreProject(before, after) });
		};
		const m = new Menu();
		m.addItem((i) => i.setTitle('A note from the vault…').setIcon('file-text').onClick(() => new NotePickerModal(st.ws.app, (f) => add({ kind: 'note', title: f.basename, path: f.path })).open()));
		m.addItem((i) => i.setTitle('An image from the vault…').setIcon('image').onClick(() => new ImagePicker(st.ws.app, (f) => add({ kind: 'image', title: f.basename, path: f.path })).open()));
		m.addItem((i) =>
			i
				.setTitle('A link…')
				.setIcon('link')
				.onClick(async () => {
					const url = await promptModal(st.ws.app, { title: 'Add a link', label: 'Web address', placeholder: 'https://…', confirmLabel: 'Next' });
					if (!url?.trim()) return;
					if (!safeUrl(url)) return void new Notice('Only web, mail and Obsidian links can be added.');
					const title = await promptModal(st.ws.app, { title: 'Add a link', label: 'What it is', placeholder: 'How bells were rung in fire alarms', confirmLabel: 'Add link' });
					if (title === null) return;
					add({ kind: 'link', title: title.trim() || url.trim(), url: url.trim() });
				}),
		);
		m.addItem((i) =>
			i
				.setTitle('A source…')
				.setIcon('book-marked')
				.onClick(async () => {
					const title = await promptModal(st.ws.app, { title: 'Add a source', label: 'Book, article or document', placeholder: 'Huizinga, The Waning of the Middle Ages', confirmLabel: 'Next' });
					if (!title?.trim()) return;
					const cite = await promptModal(st.ws.app, { title: 'Add a source', label: 'Where in it (optional)', placeholder: 'Ch. 1, p. 9', confirmLabel: 'Add source' });
					if (cite === null) return;
					add({ kind: 'source', title: title.trim(), citation: cite.trim() || undefined });
				}),
		);
		m.addItem((i) => i.setTitle('An entry of the world…').setIcon('map-pin').onClick(() => new EntitySuggestModal(st.ws.app, st.s, (en) => add({ kind: 'entry', title: en.name, entityId: en.id })).open()));
		m.addItem((i) =>
			i
				.setTitle('An image board…')
				.setIcon('layout-grid')
				.onClick(async () => {
					const title = await promptModal(st.ws.app, { title: 'New image board', label: 'Name', placeholder: 'Velmor, below ground', confirmLabel: 'Next: add an image' });
					if (!title?.trim()) return;
					new ImagePicker(st.ws.app, (f) => add({ kind: 'board', title: title.trim(), images: [f.path] })).open();
				}),
		);
		m.showAtMouseEvent(e);
	}
}

/** Open a research item: notes and images beside the manuscript, links in the browser. */
export function openResearch(st: Studio, it: ResearchItem): void {
	const app = st.ws.app;
	if ((it.kind === 'note' || it.kind === 'image') && it.path) {
		const f = app.vault.getFileByPath(it.path);
		if (!f) return void new Notice(`“${it.path}” isn’t in the vault any more.`);
		void app.workspace.getLeaf('split').openFile(f);
	} else if (it.kind === 'link' && it.url) {
		const u = safeUrl(it.url);
		if (u) window.open(u, '_blank', 'noopener,noreferrer');
		else new Notice('That address can’t be opened (only web links can).');
	} else if (it.kind === 'entry' && it.entityId) void st.ws.open({ name: 'entity', params: { id: it.entityId } }, { newLeaf: 'split' });
	else if (it.kind === 'board' && it.images?.[0]) {
		const f = app.vault.getFileByPath(it.images[0]);
		if (f) void app.workspace.getLeaf('split').openFile(f);
	}
}

export const RESEARCH_ICON = KIND_ICON;
