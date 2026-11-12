import { setIcon } from 'obsidian';
import type { EntityRecord, World } from '../../core/types';
import { relativeTime } from '../../core/util/strings';
import { vaultImage } from '../../fields/ui/media';
import { ROUTES } from '../../state/route';
import { openCreateEntity, openNewType } from '../../ui/actions';
import { avatar } from '../../ui/components/avatar';
import { button, emptyState, icon, cx } from '../../ui/components/dom';
import { own } from '../../ui/components/lifecycle';
import { WorldEditModal } from '../../ui/components/WorldEditModal';
import { actionNotice } from '../../ui/components/notice';
import { imageDropTarget } from '../../ui/media/drop';
import { ImageBrowser } from '../../ui/media/ImageBrowser';
import { showBannerMenu } from '../../ui/media/bannerTools';
import type { BlockDefinition, BlockRenderContext } from '../BlockRegistry';
import { linkToEntity } from '../util';
import { CUSTOMIZE_DASHBOARD_EVENT } from './common';

/** Repaint (debounced to a frame) whenever entities change; used by aggregate blocks. */
function onAnyEntityChange(ctx: BlockRenderContext, paint: () => void, filter?: (keys: string[]) => boolean): void {
	let queued = false;
	const schedule = () => {
		if (queued) return;
		queued = true;
		window.requestAnimationFrame(() => {
			queued = false;
			paint();
		});
	};
	own(ctx.component, ctx.session.events.on('entity:created', schedule));
	own(ctx.component, ctx.session.events.on('entity:deleted', schedule));
	own(
		ctx.component,
		ctx.session.events.on('entity:updated', ({ change }) => {
			if (!filter || filter(change.keys)) schedule();
		}),
	);
}

// ── world hero ────────────────────────────────────────────────────────────────

export const worldHeroBlock: BlockDefinition = {
	id: 'world-hero',
	category: 'Overview',
	name: 'World banner',
	singleton: true,
	hint: 'Name, banner and description',
	icon: 'globe-2',
	description: 'Your world’s name, banner and description.',
	surfaces: ['dashboard'],
	frame: 'plain',
	defaultSize: { w: 12, h: 1 },
	defaultConfig: {},
	render(ctx) {
		const root = ctx.el.createDiv({ cls: 'ws-world-hero' });
		const s = ctx.session;
		const pickBanner = () =>
			new ImageBrowser(ctx.ws, {
				title: 'Choose a world banner',
				current: s.world.banner?.path,
				onPick: ([f]) => f && setBanner(f.path),
			}).open();
		const setBanner = (path: string) => {
			const cur = s.world.banner;
			s.updateWorld({ banner: cur ? { ...cur, path } : { path, focalY: 0.5, height: 240 } });
		};
		const bannerMenu = (evt: MouseEvent) =>
			showBannerMenu(evt, {
				ws: ctx.ws,
				label: 'your world',
				current: () => s.world.banner,
				pick: pickBanner,
				save: (r) => s.updateWorld({ banner: r }),
				remove: () => {
					const b = s.world.banner;
					s.updateWorld({ banner: null });
					if (b) actionNotice('World banner removed. The image stays in your vault.', { label: 'Undo', run: () => s.updateWorld({ banner: b }) });
				},
				frame: () => root.querySelector<HTMLElement>('.ws-world-hero__banner'),
				owner: ctx.component,
				defaultHeight: 240,
			});
		imageDropTarget(root, ctx.ws, { label: 'Drop to set the world banner', single: true, onImages: ([f]) => f && setBanner(f.path) });
		const paint = (w: World) => {
			root.empty();
			root.toggleClass('has-banner', !!w.banner);
			if (w.banner) {
				const b = root.createDiv({ cls: 'ws-world-hero__banner' });
				b.style.height = `${w.banner.height ?? 240}px`;
				vaultImage(b, ctx.app, w.banner, 'ws-world-hero__img');
				const tools = b.createDiv({ cls: 'ws-hero__banner-tools' });
				button(tools, { icon: 'image', label: 'Banner', variant: 'ghost', size: 'sm', onClick: bannerMenu });
			}
			const body = root.createDiv({ cls: 'ws-world-hero__body' });
			const seal = body.createDiv({ cls: 'ws-world-hero__seal' });
			setIcon(seal, w.icon || 'globe-2');
			const text = body.createDiv({ cls: 'ws-world-hero__text' });
			text.createEl('h1', { cls: 'ws-world-hero__name', text: w.name });
			if (w.description) text.createEl('p', { cls: 'ws-world-hero__desc', text: w.description });
			const actions = body.createDiv({ cls: 'ws-world-hero__actions' });
			if (!ctx.editing)
				button(actions, {
					icon: 'layout-grid',
					variant: 'quiet',
					tooltip: 'Customize this dashboard',
					cls: 'ws-world-hero__customize',
					onClick: () => root.closest('.ws-page--dashboard')?.dispatchEvent(new CustomEvent(CUSTOMIZE_DASHBOARD_EVENT)),
				});
			if (!w.banner) button(actions, { icon: 'image-plus', variant: 'quiet', tooltip: 'Add a banner', onClick: pickBanner });
			button(actions, {
				icon: 'pencil',
				variant: 'quiet',
				tooltip: 'Edit world',
				onClick: () =>
					new WorldEditModal(ctx.ws, w, 'Edit world', 'Save', (v) => {
						ctx.session.updateWorld(v);
						ctx.ws.worlds.syncManifestName(ctx.session.world);
					}).open(),
			});
		};
		paint(ctx.session.world);
		own(
			ctx.component,
			ctx.session.events.on('world:updated', ({ world, keys }) => {
				// Mid-reposition only the banner's own save repaints (it ends the reposition first).
				if (root.querySelector('.is-repositioning') && !keys.includes('banner')) return;
				paint(world);
			}),
		);
	},
};

