import { Notice, setIcon } from 'obsidian';
import type { WorldsmithContext } from '../../../app/context';
import { HEALTH_CHECKS, runHealth, type HealthCheck, type HealthFinding, type HealthReport } from '../../../services/health';
import type { WorldSession } from '../../../services/WorldSession';
import { ROUTES, type Route } from '../../../state/route';
import { button, cx, icon, nameRegion, progressRing } from '../../components/dom';
import { own } from '../../components/lifecycle';
import { actionNotice } from '../../components/notice';
import type { RouteContext, RouteDefinition } from './RouteRegistry';
import { mountToolBanner } from '../../media/pageBanner';

/**
 * World health (0.10): a score, then every check with what it found. Each finding has a
 * way to fix it — a fix that never deletes anything (and offers Undo) or a link to where
 * it's fixed — and can be ignored.
 */
export const healthRoute: RouteDefinition = {
	id: 'health',
	needsWorld: true,
	title: () => 'World health',
	icon: () => 'heart-pulse',
	render(ctx) {
		new HealthPage(ctx).mount();
	},
};

export function healthReport(ws: WorldsmithContext, s: WorldSession): HealthReport {
	const folder = ws.settings.media.useAttachmentFolder ? '' : ws.settings.media.folder.replace(/\/+$/, '');
	return runHealth(s, {
		fieldTypes: ws.fieldTypes,
		exists: (p) => ws.media.exists(p),
		worldImages: () => (folder ? ws.media.images().map((f) => f.path).filter((p) => p.startsWith(`${folder}/`)) : []),
	});
}

export function healthWord(score: number): string {
	return score >= 90 ? 'In great shape' : score >= 75 ? 'A few loose ends' : score >= 50 ? 'Worth some care' : 'Needs attention';
}

const PAGE = 8;

class HealthPage {
	private report!: HealthReport;
	private expanded = new Set<string>();
	private showIgnored = false;
	private focus: string | null;
	private queued = false;
	private page!: HTMLElement;

	/** Set once the page is left: a late timer must not draw into the next page. */
	private dead = false;

	constructor(private readonly ctx: RouteContext) {
		own(ctx.component, { dispose: () => (this.dead = true) });
		this.focus = ctx.params.show ?? null;
	}

	private get s(): WorldSession {
		return this.ctx.session!;
	}

	mount(): void {
		// Built once: only its contents redraw, so the page never re-plays its entrance.
		this.page = this.ctx.el.createDiv({ cls: 'ws-page ws-hl' });
		this.render();
		const later = () => this.queue();
		const ev = this.s.events;
		const c = this.ctx.component;
		for (const e of ['entity:created', 'entity:deleted', 'entity:updated', 'schema:created', 'schema:updated', 'schema:deleted', 'edge:created', 'edge:updated', 'edge:deleted', 'calendar:saved'] as const) own(c, ev.on(e as 'entity:created', later));
		own(c, ev.on('doc:saved', ({ kind }) => kind === 'map' && later()));
		own(c, ev.on('doc:deleted', ({ kind }) => kind === 'map' && later()));
		own(c, ev.on('world:updated', ({ keys }) => keys.some((k) => k === 'health' || k === 'sidebar' || k === 'timeline' || k === 'banner' || k === 'pageBanners') && later()));
	}

	private queue(): void {
		if (this.queued) return;
		this.queued = true;
		window.setTimeout(() => {
			this.queued = false;
			if (this.dead || !this.ctx.el.isConnected) return;
			// Not while its banner is being repositioned: that would drop the drag.
			if (this.page.querySelector('.is-repositioning')) return this.queue();
			this.render();
		}, 200);
	}

	private go(route: Route, e?: MouseEvent): void {
		this.ctx.navigate(route, e && (e.metaKey || e.ctrlKey) ? 'tab' : false);
	}

