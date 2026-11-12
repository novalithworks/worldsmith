import { Component, Keymap, MarkdownRenderer, Menu } from 'obsidian';
import type { EntityRecord, FieldDefinition } from '../../core/types';
import { relativeTime } from '../../core/util/strings';
import { listEditor } from '../../fields/ui/choice';
import { blockActions } from '../../layouts/renderer/LayoutRenderer';
import { ROUTES } from '../../state/route';
import { openCreateEntity } from '../../ui/actions';
import { avatar } from '../../ui/components/avatar';
import { button, emptyState, icon, progressRing, cx } from '../../ui/components/dom';
import { NotePickerModal, promptModal } from '../../ui/components/modals';
import { actionNotice } from '../../ui/components/notice';
import { EntityMediaActions } from '../../ui/media/entityMedia';
import { renderGallery, type GalleryAspect, type GalleryLayout } from '../../ui/media/gallery';
import type { BlockDefinition } from '../BlockRegistry';
import { currentEntity, linkToEntity, watchEntity } from '../util';
import { revealField } from './properties';
import { own } from '../../ui/components/lifecycle';

// ── progress ──────────────────────────────────────────────────────────────────

export const progressBlock: BlockDefinition = {
	id: 'progress',
	category: 'Basics',
	name: 'Development',
	icon: 'gauge',
	description: 'How developed this entry is, and what to fill in next.',
	surfaces: ['entity'],
	frame: 'card',
	defaultSize: { w: 4, h: 1 },
	defaultConfig: { suggestions: 4 },
	render(ctx) {
		const entity = ctx.entity;
		const schema = ctx.schema;
		if (!entity || !schema) return;
		const s = ctx.session;
		const root = ctx.el.createDiv({ cls: 'ws-progress' });
		const top = root.createDiv({ cls: 'ws-progress__top' });
		const ring = progressRing(top, 0, 52);
		const summary = top.createDiv({ cls: 'ws-progress__summary' });
		const next = root.createDiv({ cls: 'ws-progress__next' });
		const limit = typeof ctx.config.suggestions === 'number' ? ctx.config.suggestions : 4;

		const paint = (e: EntityRecord) => {
			const c = s.entityService.progress(e);
			ring.set(c.ratio);
			summary.empty();
			summary.createDiv({ cls: 'ws-progress__headline', text: c.ratio >= 1 ? 'Fully developed' : `${Math.round(c.ratio * 100)}% developed` });
			const subs = [`${c.fields.done} of ${c.fields.total} key details`];
			if (c.tasks.total) subs.push(`${c.tasks.done} of ${c.tasks.total} tasks`);
			summary.createDiv({ cls: 'ws-progress__sub', text: subs.join(' · ') });

			next.empty();
			const missing: Array<{ label: string; required?: boolean; run: () => void }> = [];
			if (!e.description.trim()) missing.push({ label: 'Write a summary', run: () => focusDescription() });
			if (!e.media.portrait && !e.media.banner) missing.push({ label: 'Add a portrait or banner', run: () => focusPortrait() });
			// Required fields come first: they're flagged on the page until filled.
			const fresh = s.schemas.get(schema.id) ?? schema;
			const required: typeof missing = [];
			for (const f of fresh.fields) {
				if (f.hidden || !(f.required || f.recommended)) continue;
				const t = ctx.ws.fieldTypes.for(f);
				if ((t.computed && t.category !== 'relation') || !t.isEmpty(s.values.get(e, f))) continue;
				(f.required ? required : missing).push({ label: f.label, required: f.required, run: () => revealField(ctx.el, f.id) });
			}
			missing.unshift(...required);
			if (!missing.length) return;
			next.createDiv({ cls: 'ws-progress__next-label', text: 'Next up' });
			const list = next.createEl('ul', { cls: 'ws-progress__list' });
			for (const m of missing.slice(0, limit)) {
				const li = list.createEl('li');
				const b = li.createEl('button', { cls: cx('ws-progress__item', m.required && 'is-required'), attr: { type: 'button' } });
				icon(b, m.required ? 'circle-alert' : 'circle-dashed', 'ws-progress__item-icon');
				b.createSpan({ text: m.label });
				if (m.required) b.createSpan({ cls: 'ws-progress__req', text: 'Required' });
				b.addEventListener('click', m.run);
			}
			if (missing.length > limit) next.createDiv({ cls: 'ws-progress__more', text: `and ${missing.length - limit} more` });
		};
		const focusDescription = () => {
			const el = ctx.el.closest('.ws-page')?.querySelector('.ws-description .ws-rich__preview') as HTMLElement | null;
			el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
			el?.click();
		};
		const focusPortrait = () => {
			const el = ctx.el.closest('.ws-page')?.querySelector('.ws-hero__portrait-btn') as HTMLElement | null;
			el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
			el?.focus();
		};
		paint(entity);
		watchEntity(ctx, (e) => paint(e));
		// Linked fields count toward development too.
		const repaint = () => {
			const e = currentEntity(ctx);
			if (e) paint(e);
		};
		const touches = (edge: { from: string; to: string }) => edge.from === entity.id || edge.to === entity.id;
		own(ctx.component, s.events.on('edge:created', ({ edge }) => touches(edge) && repaint()));
		own(ctx.component, s.events.on('edge:deleted', ({ edge }) => touches(edge) && repaint()));
		for (const ev of ['task:created', 'task:deleted', 'task:updated'] as const) {
			own(ctx.component, s.events.on(ev, ({ task }) => task.entityId === entity.id && repaint()));
		}
	},
};