// ── contents (type index) ─────────────────────────────────────────────────────

/**
 * The world's contents: every type, grouped by sidebar section, as a row with its icon,
 * count and (optionally) how developed its entries are. The whole row is the link, so the
 * hover and click area is the row you see.
 */
export const contentsBlock: BlockDefinition = {
	id: 'contents',
	category: 'Overview',
	name: 'Contents',
	hint: 'Every type with its count',
	icon: 'book-open',
	description: 'Every entity type in your world with its count.',
	surfaces: ['dashboard'],
	frame: 'card',
	defaultSize: { w: 7, h: 1 },
	defaultConfig: { hideEmpty: false, progress: true },
	configFields: [
		{ id: 'progress', type: 'boolean', label: 'Show how developed each type is' },
		{ id: 'hideEmpty', type: 'boolean', label: 'Hide types with no entries' },
	],
	render(ctx) {
		const s = ctx.session;
		const root = ctx.el.createDiv({ cls: 'ws-contents' });
		const paint = () => {
			root.empty();
			const world = s.world;
			const showProgress = ctx.config.progress !== false;
			let total = 0;
			let shownTypes = 0;
			const grid = root.createDiv({ cls: 'ws-contents__grid' });
			for (const g of world.sidebar.groups) {
				const types = g.items
					.filter((i): i is { kind: 'type'; typeId: string } => i.kind === 'type')
					.map((i) => s.schemas.get(i.typeId))
					.filter((t): t is NonNullable<typeof t> => !!t && !t.archived);
				if (!types.length) continue;
				const counts = types.map((t) => s.index.countOfType(t.id));
				const sum = counts.reduce((a, b) => a + b, 0);
				total += sum;
				const visible = types.filter((_, i) => !(ctx.config.hideEmpty && counts[i] === 0));
				if (!visible.length) continue;
				const sec = grid.createEl('section', { cls: 'ws-contents__sec' });
				const head = sec.createDiv({ cls: 'ws-contents__sec-head' });
				head.createSpan({ cls: 'ws-contents__sec-label', text: g.label });
				head.createSpan({ cls: 'ws-contents__sec-count', text: sum.toLocaleString() });
				const list = sec.createDiv({ cls: 'ws-contents__list' });
				for (const t of visible) {
					const n = s.index.countOfType(t.id);
					shownTypes++;
					const row = list.createEl('a', {
						cls: cx('ws-contents__row', n === 0 && 'is-empty', t.color && `ws-tint--${t.color}`),
						attr: { href: '#', 'data-type': t.id },
					});
					const glyph = row.createSpan({ cls: 'ws-contents__glyph' });
					setIcon(glyph, t.icon);
					const text = row.createSpan({ cls: 'ws-contents__text' });
					text.createSpan({ cls: 'ws-contents__name', text: t.plural });
					if (showProgress && n > 0) {
						const entries = s.index.ofType(t.id);
						const avg = entries.reduce((a, e) => a + s.entityService.progress(e).ratio, 0) / entries.length;
						const bar = text.createSpan({ cls: 'ws-contents__bar' });
						bar.createSpan({ cls: 'ws-contents__bar-fill' }).style.transform = `scaleX(${Math.max(0.02, avg)})`;
						text.createSpan({ cls: 'ws-contents__meta', text: `${Math.round(avg * 100)}% developed` });
					} else if (n === 0) text.createSpan({ cls: 'ws-contents__meta', text: 'Nothing yet' });
					row.createSpan({ cls: 'ws-contents__count', text: n ? n.toLocaleString() : '—' });
					const go = row.createSpan({ cls: 'ws-contents__go' });
					setIcon(go, 'chevron-right');
					row.addEventListener('click', (evt) => {
						evt.preventDefault();
						ctx.navigate(ROUTES.database(t.id), evt.metaKey || evt.ctrlKey);
					});
				}
			}
			ctx.setTitle(`Contents · ${total.toLocaleString()} ${total === 1 ? 'entry' : 'entries'}`);
			if (!shownTypes) emptyState(root, { icon: 'book-open', title: 'No types with entries yet', compact: true });
			const foot = root.createDiv({ cls: 'ws-contents__foot' });
			button(foot, { label: 'New entity type', icon: 'plus', variant: 'quiet', size: 'sm', onClick: () => openNewType(ctx.ws) });
		};
		paint();
		onAnyEntityChange(ctx, paint, (keys) => keys.some((k) => k === 'trashedAt' || k === 'archivedAt' || k === 'typeId' || (ctx.config.progress !== false && k !== 'updatedAt')));
		// How developed a type is counts checklist tasks too.
		let queued = false;
		const later = () => {
			if (queued || ctx.config.progress === false) return;
			queued = true;
			window.requestAnimationFrame(() => {
				queued = false;
				if (root.isConnected) paint();
			});
		};
		for (const ev of ['task:created', 'task:updated', 'task:deleted'] as const) own(ctx.component, s.events.on(ev, later));
		own(ctx.component, s.events.on('world:updated', paint));
		own(ctx.component, s.events.on('schema:created', paint));
		own(ctx.component, s.events.on('schema:updated', paint));
	},
};

