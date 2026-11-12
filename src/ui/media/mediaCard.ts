import { Keymap, Menu, Notice, setIcon, setTooltip } from 'obsidian';
import type { EntityRecord } from '../../core/types';
import { fileNameOf, folderOf } from '../../core/util/media';
import { vaultImage } from '../../fields/ui/media';
import { ROLE_LABELS, type MediaUsage } from '../../services/MediaRefs';
import { bannerPage } from './pageBanner';
import type { WorldSession } from '../../services/WorldSession';
import { ROUTES } from '../../state/route';
import { avatar } from '../components/avatar';
import { button, cx, icon } from '../components/dom';
import { actionNotice } from '../components/notice';
import type { RouteContext } from '../views/routes/RouteRegistry';
import { ImageBrowser } from './ImageBrowser';

/** One image in the media library: thumbnail, file, where it's used, and repair for missing files. */
export function mediaCard(parent: HTMLElement, ctx: RouteContext, s: WorldSession, path: string, uses: MediaUsage[], isMissing: boolean, view: () => void): void {
	const ws = ctx.ws;
	const el = parent.createDiv({ cls: cx('ws-media-card', isMissing && 'is-missing'), attr: { 'data-path': path } });
	const thumb = el.createEl('button', { cls: 'ws-media-card__thumb', attr: { type: 'button', 'aria-label': `View ${fileNameOf(path)}` } });
	vaultImage(thumb, ws.app, { path }, 'ws-media-card__img');
	thumb.addEventListener('click', view);
	const body = el.createDiv({ cls: 'ws-media-card__body' });
	const head = body.createDiv({ cls: 'ws-media-card__head' });
	const name = head.createDiv({ cls: 'ws-media-card__name', text: fileNameOf(path) });
	setTooltip(name, path, { delay: 400 });
	const more = head.createEl('button', { cls: 'ws-media-card__more', attr: { type: 'button', 'aria-label': 'Image options' } });
	setIcon(more, 'more-horizontal');
	more.addEventListener('click', (ev) => mediaMenu(ev, ctx, s, path, uses, isMissing));
	body.createDiv({ cls: 'ws-media-card__path', text: isMissing ? 'Missing from the vault' : folderOf(path) || 'Vault root' });

	const who = body.createDiv({ cls: 'ws-media-card__uses' });
	const seen = new Set<string>();
	for (const u of uses) {
		const key = `${u.entityId ?? u.page ?? 'world'}:${u.role}:${u.fieldId ?? ''}`;
		if (seen.has(key)) continue;
		seen.add(key);
		if (seen.size > 4) break;
		const e: EntityRecord | undefined = u.entityId ? s.entities.get(u.entityId) : undefined;
		const chip = who.createEl('button', { cls: 'ws-media-use', attr: { type: 'button' } });
		const page = !e && u.page ? bannerPage(s, u.page) : null;
		if (e) avatar(chip, ws.app, e, s.schemas.get(e.typeId), { size: 'xs' });
		else icon(chip, page?.icon ?? (s.world.icon || 'globe-2'), 'ws-media-use__world');
		chip.createSpan({ cls: 'ws-media-use__name', text: e?.name ?? page?.name ?? s.world.name });
		const roleText = u.role === 'field' && e ? (s.schemas.get(e.typeId)?.fields.find((f) => f.id === u.fieldId)?.label ?? 'Field') : ROLE_LABELS[u.role];
		chip.createSpan({ cls: 'ws-media-use__role', text: roleText });
		chip.addEventListener('click', (ev) => (e ? ctx.navigate(ROUTES.entity(e.id), Keymap.isModEvent(ev)) : ctx.navigate(page?.route ?? ROUTES.dashboard(), Keymap.isModEvent(ev))));
	}
	const distinct = new Set(uses.map((u) => `${u.entityId ?? u.page ?? 'world'}:${u.role}:${u.fieldId ?? ''}`)).size;
	if (distinct > 4) who.createDiv({ cls: 'ws-media-card__more-uses', text: `and ${distinct - 4} more` });

	if (isMissing) {
		const all = ws.media.images().map((f) => f.path);
		const cands = s.media.candidates(path, all);
		const fix = body.createDiv({ cls: 'ws-media-card__fix' });
		if (cands.length === 1) {
			button(fix, { label: 'Relink', icon: 'link', variant: 'primary', size: 'sm', tooltip: `Use ${cands[0]}`, onClick: () => relinkTo(s, path, cands[0] as string) });
		}
		button(fix, { label: cands.length === 1 ? 'Other…' : 'Find image…', icon: cands.length === 1 ? undefined : 'search', variant: 'ghost', size: 'sm', onClick: () => chooseReplacement(ctx, s, path) });
	}
}

function relinkTo(s: WorldSession, from: string, to: string): void {
	const n = s.media.relink(from, to);
	actionNotice(`Relinked ${n} reference${n === 1 ? '' : 's'} to ${fileNameOf(to)}.`, { label: 'Undo', run: () => s.media.relink(to, from) });
}

function chooseReplacement(ctx: RouteContext, s: WorldSession, path: string): void {
	new ImageBrowser(ctx.ws, {
		title: `Replace ${fileNameOf(path)} everywhere`,
		onPick: ([f]) => f && f.path !== path && relinkTo(s, path, f.path),
	}).open();
}

export function mediaMenu(ev: MouseEvent, ctx: RouteContext, s: WorldSession, path: string, uses: MediaUsage[], isMissing: boolean): void {
	const ws = ctx.ws;
	const m = new Menu();
	if (!isMissing) {
		m.addItem((i) =>
			i.setTitle('Open in Obsidian').setIcon('external-link').onClick(() => {
				const f = ws.app.vault.getFileByPath(path);
				if (f) void ws.app.workspace.getLeaf('tab').openFile(f);
			}),
		);
	}
	m.addItem((i) => i.setTitle(isMissing ? 'Find image…' : 'Replace everywhere…').setIcon('replace').onClick(() => chooseReplacement(ctx, s, path)));
	m.addItem((i) =>
		i.setTitle('Copy path').setIcon('copy').onClick(() => {
			void navigator.clipboard?.writeText(path);
			new Notice('Path copied');
		}),
	);
	const entries = [...new Set(uses.map((u) => u.entityId).filter((x): x is string => !!x))];
	if (entries.length) {
		m.addSeparator();
		for (const id of entries.slice(0, 8)) {
			const e = s.entities.get(id);
			if (e) m.addItem((i) => i.setTitle(`Open ${e.name}`).setIcon('arrow-up-right').onClick(() => ctx.navigate(ROUTES.entity(e.id))));
		}
	}
	m.showAtMouseEvent(ev);
}