// ── names & tags ──────────────────────────────────────────────────────────────

const ALIASES: FieldDefinition = { id: '__aliases', type: 'list', label: 'Aliases', placeholder: 'Other names, epithets…' };
const TAGS: FieldDefinition = { id: '__tags', type: 'tags', label: 'Tags', placeholder: 'Add a tag' };

export const namesTagsBlock: BlockDefinition = {
	id: 'names-tags',
	category: 'Basics',
	name: 'Names & tags',
	icon: 'tags',
	description: 'Aliases (searchable) and tags.',
	surfaces: ['entity'],
	frame: 'card',
	defaultSize: { w: 4, h: 1 },
	defaultConfig: {},
	render(ctx) {
		const entity = ctx.entity;
		if (!entity) return;
		const s = ctx.session;
		const root = ctx.el.createDiv({ cls: 'ws-props ws-props--single' });
		const grid = root.createDiv({ cls: 'ws-fields' });
		const mk = (field: FieldDefinition, key: 'aliases' | 'tags', tagStyle: boolean) => {
			const row = grid.createDiv({ cls: 'ws-prop ws-prop--full' });
			row.createDiv({ cls: 'ws-prop__label', text: field.label });
			const val = row.createDiv({ cls: 'ws-prop__value' });
			return listEditor(
				val,
				{
					app: ctx.app,
					field,
					entity,
					component: ctx.component,
					value: entity[key],
					onChange: (v) => s.entityService.update(entity.id, { [key]: Array.isArray(v) ? v : [] }),
				},
				tagStyle,
			);
		};
		const aliases = mk(ALIASES, 'aliases', false);
		const tags = mk(TAGS, 'tags', true);
		watchEntity(
			ctx,
			(e, keys) => {
				if (keys.includes('aliases')) aliases.setValue(e.aliases);
				if (keys.includes('tags')) tags.setValue(e.tags);
			},
			(k) => k === 'aliases' || k === 'tags',
		);
	},
};

// ── linked note ───────────────────────────────────────────────────────────────

