import { Menu, setTooltip } from 'obsidian';
import type { EntityRecord } from '../../core/types';
import { vaultImage } from '../../fields/ui/media';
import { ROUTES } from '../../state/route';
import { entityMenu } from '../../ui/actions';
import { customizePage } from '../../ui/views/routes/entityPage';
import { avatar } from '../../ui/components/avatar';
import { autoGrow, button, icon, progressRing, statusPill, cx } from '../../ui/components/dom';
import { EntityMediaActions } from '../../ui/media/entityMedia';
import { imageDropTarget } from '../../ui/media/drop';
import { BANNER_PRESETS } from '../../core/util/media';
import type { BlockDefinition, BlockRenderContext } from '../BlockRegistry';
import { currentEntity, watchEntity } from '../util';
import { openNotePopover } from '../../ui/notes/noteActions';

/**
 * The entity header: banner, arched portrait, name, breadcrumb, subtitle, status,
 * development progress and actions. Each part patches itself on change; editing the name
 * never re-renders the block.
 */
export const heroBlock: BlockDefinition = {
	id: 'hero',
	category: 'Basics',
	singleton: true,
	name: 'Hero header',
	icon: 'panel-top',
	description: 'Banner, portrait, name and status.',
	surfaces: ['entity'],
	frame: 'plain',
	defaultSize: { w: 12, h: 1 },
	defaultConfig: { showBanner: true },
	render(ctx) {
		const entity = ctx.entity;
		const schema = ctx.schema;
		if (!entity) return;
		const s = ctx.session;
		const root = ctx.el.createDiv({ cls: 'ws-hero' });

		// ── banner ──────────────────────────────────────────────────────────────
		const media = new EntityMediaActions(ctx.ws, s, entity.id);
		const bannerEl = root.createDiv({ cls: 'ws-hero__banner' });
		const paintBanner = (e: EntityRecord) => {
			bannerEl.empty();
			const b = e.media.banner;
			root.toggleClass('has-banner', !!b);
			if (!b) {
				bannerEl.setCssStyles({ height: '' });
				return;
			}
			bannerEl.style.height = `${b.height ?? BANNER_PRESETS.standard}px`;
			vaultImage(bannerEl, ctx.app, b, 'ws-hero__banner-img');
			const tools = bannerEl.createDiv({ cls: 'ws-hero__banner-tools' });
			button(tools, { icon: 'image', label: 'Banner', variant: 'ghost', size: 'sm', onClick: (evt) => media.bannerMenu(evt, startReposition) });
		};

		/** Drag the image to choose what shows; Done, Enter or Escape to finish. */
		const startReposition = () => {
			const img = bannerEl.querySelector('img');
			if (!img || bannerEl.hasClass('is-repositioning')) return;
			bannerEl.addClass('is-repositioning');
			const hint = bannerEl.createDiv({ cls: 'ws-hero__reposition' });
			icon(hint, 'move');
			hint.createSpan({ text: 'Drag the image to reposition' });
			const done = button(hint, { label: 'Done', variant: 'primary', size: 'sm' });
			const start = currentEntity(ctx)?.media.banner;
			let fx = start?.focalX ?? 0.5;
			let fy = start?.focalY ?? 0.5;
			const z = start?.zoom ?? 1;
			let sx = 0;
			let sy = 0;
			let sfx = fx;
			let sfy = fy;
			// How far (px) the image can travel inside the frame on each axis.
			const travel = () => {
				const fw = bannerEl.clientWidth;
				const fh = bannerEl.clientHeight;
				const iw = img.naturalWidth || fw;
				const ih = img.naturalHeight || fh;
				const sc = Math.max(fw / iw, fh / ih) * z;
				return { x: Math.max(1, iw * sc - fw), y: Math.max(1, ih * sc - fh) };
			};
			const apply = () => {
				img.style.objectPosition = `${fx * 100}% ${fy * 100}%`;
				img.style.transformOrigin = `${fx * 100}% ${fy * 100}%`;
			};
			const onMove = (ev: PointerEvent) => {
				const t = travel();
				fx = Math.max(0, Math.min(1, sfx - (ev.clientX - sx) / t.x));
				fy = Math.max(0, Math.min(1, sfy - (ev.clientY - sy) / t.y));
				apply();
			};
			const onUp = () => {
				window.removeEventListener('pointermove', onMove);
				window.removeEventListener('pointerup', onUp);
				bannerEl.removeClass('is-grabbing');
			};
			const onDown = (ev: PointerEvent) => {
				if ((ev.target as HTMLElement).closest('button')) return;
				ev.preventDefault();
				sx = ev.clientX;
				sy = ev.clientY;
				sfx = fx;
				sfy = fy;
				bannerEl.addClass('is-grabbing');
				window.addEventListener('pointermove', onMove);
				window.addEventListener('pointerup', onUp);
			};
			const finish = (save: boolean) => {
				bannerEl.removeEventListener('pointerdown', onDown);
				window.removeEventListener('keydown', onKey, true);
				onUp();
				bannerEl.removeClass('is-repositioning');
				hint.remove();
				if (save) media.setBannerProps({ focalX: Math.round(fx * 1000) / 1000, focalY: Math.round(fy * 1000) / 1000 });
				else {
					const e = currentEntity(ctx);
					if (e) paintBanner(e);
				}
			};
			const onKey = (ev: KeyboardEvent) => {
				if (ev.key === 'Enter') finish(true);
				else if (ev.key === 'Escape') {
					ev.stopPropagation();
					finish(false);
				} else if (ev.key.startsWith('Arrow')) {
					const st = ev.shiftKey ? 0.1 : 0.02;
					if (ev.key === 'ArrowLeft') fx = Math.max(0, fx - st);
					if (ev.key === 'ArrowRight') fx = Math.min(1, fx + st);
					if (ev.key === 'ArrowUp') fy = Math.max(0, fy - st);
					if (ev.key === 'ArrowDown') fy = Math.min(1, fy + st);
					ev.preventDefault();
					apply();
				}
			};
			bannerEl.addEventListener('pointerdown', onDown);
			window.addEventListener('keydown', onKey, true);
			done.addEventListener('click', () => finish(true));
			ctx.component.register(() => {
				window.removeEventListener('keydown', onKey, true);
				onUp();
			});
		};

		// ── body ────────────────────────────────────────────────────────────────
		const body = root.createDiv({ cls: 'ws-hero__body' });
		const portraitSlot = body.createDiv({ cls: 'ws-hero__portrait' });
		const text = body.createDiv({ cls: 'ws-hero__text' });
		const crumbs = text.createDiv({ cls: 'ws-hero__crumbs' });
		const kind = text.createDiv({ cls: cx('ws-hero__kind', schema?.color ? `ws-tint--${schema.color}` : '') });
		icon(kind, schema?.icon ?? 'box');
		kind.createSpan({ text: schema?.singular ?? 'Entity' });

		const name = text.createEl('textarea', {
			cls: 'ws-hero__name',
			attr: { rows: '1', spellcheck: 'false', 'aria-label': 'Name' },
		});
		name.value = entity.name;
		const growName = autoGrow(name);
		name.addEventListener('keydown', (e) => {
			if (e.key === 'Enter') {
				e.preventDefault();
				name.blur();
			}
			if (e.key === 'Escape') {
				name.value = currentEntity(ctx)?.name ?? name.value;
				name.blur();
			}
		});
		name.addEventListener('blur', () => {
			const e = currentEntity(ctx);
			if (e && name.value.trim() !== e.name) s.entityService.update(e.id, { name: name.value });
		});

		const subtitle = text.createDiv({ cls: 'ws-hero__subtitle' });
		const meta = text.createDiv({ cls: 'ws-hero__meta' });
		const statusSlot = meta.createDiv({ cls: 'ws-hero__status' });
		const ringSlot = meta.createDiv({ cls: 'ws-hero__progress' });
		const ring = progressRing(ringSlot, 0, 30);
		const ringLabel = ringSlot.createSpan({ cls: 'ws-hero__progress-label' });
		const badges = meta.createDiv({ cls: 'ws-hero__badges' });

		const actions = body.createDiv({ cls: 'ws-hero__actions' });
		const fav = button(actions, { icon: 'star', variant: 'quiet', tooltip: 'Favorite', onClick: () => s.entityService.toggleFavorite(entity.id) });
		const noteBtn = button(actions, {
			icon: 'file-text',
			variant: 'quiet',
			tooltip: 'Note',
			cls: 'ws-hero__note-btn',
			onClick: (evt) => {
				const e = currentEntity(ctx);
				// The note popover (0.17.2): native notes first, then the linked notes.
				if (e) openNotePopover(ctx.ws, e, (evt.currentTarget as HTMLElement | null) ?? noteBtn);
			},
		});
		button(actions, {
			icon: 'image',
			variant: 'quiet',
			tooltip: 'Banner',
			cls: 'ws-hero__banner-btn',
			onClick: (evt) => media.bannerMenu(evt, startReposition),
		});
		if (!ctx.editing) {
			button(actions, {
				icon: 'layout-grid',
				variant: 'quiet',
				tooltip: 'Customize this page',
				cls: 'ws-hero__customize',
				onClick: () => customizePage(root),
			});
		}
		button(actions, {
			icon: 'more-horizontal',
			variant: 'quiet',
			tooltip: 'More',
			onClick: (evt) => {
				const e = currentEntity(ctx);
				if (e) entityMenu(ctx.ws, e, { onPage: true, onCustomize: ctx.editing ? undefined : () => customizePage(root) }).showAtMouseEvent(evt);
			},
		});

		const paintPortrait = (e: EntityRecord) => {
			portraitSlot.empty();
			const frame = portraitSlot.createEl('button', {
				cls: 'ws-hero__portrait-btn',
				attr: { type: 'button', 'aria-label': e.media.portrait ? 'Portrait options' : 'Add portrait' },
			});
			if (e.media.portrait) {
				avatar(frame, ctx.app, e, schema, { shape: 'arch', size: 'xl' });
			} else {
				const ph = frame.createDiv({ cls: ['ws-avatar', 'ws-avatar--arch', 'ws-avatar--xl', 'ws-portrait-placeholder', schema?.color ? `ws-tint--${schema.color}` : 'ws-tint--gray'] });
				icon(ph, 'image-plus', 'ws-portrait-placeholder__icon');
				ph.createSpan({ cls: 'ws-portrait-placeholder__label', text: 'Add portrait' });
			}
			frame.addEventListener('click', (evt) => media.portraitMenu(evt));
		};
		// Drop an image on the portrait to use it; anywhere else on the header for the banner.
		imageDropTarget(portraitSlot, ctx.ws, { label: 'Drop to set the portrait', single: true, onImages: ([f]) => f && media.setPortrait(f.path), sourcePath: () => currentEntity(ctx)?.linkedNote?.path });
		imageDropTarget(root, ctx.ws, {
			label: 'Drop to set the banner',
			single: true,
			accept: (ev) => !portraitSlot.contains(ev.target as Node),
			onImages: ([f]) => f && media.setBanner(f.path),
			sourcePath: () => currentEntity(ctx)?.linkedNote?.path,
		});

		const paintCrumbs = (e: EntityRecord) => {
			crumbs.empty();
			const chain: EntityRecord[] = [];
			let p = e.parentId ? s.entities.get(e.parentId) : undefined;
			const seen = new Set<string>([e.id]);
			while (p && !seen.has(p.id) && chain.length < 8) {
				chain.unshift(p);
				seen.add(p.id);
				p = p.parentId ? s.entities.get(p.parentId) : undefined;
			}
			crumbs.toggleClass('is-empty', chain.length === 0);
			for (const a of chain) {
				const link = crumbs.createEl('a', { cls: 'ws-hero__crumb', text: a.name, attr: { href: '#' } });
				link.addEventListener('click', (evt) => {
					evt.preventDefault();
					ctx.navigate(ROUTES.entity(a.id), evt.metaKey || evt.ctrlKey);
				});
				icon(crumbs, 'chevron-right', 'ws-hero__crumb-sep');
			}
		};

		const paintStatus = (e: EntityRecord) => {
			statusSlot.empty();
			const world = s.world;
			const btn = statusSlot.createEl('button', { cls: 'ws-status-btn', attr: { type: 'button', 'aria-label': 'Change status' } });
			statusPill(btn, world.statuses.find((x) => x.id === e.status));
			btn.addEventListener('click', () => {
				const menu = new Menu();
				for (const st of world.statuses) {
					menu.addItem((i) =>
						i
							.setTitle(st.label)
							.setIcon(st.icon ?? 'circle')
							.setChecked(st.id === e.status)
							.onClick(() => s.entityService.update(e.id, { status: st.id })),
					);
				}
				const r = btn.getBoundingClientRect();
				menu.showAtPosition({ x: r.left, y: r.bottom + 4 });
			});
		};

		const paintMeta = (e: EntityRecord) => {
			const sub = s.entityService.subtitle(e);
			subtitle.setText(sub);
			subtitle.toggleClass('is-empty', !sub);
			const c = s.entityService.progress(e);
			ring.set(c.ratio);
			ringLabel.setText(`${Math.round(c.ratio * 100)}% developed`);
			const parts = [`${c.fields.done} of ${c.fields.total} key details`];
			if (c.tasks.total) parts.push(`${c.tasks.done} of ${c.tasks.total} tasks done`);
			setTooltip(ringSlot, parts.join(' · '), { delay: 300 });
			fav.toggleClass('is-active', !!e.flags.favorite);
			fav.setAttr('aria-pressed', String(!!e.flags.favorite));
			setTooltip(fav, e.flags.favorite ? 'Remove from favorites' : 'Add to favorites');
			noteBtn.toggleClass('is-active', !!e.linkedNote);
			noteBtn.toggleClass('has-native-note', !!e.nativeNote);
			noteBtn.toggleClass('has-note-issue', !!e.nativeNote && (e.nativeNote.status !== 'ok' || !!e.nativeNote.conflicts?.length));
			if (e.nativeNote) setTooltip(noteBtn, e.nativeNote.status === 'missing' ? 'Native note not found' : e.nativeNote.conflicts?.length ? 'Native note: needs a decision' : 'Native note');
			else setTooltip(noteBtn, 'Note');
			badges.empty();
			if (e.archivedAt) badges.createSpan({ cls: 'ws-badge', text: 'Archived' });
			if (e.flags.pinned) {
				const b = badges.createSpan({ cls: 'ws-badge' });
				icon(b, 'pin');
				b.createSpan({ text: 'Pinned' });
			}
		};

		const paintAll = (e: EntityRecord) => {
			paintBanner(e);
			paintPortrait(e);
			paintCrumbs(e);
			paintStatus(e);
			paintMeta(e);
		};
		paintAll(entity);

		watchEntity(ctx, (e, keys) => {
			if (keys.includes('media')) {
				paintBanner(e);
				paintPortrait(e);
			}
			if (keys.includes('name') && document.activeElement !== name) {
				name.value = e.name;
				growName();
			}
			if (keys.includes('parentId')) paintCrumbs(e);
			if (keys.includes('status')) paintStatus(e);
			paintMeta(e);
		});
		// Ancestors renamed elsewhere → refresh breadcrumb.
		ctx.component.register(
			s.events.on('entity:updated', ({ entity: other, change }) => {
				if (other.id !== entity.id && change.keys.includes('name')) {
					const e = currentEntity(ctx);
					if (e) paintCrumbs(e);
				}
			}).dispose,
		);
		// Subtitle and development ring may include linked fields.
		const touches = (edge: { from: string; to: string }) => edge.from === entity.id || edge.to === entity.id;
		const repaintMeta = () => {
			const e = currentEntity(ctx);
			if (e) paintMeta(e);
		};
		for (const ev of ['edge:created', 'edge:deleted', 'edge:updated'] as const) {
			const d = s.events.on(ev, ({ edge }) => touches(edge) && repaintMeta());
			ctx.component.register(() => d.dispose());
		}
		for (const ev of ['task:created', 'task:deleted', 'task:updated'] as const) {
			const d = s.events.on(ev, ({ task }) => task.entityId === entity.id && repaintMeta());
			ctx.component.register(() => d.dispose());
		}
		const dw = s.events.on('world:updated', ({ keys }) => keys.includes('progress') && repaintMeta());
		ctx.component.register(() => dw.dispose());
		ctx.component.register(
			s.events.on('world:updated', ({ keys }) => {
				const e = currentEntity(ctx);
				if (e && keys.includes('statuses')) paintStatus(e);
			}).dispose,
		);
	},
};

export type { BlockRenderContext };
