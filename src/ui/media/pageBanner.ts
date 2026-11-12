import type { Component } from 'obsidian';
import type { WorldsmithContext } from '../../app/context';
import type { BannerRef } from '../../core/types';
import type { Disposable } from '../../core/util/disposable';
import { vaultImage } from '../../fields/ui/media';
import type { WorldSession } from '../../services/WorldSession';
import { pageBannerKey, TOOL_PAGES, type ToolPage } from '../../services/pageBanners';

export { bannerPage, pageBannerKey, TOOL_PAGES, type ToolPage } from '../../services/pageBanners';
import { button, cx } from '../components/dom';
import { own } from '../components/lifecycle';
import { actionNotice } from '../components/notice';
import { imageDropTarget } from './drop';
import { showBannerMenu } from './bannerTools';
import { ImageBrowser } from './ImageBrowser';

/** A Tools page's banner, above its header. */
export function mountToolBanner(ctx: { ws: WorldsmithContext; session: WorldSession | null; component: Component }, header: HTMLElement, page: ToolPage): void {
	if (!ctx.session) return;
	mountPageBanner({ ws: ctx.ws, session: ctx.session, component: ctx.component, header, key: pageBannerKey.page(page), label: TOOL_PAGES[page].label });
}

export function getPageBanner(s: WorldSession, key: string): BannerRef | null {
	return s.world.pageBanners[key] ?? null;
}

export function setPageBanner(s: WorldSession, key: string, ref: BannerRef | null): void {
	const next = { ...s.world.pageBanners };
	if (ref) next[key] = ref;
	else delete next[key];
	s.updateWorld({ pageBanners: next });
}

export interface PageBannerOptions {
	ws: WorldsmithContext;
	session: WorldSession;
	component: Component;
	/** The page's `.ws-db-header`; the banner goes right above it. */
	header: HTMLElement;
	key: string;
	/** "the Tasks page", "Characters" — used in labels. */
	label: string;
}

/**
 * A banner for pages that aren't entries or Home (Tasks, dashboards, type databases):
 * the same choose / adjust height & framing / remove-with-Undo / drop-an-image tools as
 * entry and world banners, stored in world.json (`pageBanners`) so it syncs.
 */
/** Banners already shown this session. */
const shownKeys = new Set<string>();

/** Each page's banner listeners, by banner key. */
const mounted = new WeakMap<Component, Map<string, Disposable>>();

export function mountPageBanner(o: PageBannerOptions): void {
	const { ws, session: s, header, key, label } = o;
	const host = header.parentElement;
	if (!host) return;
	const wrap = host.createDiv({ cls: 'ws-page-banner' });
	host.insertBefore(wrap, header);
	// The "Add banner" button sits in its own slot beside the header's actions, which pages
	// redraw on their own.
	const slot = header.createDiv({ cls: 'ws-db-header__actions ws-page-banner__slot' });
	const actions = header.querySelector(':scope > .ws-db-header__actions:not(.ws-page-banner__slot)');
	if (actions) header.insertBefore(slot, actions);

	const pick = () =>
		new ImageBrowser(ws, {
			title: `Choose a banner for ${label}`,
			current: getPageBanner(s, key)?.path,
			onPick: ([f]) => f && setPath(f.path),
		}).open();
	const setPath = (path: string) => {
		const cur = getPageBanner(s, key);
		setPageBanner(s, key, cur ? { ...cur, path } : { path, focalY: 0.5, height: 200 });
	};
	const menu = (evt: MouseEvent) =>
		showBannerMenu(evt, {
			ws,
			label,
			current: () => getPageBanner(s, key),
			pick,
			save: (r) => setPageBanner(s, key, r),
			remove: () => {
				const b = getPageBanner(s, key);
				setPageBanner(s, key, null);
				if (b) actionNotice('Banner removed. The image stays in your vault.', { label: 'Undo', run: () => setPageBanner(s, key, b) });
			},
			frame: () => wrap.querySelector<HTMLElement>('.ws-page-banner__frame'),
			owner: o.component,
			defaultHeight: 200,
		});
	const drop = { label: `Drop to set the banner of ${label}`, single: true, onImages: ([f]: Array<{ path: string }>) => f && setPath(f.path) };
	imageDropTarget(wrap, ws, drop);
	imageDropTarget(header, ws, drop);

	const paint = () => {
		const b = getPageBanner(s, key);
		wrap.empty();
		wrap.toggleClass('is-empty', !b);
		header.toggleClass('has-page-banner', !!b);
		slot.empty();
		if (!b) {
			button(slot, { icon: 'image-plus', variant: 'quiet', tooltip: 'Add a banner', cls: 'ws-page-banner__add', onClick: pick });
			return;
		}
		// Fades in the first time only: pages that redraw (World health) don't flicker it.
		const frame = wrap.createDiv({ cls: cx('ws-page-banner__frame', shownKeys.has(key) && 'is-settled') });
		shownKeys.add(key);
		frame.style.height = `${b.height ?? 200}px`;
		vaultImage(frame, ws.app, b, 'ws-page-banner__img');
		const tools = frame.createDiv({ cls: 'ws-hero__banner-tools ws-page-banner__tools' });
		button(tools, { icon: 'image', label: 'Banner', variant: 'ghost', size: 'sm', cls: 'ws-page-banner__menu', onClick: menu });
	};
	paint();
	// One listener per page and banner: a page that redraws its header replaces it.
	let mine = mounted.get(o.component);
	if (!mine) {
		const map = new Map<string, Disposable>();
		mounted.set(o.component, (mine = map));
		own(o.component, {
			dispose: () => {
				for (const d of map.values()) d.dispose();
				map.clear();
			},
		});
	}
	mine.get(key)?.dispose();
	mine.set(key, s.events.on('world:updated', ({ keys }) => {
		if (wrap.isConnected && keys.includes('pageBanners')) paint();
	}));
}