export const linkedNoteBlock: BlockDefinition = {
	id: 'linked-note',
	category: 'Writing',
	name: 'Linked notes',
	icon: 'file-text',
	description: 'Markdown notes for free-form writing — as many as you like, side by side with the record.',
	surfaces: ['entity'],
	frame: 'card',
	defaultSize: { w: 4, h: 1 },
	defaultConfig: { preview: false },
	title: () => 'Notes',
	render(ctx) {
		if (!ctx.entity) return;
		const root = ctx.el.createDiv({ cls: 'ws-note' });
		/** Which note's preview is open (by path). */
		let previewPath: string | null = ctx.config.preview === true ? (ctx.entity.linkedNote?.path ?? null) : null;
		let previewScope: Component | null = null;
		const notes = ctx.ws.linkedNotes;

		const addNew = async () => {
			const cur = currentEntity(ctx);
			if (!cur) return;
			if (!cur.linkedNote) {
				await notes.create(cur);
				return;
			}
			const title = await promptModal(ctx.app, { title: 'New note', label: 'What is it about?', placeholder: 'e.g. Backstory, Chapter 3 scenes', confirmLabel: 'Create note' });
			if (title === null) return;
			const fresh = currentEntity(ctx);
			if (fresh) await notes.create(fresh, title || 'Notes');
		};
		const linkExisting = () =>
			new NotePickerModal(ctx.app, (f) => {
				const cur = currentEntity(ctx);
				if (cur) notes.link(cur, f);
			}).open();

		const rowMenu = (evt: MouseEvent, e: EntityRecord, n: ReturnType<typeof notes.notes>[number]) => {
			const m = new Menu();
			if (n.file) m.addItem((i) => i.setTitle('Open in a new tab').setIcon('file-plus-2').onClick(() => void notes.openPath(n.path, 'tab')));
			if (n.file) m.addItem((i) => i.setTitle('Open to the right').setIcon('columns-2').onClick(() => void notes.openPath(n.path, 'split')));
			if (!n.main) {
				m.addItem((i) => i.setTitle('Make it the main note').setIcon('star').onClick(() => notes.makeMain(e, n.path)));
				m.addItem((i) =>
					i
						.setTitle('Rename label…')
						.setIcon('pencil')
						.onClick(async () => {
							const v = await promptModal(ctx.app, { title: 'Note label', label: 'Shown in the list instead of the file name', value: n.label ?? '', confirmLabel: 'Save' });
							if (v !== null) notes.setLabel(e, n.path, v);
						}),
				);
			}
			m.addItem((i) =>
				i
					.setTitle(n.main ? 'Replace with another note…' : 'Link a different note…')
					.setIcon('replace')
					.onClick(() =>
						new NotePickerModal(ctx.app, (f) => {
							const cur = currentEntity(ctx);
							if (!cur) return;
							if (n.main) notes.replaceMain(cur, f);
							else {
								notes.unlink(cur, n.path);
								const after = currentEntity(ctx);
								if (after) notes.link(after, f);
							}
						}).open(),
					),
			);
			m.addSeparator();
			m.addItem((i) =>
				i
					.setTitle('Unlink')
					.setIcon('unlink')
					.onClick(() => {
						const before = notes.unlink(e, n.path);
						if (before)
							actionNotice('Note unlinked. The file is still in your vault.', {
								label: 'Undo',
								run: () => ctx.session.entityService.update(e.id, { linkedNote: before.linkedNote, moreNotes: before.moreNotes }),
							});
					}),
			);
			m.showAtMouseEvent(evt);
		};

		const paint = (e: EntityRecord) => {
			root.empty();
			previewScope?.unload();
			previewScope = null;
			const all = notes.notes(e);
			if (!all.length) {
				root.createDiv({ cls: 'ws-note__hint', text: 'Keep long-form writing in regular notes — as many as you like. The structured record stays here.' });
				const row = root.createDiv({ cls: 'ws-note__actions' });
				button(row, { label: 'Create note', icon: 'file-plus', variant: 'ghost', size: 'sm', onClick: () => void addNew() });
				button(row, { label: 'Link existing', icon: 'link', variant: 'quiet', size: 'sm', onClick: linkExisting });
				return;
			}
			if (previewPath && !all.some((n) => n.path === previewPath && n.file)) previewPath = null;
			const list = root.createDiv({ cls: 'ws-note__list' });
			for (const n of all) {
				const item = list.createDiv({ cls: cx('ws-note__item', n.main && 'is-main', previewPath === n.path && 'is-previewing'), attr: { 'data-note': n.path } });
				const card = item.createDiv({ cls: cx('ws-note__file', n.file ? '' : 'is-missing') });
				icon(card, n.file ? (n.main ? 'file-text' : 'file') : 'file-x', 'ws-note__file-icon');
				const meta = card.createDiv({ cls: 'ws-note__file-meta' });
				const nameRow = meta.createDiv({ cls: 'ws-note__file-name' });
				nameRow.createSpan({ text: n.label || n.file?.basename || n.path.split('/').pop()?.replace(/\.md$/, '') || '' });
				if (n.main && all.length > 1) nameRow.createSpan({ cls: 'ws-note__main', text: 'Main' });
				meta.createDiv({
					cls: 'ws-note__file-path',
					text: n.file ? `${n.label ? `${n.file.basename} • ` : ''}edited ${relativeTime(n.file.stat.mtime)}` : 'Note not found — it may have been moved outside Obsidian',
				});
				if (n.file) {
					card.addClass('is-clickable');
					card.tabIndex = 0;
					card.setAttr('role', 'button');
					card.addEventListener('click', (evt) => void notes.openPath(n.path, Keymap.isModEvent(evt) ? 'split' : 'tab'));
					card.addEventListener('keydown', (evt) => {
						if (evt.key === 'Enter') void notes.openPath(n.path, 'tab');
					});
				}
				const tools = card.createDiv({ cls: 'ws-note__tools' });
				if (n.file)
					button(tools, {
						icon: previewPath === n.path ? 'eye-off' : 'eye',
						variant: 'quiet',
						size: 'sm',
						cls: 'ws-note__peek',
						tooltip: previewPath === n.path ? 'Hide preview' : 'Preview',
						onClick: (evt) => {
							evt.stopPropagation();
							previewPath = previewPath === n.path ? null : n.path;
							paint(currentEntity(ctx) ?? e);
						},
					});
				button(tools, {
					icon: 'more-horizontal',
					variant: 'quiet',
					size: 'sm',
					cls: 'ws-note__more',
					tooltip: 'Note options',
					onClick: (evt) => {
						evt.stopPropagation();
						rowMenu(evt, currentEntity(ctx) ?? e, n);
					},
				});
				if (n.file && previewPath === n.path) {
					const box = item.createDiv({ cls: 'ws-note__preview ws-markdown markdown-rendered' });
					previewScope = new Component();
					ctx.component.addChild(previewScope);
					const scope = previewScope;
					const file = n.file;
					void ctx.app.vault.cachedRead(file).then((text) => {
						const body = text.replace(/^---[\s\S]*?---\n?/, '').trim();
						if (!body) box.setText('This note is empty.');
						else void MarkdownRenderer.render(ctx.app, body.slice(0, 4000), box, file.path, scope);
					});
				}
			}
			const row = root.createDiv({ cls: 'ws-note__actions' });
			button(row, { label: 'New note', icon: 'file-plus', variant: 'quiet', size: 'sm', cls: 'ws-note__add', onClick: () => void addNew() });
			button(row, { label: 'Link existing', icon: 'link', variant: 'quiet', size: 'sm', cls: 'ws-note__link', onClick: linkExisting });
		};
		paint(ctx.entity);
		watchEntity(ctx, (e) => paint(e), (k) => k === 'linkedNote' || k === 'moreNotes');
	},
};

