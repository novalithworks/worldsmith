import { Menu } from 'obsidian';
import type { WorldsmithContext } from '../../app/context';
import type { BannerRef, EntityMedia, EntityRecord, ImageRef } from '../../core/types';
import { BANNER_PRESETS, fileNameOf } from '../../core/util/media';
import type { WorldSession } from '../../services/WorldSession';
import { actionNotice } from '../components/notice';
import { ImageBrowser } from './ImageBrowser';
import { adjustBanner, adjustPortrait } from './ImageAdjust';
import { Lightbox } from './Lightbox';

/**
 * Portrait and banner actions for one entry — shared by the hero, the gallery ("Set as
 * portrait") and menus. Always re-reads the entry so stale closures can't clobber edits.
 */
export class EntityMediaActions {
	constructor(
		private readonly ws: WorldsmithContext,
		private readonly s: WorldSession,
		private readonly id: string,
	) {}

	private get e(): EntityRecord | undefined {
		return this.s.entities.get(this.id);
	}

	private patch(media: Partial<EntityMedia>): void {
		const e = this.e;
		if (e) this.s.entityService.update(e.id, { media: { ...e.media, ...media } });
	}

	private sourcePath(): string | undefined {
		return this.e?.linkedNote?.path;
	}

	// ── portrait ──
	setPortrait(path: string): void {
		const cur = this.e?.media.portrait;
		// Keep the framing when the same file is chosen again.
		this.patch({ portrait: cur?.path === path ? cur : { path } });
	}

	pickPortrait(): void {
		const e = this.e;
		if (!e) return;
		new ImageBrowser(this.ws, {
			title: `Choose a portrait for ${e.name}`,
			current: e.media.portrait?.path,
			sourcePath: this.sourcePath(),
			onPick: ([f]) => f && this.setPortrait(f.path),
		}).open();
	}

	adjustPortrait(): void {
		const p = this.e?.media.portrait;
		if (p) adjustPortrait(this.ws, p, (r) => this.patch({ portrait: r }));
	}

	removePortrait(): void {
		const prev = this.e?.media.portrait;
		if (!prev) return;
		this.patch({ portrait: null });
		actionNotice('Portrait removed. The image stays in your vault.', { label: 'Undo', run: () => this.patch({ portrait: prev }) });
	}

	portraitMenu(evt: MouseEvent): void {
		const e = this.e;
		if (!e) return;
		if (!e.media.portrait) return this.pickPortrait();
		const p = e.media.portrait;
		const m = new Menu();
		m.addItem((i) => i.setTitle('Change portrait…').setIcon('replace').onClick(() => this.pickPortrait()));
		m.addItem((i) => i.setTitle('Adjust framing…').setIcon('crop').onClick(() => this.adjustPortrait()));
		m.addItem((i) => i.setTitle('View full size').setIcon('maximize-2').onClick(() => this.view(p, 'Portrait')));
		m.addSeparator();
		m.addItem((i) => i.setTitle('Remove portrait').setIcon('x').onClick(() => this.removePortrait()));
		m.showAtMouseEvent(evt);
	}

	// ── banner ──
	setBanner(path: string): void {
		const cur = this.e?.media.banner;
		this.patch({ banner: cur ? { ...cur, path } : { path, focalY: 0.5, height: BANNER_PRESETS.standard } });
	}

	setBannerProps(props: Partial<BannerRef>): void {
		const cur = this.e?.media.banner;
		if (cur) this.patch({ banner: { ...cur, ...props } });
	}

	pickBanner(): void {
		const e = this.e;
		if (!e) return;
		new ImageBrowser(this.ws, {
			title: `Choose a banner for ${e.name}`,
			current: e.media.banner?.path,
			sourcePath: this.sourcePath(),
			onPick: ([f]) => f && this.setBanner(f.path),
		}).open();
	}

	adjustBanner(): void {
		const b = this.e?.media.banner;
		if (b) adjustBanner(this.ws, b, (r) => this.patch({ banner: r }));
	}

	removeBanner(): void {
		const prev = this.e?.media.banner;
		if (!prev) return;
		this.patch({ banner: null });
		actionNotice('Banner removed. The image stays in your vault.', { label: 'Undo', run: () => this.patch({ banner: prev }) });
	}

	bannerMenu(evt: MouseEvent, reposition?: () => void): void {
		const e = this.e;
		if (!e) return;
		const b = e.media.banner;
		const m = new Menu();
		m.addItem((i) => i.setTitle(b ? 'Change banner…' : 'Add banner…').setIcon('image-plus').onClick(() => this.pickBanner()));
		if (b) {
			if (reposition) m.addItem((i) => i.setTitle('Reposition').setIcon('move').onClick(reposition));
			m.addItem((i) => i.setTitle('Adjust height & framing…').setIcon('crop').onClick(() => this.adjustBanner()));
			m.addSeparator();
			for (const [label, h] of Object.entries(BANNER_PRESETS)) {
				m.addItem((i) =>
					i
						.setTitle(`${label[0]?.toUpperCase()}${label.slice(1)} height`)
						.setChecked((b.height ?? BANNER_PRESETS.standard) === h)
						.onClick(() => this.setBannerProps({ height: h })),
				);
			}
			m.addSeparator();
			m.addItem((i) => i.setTitle('View full size').setIcon('maximize-2').onClick(() => this.view(b, 'Banner')));
			m.addItem((i) => i.setTitle('Remove banner').setIcon('x').onClick(() => this.removeBanner()));
		}
		m.showAtMouseEvent(evt);
	}

	private view(ref: ImageRef, what: string): void {
		const name = this.e?.name;
		new Lightbox(this.ws, { items: () => [ref], index: 0, title: name ? `${name} — ${what}` : fileNameOf(ref.path) }).open();
	}
}