	private render(): void {
		const page = this.page;
		const scroller = page.closest('.ws-shell__page');
		const scroll = scroller?.scrollTop ?? 0;
		const h = page.offsetHeight;
		if (h) page.style.minHeight = `${h}px`;
		page.empty();
		this.report = healthReport(this.ctx.ws, this.s);
		const r = this.report;

		const head = page.createDiv({ cls: 'ws-studio-head' });
		const mark = head.createDiv({ cls: 'ws-db-header__mark ws-tint--green' });
		icon(mark, 'heart-pulse');
		const ht = head.createDiv({ cls: 'ws-db-header__text' });
		ht.createEl('h1', { cls: 'ws-db-header__title', text: 'World health' });
		ht.createDiv({ cls: 'ws-db-header__desc', text: 'Loose ends and broken links in your world, each with a fix. Nothing here is ever deleted.' });
		mountToolBanner(this.ctx, head, 'health');

		// ── Score.
		const hero = page.createDiv({ cls: cx('ws-hl__hero', r.score >= 90 ? 'ws-tint--green' : r.score >= 75 ? 'ws-tint--cyan' : r.score >= 50 ? 'ws-tint--yellow' : 'ws-tint--orange') });
		const ring = progressRing(hero, r.score / 100, 92);
		ring.el.addClass('ws-hl__ring');
		ring.el.setAttr('aria-label', `Health score ${r.score} out of 100`);
		const ht2 = hero.createDiv({ cls: 'ws-hl__hero-text' });
		ht2.createDiv({ cls: 'ws-hl__word', text: healthWord(r.score) });
		const counted = r.findings.filter((f) => (HEALTH_CHECKS.find((c) => c.id === f.check)?.weight ?? 0) > 0).length;
		ht2.createDiv({ cls: 'ws-hl__summary', text: counted ? `${counted} thing${counted === 1 ? '' : 's'} to look at across ${r.entries} entr${r.entries === 1 ? 'y' : 'ies'}.` : `Nothing to fix across ${r.entries} entr${r.entries === 1 ? 'y' : 'ies'}.` });
		if (r.ignored.length) ht2.createDiv({ cls: 'ws-hl__ignored-note', text: `${r.ignored.length} ignored` });

		// ── Overview tiles.
		const tiles = page.createDiv({ cls: 'ws-hl__tiles', attr: { role: 'list' } });
		nameRegion(tiles, 'Checks');
		for (const c of HEALTH_CHECKS) {
			const n = r.byCheck.get(c.id)?.length ?? 0;
			const t = tiles.createEl('button', { cls: cx('ws-hl__tile', !n && 'is-clear', !c.weight && 'is-info', this.focus === c.id && 'is-focus'), attr: { type: 'button', role: 'listitem', 'data-check': c.id } });
			const ic = t.createSpan({ cls: 'ws-hl__tile-icon' });
			setIcon(ic, n ? c.icon : 'check');
			t.createSpan({ cls: 'ws-hl__tile-n', text: n ? String(n) : '0' });
			t.createSpan({ cls: 'ws-hl__tile-label', text: c.label });
			t.addEventListener('click', () => {
				const sec = page.querySelector<HTMLElement>(`.ws-hl__section[data-check="${c.id}"]`);
				if (!sec) return;
				sec.scrollIntoView({ behavior: 'smooth', block: 'start' });
				sec.addClass('is-flash');
				window.setTimeout(() => sec.removeClass('is-flash'), 900);
			});
		}

		// ── Sections, most serious first; checks with nothing found fold into one line.
		const list = page.createDiv({ cls: 'ws-hl__sections' });
		const clear: HealthCheck[] = [];
		for (const c of HEALTH_CHECKS) {
			const found = r.byCheck.get(c.id) ?? [];
			if (!found.length) {
				clear.push(c);
				continue;
			}
			this.section(list, c, found);
		}
		if (clear.length) {
			const ok = list.createDiv({ cls: 'ws-hl__clear' });
			icon(ok, 'check-circle-2');
			ok.createSpan({ text: `All clear: ${clear.map((c) => c.label.toLowerCase()).join(', ')}.` });
		}

		if (r.ignored.length) {
			const ig = page.createDiv({ cls: cx('ws-hl__ignored', this.showIgnored && 'is-open') });
			const b = ig.createEl('button', { cls: 'ws-hl__ignored-head', attr: { type: 'button', 'aria-expanded': String(this.showIgnored) } });
			icon(b, 'eye-off');
			b.createSpan({ text: `Ignored (${r.ignored.length})` });
			icon(b, 'chevron-down', 'ws-hl__caret');
			b.addEventListener('click', () => {
				this.showIgnored = !this.showIgnored;
				this.render();
			});
			if (this.showIgnored) {
				const rows = ig.createDiv({ cls: 'ws-hl__rows' });
				for (const f of r.ignored) {
					const row = rows.createDiv({ cls: 'ws-hl__row is-ignored' });
					const tx = row.createDiv({ cls: 'ws-hl__row-text' });
					tx.createDiv({ cls: 'ws-hl__row-title', text: f.title });
					tx.createDiv({ cls: 'ws-hl__row-detail', text: `${HEALTH_CHECKS.find((c) => c.id === f.check)?.label ?? ''} · ${f.detail ?? ''}` });
					const acts = row.createDiv({ cls: 'ws-hl__row-actions' });
					button(acts, { label: 'Stop ignoring', icon: 'eye', variant: 'quiet', size: 'sm', onClick: () => this.setIgnored(f, false) });
				}
			}
		}

		page.setCssStyles({ minHeight: '' });
		if (scroller) scroller.scrollTop = scroll;
		if (this.focus) {
			const sec = page.querySelector<HTMLElement>(`.ws-hl__section[data-check="${this.focus}"]`);
			this.focus = null;
			if (sec) window.requestAnimationFrame(() => sec.scrollIntoView({ block: 'start' }));
		}
	}

