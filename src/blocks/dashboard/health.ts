import { setIcon } from 'obsidian';
import { HEALTH_CHECKS } from '../../services/health';
import { ROUTES } from '../../state/route';
import { button, cx, progressRing } from '../../ui/components/dom';
import { healthReport, healthWord } from '../../ui/views/routes/healthPage';
import type { BlockDefinition } from '../BlockRegistry';
import { watchWorld } from './common';

/** World health widget (0.10): the score and the checks that found something. */
export const worldHealthBlock: BlockDefinition = {
	id: 'world-health',
	name: 'World health',
	icon: 'heart-pulse',
	category: 'Overview',
	description: 'A health score for your world and what to look at next: broken links, missing details, dates that disagree.',
	hint: 'Score and loose ends',
	surfaces: ['dashboard'],
	frame: 'card',
	defaultSize: { w: 4, h: 1 },
	minW: 3,
	singleton: true,
	defaultConfig: {},
	render(ctx) {
		const s = ctx.session;
		const paint = () => {
			ctx.el.empty();
			const r = healthReport(ctx.ws, s);
			const root = ctx.el.createDiv({ cls: 'ws-hlw' });
			const top = root.createEl('button', { cls: 'ws-hlw__top', attr: { type: 'button' } });
			const ring = progressRing(top, r.score / 100, 54);
			ring.el.setAttr('aria-label', `Health score ${r.score} out of 100`);
			const tx = top.createDiv({ cls: 'ws-hlw__text' });
			tx.createDiv({ cls: 'ws-hlw__word', text: healthWord(r.score) });
			tx.createDiv({ cls: 'ws-hlw__sub', text: `Score ${r.score} of 100` });
			top.addEventListener('click', (e) => ctx.navigate(ROUTES.health(), e.metaKey || e.ctrlKey ? 'tab' : false));
			const list = root.createDiv({ cls: 'ws-hlw__list' });
			const found = HEALTH_CHECKS.filter((c) => c.weight && r.byCheck.get(c.id)?.length).slice(0, 4);
			for (const c of found) {
				const row = list.createEl('button', { cls: 'ws-hlw__row', attr: { type: 'button', 'data-check': c.id } });
				const ic = row.createSpan({ cls: 'ws-hlw__icon' });
				setIcon(ic, c.icon);
				row.createSpan({ cls: 'ws-hlw__label', text: c.label });
				row.createSpan({ cls: 'ws-hlw__n', text: String(r.byCheck.get(c.id)!.length) });
				row.addEventListener('click', (e) => ctx.navigate(ROUTES.health(c.id), e.metaKey || e.ctrlKey ? 'tab' : false));
			}
			if (!found.length) {
				const ok = list.createDiv({ cls: cx('ws-hlw__row', 'is-clear') });
				const ic = ok.createSpan({ cls: 'ws-hlw__icon' });
				setIcon(ic, 'check-circle-2');
				ok.createSpan({ cls: 'ws-hlw__label', text: 'Nothing to fix right now.' });
			}
			const foot = root.createDiv({ cls: 'ws-tl-widget__foot' });
			button(foot, { label: 'Open health check', icon: 'arrow-up-right', variant: 'quiet', size: 'sm', onClick: (e) => ctx.navigate(ROUTES.health(), e.metaKey || e.ctrlKey ? 'tab' : false) });
		};
		paint();
		watchWorld(ctx, paint, { edges: true, world: (k) => k.some((x) => x === 'health' || x === 'sidebar' || x === 'banner' || x === 'pageBanners') });
	},
};