// ── children ──────────────────────────────────────────────────────────────────

export const childrenBlock: BlockDefinition = {
	id: 'children',
	category: 'Basics',
	name: 'Nested entries',
	icon: 'git-fork',
	description: 'Entries placed inside this one (cities in a nation, branches of a power system…).',
	surfaces: ['entity'],
	frame: 'card',
	defaultSize: { w: 4, h: 1 },
	defaultConfig: {},
	title: (ctx) => (typeof ctx.config.title === 'string' ? ctx.config.title : 'Nested entries'),
	render(ctx) {
		const entity = ctx.entity;
		const schema = ctx.schema;
		if (!entity || !schema) return;
		const s = ctx.session;
		const list = ctx.el.createDiv({ cls: 'ws-mini-list' });
		const childTypes = schema.hierarchy.childTypes;
		const add = () => openCreateEntity(ctx.ws, { parentId: entity.id, typeIds: childTypes.length ? childTypes : undefined, typeId: childTypes.length === 1 ? childTypes[0] : null });
		const actions = blockActions(ctx.el);
		if (actions) button(actions, { icon: 'plus', variant: 'quiet', size: 'sm', tooltip: 'Add nested entry', onClick: add });
		const baseTitle = typeof ctx.config.title === 'string' ? ctx.config.title : 'Nested entries';

		const paint = () => {
			list.empty();
			const kids = s.index.childrenOf(entity.id).sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
			ctx.setTitle(kids.length ? `${baseTitle} · ${kids.length}` : baseTitle);
			if (!kids.length) {
				emptyState(list, { icon: 'git-fork', title: 'Nothing nested here yet', actionLabel: 'Add entry', onAction: add, compact: true });
				return;
			}
			for (const k of kids.slice(0, 50)) {
				const row = list.createDiv({ cls: 'ws-mini-list__row' });
				const ks = s.schemas.get(k.typeId);
				avatar(row, ctx.app, k, ks, { size: 'xs' });
				const t = row.createDiv({ cls: 'ws-mini-list__text' });
				t.createDiv({ cls: 'ws-mini-list__name', text: k.name });
				t.createDiv({ cls: 'ws-mini-list__meta', text: s.entityService.subtitle(k) || ks?.singular || '' });
				linkToEntity(ctx, row, k);
			}
			if (kids.length > 50) list.createDiv({ cls: 'ws-mini-list__more', text: `+ ${kids.length - 50} more` });
		};
		// Only repaint when one of *our* children changes (or something moves in/out).
		let shown = new Set<string>();
		const paintAndTrack = () => {
			paint();
			shown = new Set(s.index.childrenOf(entity.id).map((k) => k.id));
		};
		paintAndTrack();
		const relevant = (e: EntityRecord) => e.parentId === entity.id || shown.has(e.id);
		ctx.component.register(s.events.on('entity:created', ({ entity: e }) => relevant(e) && paintAndTrack()).dispose);
		ctx.component.register(s.events.on('entity:deleted', ({ entity: e }) => relevant(e) && paintAndTrack()).dispose);
		ctx.component.register(
			s.events.on('entity:updated', ({ entity: e }) => {
				if (relevant(e)) paintAndTrack();
			}).dispose,
		);
	},
};