	private section(parent: HTMLElement, c: HealthCheck, found: HealthFinding[]): void {
		const sec = parent.createEl('section', { cls: cx('ws-hl__section', !c.weight && 'is-info'), attr: { 'data-check': c.id } });
		const head = sec.createDiv({ cls: 'ws-hl__section-head' });
		const ic = head.createSpan({ cls: 'ws-hl__section-icon' });
		setIcon(ic, c.icon);
		const t = head.createDiv({ cls: 'ws-hl__section-text' });
		const title = t.createDiv({ cls: 'ws-hl__section-title' });
		title.createSpan({ text: c.label });
		title.createSpan({ cls: 'ws-hl__count', text: String(found.length) });
		t.createDiv({ cls: 'ws-hl__section-hint', text: c.hint });
		if (c.id === 'broken-images') button(head, { label: 'Relink in Media', icon: 'images', variant: 'ghost', size: 'sm', onClick: (e) => this.go(ROUTES.media('missing'), e) });
		const rows = sec.createDiv({ cls: 'ws-hl__rows' });
		const all = this.expanded.has(c.id);
		for (const f of all ? found : found.slice(0, PAGE)) this.row(rows, c, f);
		if (found.length > PAGE) {
			const more = sec.createDiv({ cls: 'ws-hl__more' });
			button(more, {
				label: all ? 'Show fewer' : `Show all ${found.length}`,
				icon: all ? 'chevron-up' : 'chevron-down',
				variant: 'quiet',
				size: 'sm',
				onClick: () => {
					if (all) this.expanded.delete(c.id);
					else this.expanded.add(c.id);
					this.render();
				},
			});
		}
	}

	private row(parent: HTMLElement, c: HealthCheck, f: HealthFinding): void {
		const s = this.s;
		const row = parent.createDiv({ cls: 'ws-hl__row', attr: { 'data-finding': f.id } });
		const e = f.entityId ? s.entities.get(f.entityId) : undefined;
		const schema = e ? s.schemas.get(e.typeId) : f.typeId ? s.schemas.get(f.typeId) : undefined;
		const g = row.createSpan({ cls: cx('ws-hl__row-icon', schema?.color && `ws-tint--${schema.color}`) });
		setIcon(g, schema?.icon ?? c.icon);
		const tx = row.createDiv({ cls: 'ws-hl__row-text' });
		const name = tx.createEl(e ? 'button' : 'div', { cls: 'ws-hl__row-title', text: f.title });
		if (e) {
			name.setAttr('type', 'button');
			name.addEventListener('click', (ev) => this.go(ROUTES.entity(e.id), ev as MouseEvent));
		}
		if (f.detail) tx.createDiv({ cls: 'ws-hl__row-detail', text: f.detail });
		const acts = row.createDiv({ cls: 'ws-hl__row-actions' });
		this.fixes(acts, c, f);
		button(acts, { icon: 'eye-off', variant: 'quiet', size: 'sm', tooltip: 'Ignore this', cls: 'ws-hl__ignore', onClick: () => this.setIgnored(f, true) });
	}