// ── entity lists ──────────────────────────────────────────────────────────────

function entityRows(ctx: BlockRenderContext, parent: HTMLElement, items: EntityRecord[], meta: (e: EntityRecord) => string): void {
	const s = ctx.session;
	const list = parent.createDiv({ cls: 'ws-mini-list' });
	for (const e of items) {
		const row = list.createDiv({ cls: 'ws-mini-list__row' });
		const schema = s.schemas.get(e.typeId);
		avatar(row, ctx.app, e, schema, { size: 'xs' });
		const t = row.createDiv({ cls: 'ws-mini-list__text' });
		t.createDiv({ cls: 'ws-mini-list__name', text: e.name });
		t.createDiv({ cls: 'ws-mini-list__meta', text: meta(e) });
		linkToEntity(ctx, row, e);
	}
}

export const recentBlock: BlockDefinition = {
	id: 'recent',
	category: 'Activity',
	name: 'Recent work',
	icon: 'history',
	description: 'Entries you edited — or created — most recently.',
	hint: 'Recently edited or created',
	surfaces: ['dashboard'],
	frame: 'card',
	defaultSize: { w: 7, h: 1 },
	defaultConfig: { limit: 8, mode: 'edited' },
	configFields: [
		{ id: 'mode', type: 'select', label: 'Show', config: { options: [{ id: 'edited', label: 'Recently edited' }, { id: 'created', label: 'Recently created' }] } },
		{ id: 'limit', type: 'number', label: 'How many', config: { min: 1, max: 30 } },
	],
	title: (ctx) => (ctx.config.mode === 'created' ? 'Recently created' : 'Recent work'),
	render(ctx) {
		const s = ctx.session;
		const body = ctx.el.createDiv();
		const created = ctx.config.mode === 'created';
		const paint = () => {
			body.empty();
			const limit = typeof ctx.config.limit === 'number' ? ctx.config.limit : 8;
			const items = created
				? s.entities
						.all()
						.filter((e) => !e.trashedAt && !e.archivedAt)
						.sort((a, b) => b.createdAt - a.createdAt)
						.slice(0, limit)
				: s.index.recent(limit);
			if (!items.length) {
				emptyState(body, {
					icon: 'feather',
					title: 'Your world is a blank page',
					body: 'Create your first character, place or legend to begin.',
					actionLabel: 'Create something',
					onAction: () => openCreateEntity(ctx.ws),
				});
				return;
			}
			entityRows(ctx, body, items, (e) => `${s.schemas.get(e.typeId)?.singular ?? ''} • ${created ? `created ${relativeTime(e.createdAt)}` : relativeTime(e.updatedAt)}`);
		};
		paint();
		onAnyEntityChange(ctx, paint);
	},
};

