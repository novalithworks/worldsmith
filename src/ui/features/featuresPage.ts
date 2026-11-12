import { EDITION, isLocked, openProPage } from '../../app/edition';
import { FEATURES, featureOn, type FeatureDef, type FeatureId } from '../../core/features';
import type { WorldSession } from '../../services/WorldSession';
import { ROUTES } from '../../state/route';
import { button, cx, icon } from '../components/dom';
import { actionNotice } from '../components/notice';
import type { RouteContext, RouteDefinition } from '../views/routes/RouteRegistry';

/**
 * World features (0.29): a page of switches for the parts of Worldsmith this world uses.
 * Off hides a part everywhere and deletes nothing; each card says what's kept and how much
 * of it there is. Pages of a part that's off say so, with a way to turn it back on.
 */

export const featuresRoute: RouteDefinition = {
	id: 'features',
	needsWorld: true,
	title: () => 'Features',
	icon: () => 'toggle-right',
	render(ctx) {
		renderFeatures(ctx, ctx.session!);
	},
};

/** How much of each part the world has (shown on its card). */
function holds(s: WorldSession, id: FeatureId): string {
	const n = (k: number, one: string, many = `${one}s`) => `${k} ${k === 1 ? one : many}`;
	try {
		switch (id) {
			case 'writing':
				return n(s.writing.projects().length + s.writing.projects({ archived: true }).length, 'project');
			case 'maps':
				return n(s.maps.list().length, 'map');
			case 'calendars':
				return n(s.calendars.list().length, 'calendar');
			case 'timeline':
				return 'Every dated entry';
			case 'trees':
				return n(s.trees.list().length, 'tree');
			case 'graph':
				return n(s.graphs.list().length, 'saved view');
			case 'tasks':
				return n(s.tasks.all().length, 'task');
			case 'dashboards':
				return n(s.world.dashboards.length, 'dashboard');
			case 'media':
				return 'Every image in the world';
		}
	} catch {
		return '';
	}
	return '';
}

function renderFeatures(ctx: RouteContext, s: WorldSession): void {
	const ws = ctx.ws;
	ctx.setTitle('Features');
	const page = ctx.el.createDiv({ cls: 'ws-page ws-features' });
	const head = page.createDiv({ cls: 'ws-features__head' });
	head.createDiv({ cls: 'ws-features__kicker', text: 'World settings' });
	head.createEl('h1', { cls: 'ws-features__title', text: 'Features' });
	head.createEl('p', { cls: 'ws-features__sub', text: `Choose the parts of Worldsmith ${s.world.name} uses. Turning one off hides it everywhere (sidebar, pages, commands and widgets) and deletes nothing.` });
	const offCount = FEATURES.filter((f) => !isLocked(f.id) && !featureOn(s.world.features, f.id)).length;
	const tools = head.createDiv({ cls: 'ws-features__tools' });
	if (offCount)
		button(tools, {
			label: `Turn everything on (${offCount} off)`,
			icon: 'toggle-right',
			variant: 'ghost',
			size: 'sm',
			cls: 'ws-features__all',
			onClick: () => {
				const before = { ...(s.world.features ?? {}) };
				s.updateWorld({ features: {} });
				actionNotice('Every feature is on.', { label: 'Undo', run: () => void s.updateWorld({ features: before }) });
			},
		});

	// The free edition says what Pro adds, once, at the top (0.30).
	if (EDITION === 'free') {
		const pro = page.createDiv({ cls: 'ws-features__pro' });
		const ic = pro.createDiv({ cls: 'ws-features__pro-icon' });
		icon(ic, 'sparkles');
		const t = pro.createDiv({ cls: 'ws-features__pro-text' });
		t.createDiv({ cls: 'ws-features__pro-title', text: 'Worldsmith Pro' });
		t.createDiv({ cls: 'ws-features__pro-body', text: 'The Writing Studio, Maps, Timeline, Trees, Graph and Calendars. One purchase, no account or licence key; your worlds carry straight over.' });
		button(pro, { label: 'Get Worldsmith Pro', icon: 'external-link', variant: 'primary', size: 'sm', cls: 'ws-features__getpro', onClick: () => openProPage() });
	}
	const groups = [...new Set(FEATURES.map((f) => f.group))];
	for (const g of groups) {
		const sec = page.createEl('section', { cls: 'ws-features__group' });
		sec.createEl('h2', { cls: 'ws-features__gtitle', text: g });
		const grid = sec.createDiv({ cls: 'ws-features__grid' });
		for (const f of FEATURES.filter((x) => x.group === g)) featureCard(grid, ctx, s, f);
	}
	const foot = page.createDiv({ cls: 'ws-features__foot' });
	icon(foot, 'info');
	foot.createSpan({ text: 'These are saved with the world, so they travel with exports and backups. Entries, connections, notes and Home are always on.' });

	// Every page (this one too) redraws when a switch changes: WorldsmithView listens.
	void ws;
}