// ── gallery ───────────────────────────────────────────────────────────────────

export const galleryBlock: BlockDefinition = {
	id: 'gallery',
	category: 'Basics',
	name: 'Gallery',
	icon: 'images',
	description: 'Images of this entry from your vault: drop, paste or browse to add; drag to reorder.',
	surfaces: ['entity'],
	frame: 'card',
	defaultSize: { w: 4, h: 1 },
	defaultConfig: { layout: 'grid', columns: 2, aspect: 'square', fit: 'cover', limit: 0 },
	configFields: [
		{ id: 'layout', type: 'select', label: 'Layout', config: { options: [{ id: 'grid', label: 'Grid' }, { id: 'masonry', label: 'Masonry (natural heights)' }, { id: 'strip', label: 'Filmstrip' }] } },
		{ id: 'columns', type: 'number', label: 'Columns', config: { min: 1, max: 6 } },
		{ id: 'aspect', type: 'select', label: 'Tile shape', config: { options: [{ id: 'square', label: 'Square' }, { id: 'landscape', label: 'Landscape (4:3)' }, { id: 'portrait', label: 'Portrait (3:4)' }, { id: 'original', label: 'Original' }] } },
		{ id: 'fit', type: 'select', label: 'Fit', config: { options: [{ id: 'cover', label: 'Fill the tile' }, { id: 'contain', label: 'Show whole image' }] } },
		{ id: 'limit', type: 'number', label: 'Show at most (0 = all)', config: { min: 0, max: 60 } },
	] as FieldDefinition[],
	render(ctx) {
		if (!ctx.entity) return;
		const s = ctx.session;
		const id = ctx.entity.id;
		const media = new EntityMediaActions(ctx.ws, s, id);
		const cfg = ctx.config;
		const layout = (['grid', 'masonry', 'strip'].includes(cfg.layout as string) ? cfg.layout : 'grid') as GalleryLayout;
		const g = renderGallery(
			ctx.el,
			{
				ws: ctx.ws,
				get: () => s.entities.get(id)?.media.gallery ?? [],
				set: (items) => {
					const cur = s.entities.get(id);
					if (cur) s.entityService.update(id, { media: { ...cur.media, gallery: items } });
				},
				sourcePath: () => s.entities.get(id)?.linkedNote?.path,
				extraActions: [
					{ label: 'Use as portrait', icon: 'user-round', run: (it) => media.setPortrait(it.path) },
					{ label: 'Use as banner', icon: 'panel-top', run: (it) => media.setBanner(it.path) },
				],
			},
			{
				layout,
				columns: typeof cfg.columns === 'number' ? cfg.columns : 2,
				aspect: (['square', 'landscape', 'portrait', 'original'].includes(cfg.aspect as string) ? cfg.aspect : 'square') as GalleryAspect,
				fit: cfg.fit === 'contain' ? 'contain' : 'cover',
				editable: true,
				limit: typeof cfg.limit === 'number' ? cfg.limit : 0,
				title: `${ctx.entity.name}’s gallery`,
			},
		);
		const actions = blockActions(ctx.el);
		if (actions) button(actions, { icon: 'plus', variant: 'quiet', size: 'sm', tooltip: 'Add images', onClick: () => g.add() });
		const title = () => {
			const n = s.entities.get(id)?.media.gallery.length ?? 0;
			ctx.setTitle(n ? `Gallery · ${n}` : 'Gallery');
		};
		title();
		watchEntity(ctx, () => {
			g.repaint();
			title();
		}, (k) => k === 'media');
	},
};

export { ROUTES };