	/** The fix buttons for one finding. */
	private fixes(acts: HTMLElement, c: HealthCheck, f: HealthFinding): void {
		const s = this.s;
		const fix = (label: string, ic: string, run: (e: MouseEvent) => void, primary = true) => button(acts, { label, icon: ic, variant: primary ? 'default' : 'quiet', size: 'sm', cls: 'ws-hl__fix', onClick: run });
		const open = (label = 'Open') => f.entityId && fix(label, 'arrow-up-right', (e) => this.go(ROUTES.entity(f.entityId!), e));
		switch (c.id) {
			case 'missing-fields':
				open('Fill in');
				break;
			case 'orphans':
				open('Connect');
				break;
			case 'unused-data':
				open('Review');
				break;
			case 'broken-images':
				fix('Relink', 'link', (e) => this.go(ROUTES.media('missing'), e));
				break;
			case 'unused-images':
				fix('Media library', 'images', (e) => this.go(ROUTES.media(), e), false);
				break;
			case 'missing-notes': {
				fix('Unlink', 'unlink', () => {
					const cur = f.entityId ? s.entities.get(f.entityId) : undefined;
					if (!cur || !f.path) return;
					const before = this.ctx.ws.linkedNotes.unlink(cur, f.path);
					if (before) actionNotice(`Unlinked the missing note from “${cur.name}”. The entry is unchanged otherwise.`, { label: 'Undo', run: () => s.entityService.update(cur.id, before) });
				});
				open();
				break;
			}
			case 'map-links': {
				const trashed = f.entityIds?.[0] ? s.entities.get(f.entityIds[0]) : undefined;
				if (trashed?.trashedAt) {
					fix(`Restore “${trashed.name}”`, 'archive-restore', () => {
						s.entityService.restore(trashed.id);
						actionNotice(`Restored “${trashed.name}” from the trash.`, { label: 'Undo', run: () => s.entityService.trash(trashed.id) });
					});
				}
				if (f.mapId) fix('Open map', 'map', (e) => this.go(ROUTES.maps(f.mapId, f.itemId), e), !trashed?.trashedAt);
				break;
			}
			case 'broken-links': {
				const trashed = f.entityIds?.[0] ? s.entities.get(f.entityIds[0]) : undefined;
				if (trashed?.trashedAt) {
					fix(`Restore “${trashed.name}”`, 'archive-restore', () => {
						s.entityService.restore(trashed.id);
						actionNotice(`Restored “${trashed.name}” from the trash.`, { label: 'Undo', run: () => s.entityService.trash(trashed.id) });
					});
				}
				open();
				break;
			}
			case 'empty-types': {
				const t = f.typeId ? s.schemas.get(f.typeId) : undefined;
				if (!t) break;
				fix(`New ${t.singular.toLowerCase()}`, 'plus', (e) => this.go(ROUTES.database(t.id), e));
				const key = `type:${t.id}`;
				if (!s.world.sidebar.hidden.includes(key)) {
					fix('Hide from sidebar', 'eye-off', () => {
						const sb = s.world.sidebar;
						s.updateWorld({ sidebar: { ...sb, hidden: [...sb.hidden, key] } });
						actionNotice(`Hid ${t.plural} from the sidebar.`, { label: 'Undo', run: () => s.updateWorld({ sidebar: { ...s.world.sidebar, hidden: s.world.sidebar.hidden.filter((x) => x !== key) } }) });
					}, false);
				}
				break;
			}
			case 'dates': {
				if (f.edgeId) {
					const edge = s.relations.edge(f.edgeId);
					if (edge?.start && edge.end) {
						fix('Swap dates', 'arrow-left-right', () => {
							const { start, end } = edge;
							s.relations.updateEdge(edge.id, { start: end, end: start });
							actionNotice('Swapped the connection’s dates.', { label: 'Undo', run: () => s.relations.updateEdge(edge.id, { start, end }) });
						});
					}
				} else if (f.entityId && f.fieldIds?.length === 2) {
					const [a, b] = f.fieldIds as [string, string];
					fix('Swap dates', 'arrow-left-right', () => {
						const cur = s.entities.get(f.entityId!);
						if (!cur) return;
						const va = cur.values[a];
						const vb = cur.values[b];
						s.entityService.update(cur.id, { values: { [a]: vb, [b]: va } });
						actionNotice(`Swapped the dates on “${cur.name}”.`, { label: 'Undo', run: () => s.entityService.update(cur.id, { values: { [a]: va, [b]: vb } }) });
					});
				}
				open();
				break;
			}
			case 'duplicates':
				for (const [i, id] of (f.entityIds ?? []).slice(0, 3).entries()) {
					const x = s.entities.get(id);
					if (x) fix(i === 0 ? 'Open first' : i === 1 ? 'Open second' : 'Open third', 'arrow-up-right', (e) => this.go(ROUTES.entity(x.id), e), i === 0);
				}
				break;
		}
	}

	private setIgnored(f: HealthFinding, on: boolean): void {
		const h = this.s.world.health;
		const next = on ? [...new Set([...h.ignored, f.id])] : h.ignored.filter((x) => x !== f.id);
		this.s.updateWorld({ health: { ...h, ignored: next } });
		if (on) actionNotice(`Ignoring “${f.title}”.`, { label: 'Undo', run: () => this.setIgnored(f, false) });
		else new Notice(`“${f.title}” is back on the list.`);
	}
}