function featureCard(grid: HTMLElement, ctx: RouteContext, s: WorldSession, f: FeatureDef): void {
	const locked = isLocked(f.id);
	const on = !locked && featureOn(s.world.features, f.id);
	const card = grid.createDiv({ cls: cx('ws-feature-card', !on && 'is-off', locked && 'is-locked'), attr: { 'data-feature': f.id } });
	const top = card.createDiv({ cls: 'ws-feature-card__top' });
	const ic = top.createDiv({ cls: 'ws-feature-card__icon' });
	icon(ic, f.icon);
	const t = top.createDiv({ cls: 'ws-feature-card__text' });
	const name = t.createDiv({ cls: 'ws-feature-card__name', text: f.label });
	if (locked) name.createSpan({ cls: 'ws-pro-badge', text: 'Pro' });
	t.createDiv({ cls: 'ws-feature-card__holds', text: holds(s, f.id) });
	// A switch (a real checkbox, so keyboards and screen readers know it).
	const sw = top.createEl('label', { cls: 'ws-fswitch', attr: { title: on ? `Turn ${f.label} off` : `Turn ${f.label} on` } });
	const box = sw.createEl('input', { cls: 'ws-fswitch__input', attr: { type: 'checkbox', role: 'switch', 'aria-label': f.label } });
	box.checked = on;
	box.disabled = locked;
	if (locked) sw.setAttr('title', `${f.label} comes with Worldsmith Pro`);
	sw.createSpan({ cls: 'ws-fswitch__track', attr: { 'aria-hidden': 'true' } });
	box.addEventListener('change', () => {
		const undo = ctx.ws.features.set(f.id, box.checked);
		actionNotice(box.checked ? `${f.label} ${f.plural ? 'are' : 'is'} on.` : `${f.label} ${f.plural ? 'are' : 'is'} off. ${f.whenOff}`, { label: 'Undo', run: undo });
	});
	card.createEl('p', { cls: 'ws-feature-card__desc', text: f.description });
	const foot = card.createDiv({ cls: 'ws-feature-card__foot' });
	if (locked) {
		const go = foot.createEl('button', { cls: 'ws-feature-card__open', attr: { type: 'button' } });
		go.createSpan({ text: 'Comes with Worldsmith Pro' });
		icon(go, 'external-link');
		go.addEventListener('click', () => openProPage());
	} else if (on && f.routes[0]) {
		const go = foot.createEl('button', { cls: 'ws-feature-card__open', attr: { type: 'button' } });
		go.createSpan({ text: `Open ${f.label}` });
		icon(go, 'arrow-right');
		go.addEventListener('click', () => ctx.navigate({ name: f.routes[0]!, params: {} }));
	} else if (!on) foot.createSpan({ cls: 'ws-feature-card__kept', text: f.whenOff });
}

/** In place of a page whose part is switched off. */
export function renderFeatureOff(ctx: RouteContext, id: FeatureId): void {
	const f = FEATURES.find((x) => x.id === id)!;
	if (isLocked(id)) {
		ctx.setTitle(f.label);
		const box = ctx.el.createDiv({ cls: 'ws-page ws-feature-off is-pro' });
		const ic = box.createDiv({ cls: 'ws-feature-off__icon' });
		icon(ic, f.icon);
		box.createEl('h1', { cls: 'ws-feature-off__title', text: `${f.label} ${f.plural ? 'come' : 'comes'} with Worldsmith Pro` });
		box.createEl('p', { cls: 'ws-feature-off__body', text: `${f.description} Worldsmith Pro adds the Writing Studio, Maps, Timeline, Trees, Graph and Calendars: one purchase, no account or licence key, and your worlds carry straight over.` });
		const row = box.createDiv({ cls: 'ws-feature-off__actions' });
		button(row, { label: 'Get Worldsmith Pro', icon: 'external-link', variant: 'primary', cls: 'ws-feature-off__getpro', onClick: () => openProPage() });
		button(row, { label: 'All features', icon: 'sliders-horizontal', variant: 'ghost', onClick: () => ctx.navigate({ name: 'features', params: {} }) });
		return;
	}
	ctx.setTitle(f.label);
	const box = ctx.el.createDiv({ cls: 'ws-page ws-feature-off' });
	const ic = box.createDiv({ cls: 'ws-feature-off__icon' });
	icon(ic, f.icon);
	box.createEl('h1', { cls: 'ws-feature-off__title', text: `${f.label} ${f.plural ? 'are' : 'is'} turned off` });
	box.createEl('p', { cls: 'ws-feature-off__body', text: `${ctx.session?.world.name ?? 'This world'} doesn’t use ${f.label} right now. ${f.whenOff} Nothing was deleted.` });
	const row = box.createDiv({ cls: 'ws-feature-off__actions' });
	button(row, {
		label: `Turn ${f.label} on`,
		icon: 'toggle-right',
		variant: 'primary',
		cls: 'ws-feature-off__on',
		onClick: () => {
			const undo = ctx.ws.features.set(id, true);
			actionNotice(`${f.label} ${f.plural ? 'are' : 'is'} on.`, { label: 'Undo', run: undo });
		},
	});
	button(row, { label: 'All features', icon: 'sliders-horizontal', variant: 'ghost', onClick: () => ctx.navigate({ name: 'features', params: {} }) });
	void ROUTES;
}