export const favoritesBlock: BlockDefinition = {
	id: 'favorites',
	category: 'Activity',
	name: 'Favorites',
	hint: 'Pinned and starred entries',
	icon: 'star',
	description: 'Pinned and favorite entries.',
	surfaces: ['dashboard'],
	frame: 'card',
	defaultSize: { w: 5, h: 1 },
	defaultConfig: {},
	render(ctx) {
		const s = ctx.session;
		const body = ctx.el.createDiv();
		const paint = () => {
			body.empty();
			const pinned = s.index.pinnedEntities();
			const favs = s.index.favoriteEntities().filter((e) => !e.flags.pinned);
			const items = [...pinned, ...favs].slice(0, 12);
			if (!items.length) {
				emptyState(body, { icon: 'star', title: 'Nothing starred yet', body: 'Star an entry from its page to keep it close.', compact: true });
				return;
			}
			entityRows(ctx, body, items, (e) => (e.flags.pinned ? 'Pinned' : (s.schemas.get(e.typeId)?.singular ?? '')));
		};
		paint();
		onAnyEntityChange(ctx, paint, (keys) => keys.some((k) => k === 'flags' || k === 'name' || k === 'trashedAt' || k === 'media'));
	},
};

export const quickCreateBlock: BlockDefinition = {
	id: 'quick-create',
	category: 'Overview',
	name: 'Quick create',
	hint: 'One click to a new entry',
	icon: 'plus-circle',
	description: 'One-click creation for your most-used types.',
	surfaces: ['dashboard'],
	frame: 'card',
	defaultSize: { w: 5, h: 1 },
	defaultConfig: { types: ['character', 'location', 'creature', 'magic', 'faction', 'event'] },
	render(ctx) {
		const s = ctx.session;
		const grid = ctx.el.createDiv({ cls: 'ws-quick' });
		const wanted = Array.isArray(ctx.config.types) ? (ctx.config.types as string[]) : [];
		const types = wanted.map((id) => s.schemas.get(id)).filter((t): t is NonNullable<typeof t> => !!t);
		for (const t of types) {
			const b = grid.createEl('button', { cls: cx('ws-quick__item', t.color ? `ws-tint--${t.color}` : ''), attr: { type: 'button' } });
			icon(b, t.icon, 'ws-quick__icon');
			b.createSpan({ cls: 'ws-quick__label', text: t.singular });
			b.addEventListener('click', () => openCreateEntity(ctx.ws, { typeId: t.id }));
		}
		const more = grid.createEl('button', { cls: 'ws-quick__item ws-quick__item--more', attr: { type: 'button' } });
		icon(more, 'more-horizontal', 'ws-quick__icon');
		more.createSpan({ text: 'Other…' });
		more.addEventListener('click', () => openCreateEntity(ctx.ws));
	},
};
