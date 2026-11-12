import { Keymap } from 'obsidian';
import { debounce } from '../../../core/util/async';
import { ROUTES } from '../../../state/route';
import { entityMenu } from '../../actions';
import { avatar } from '../../components/avatar';
import { emptyState, icon, cx } from '../../components/dom';
import type { RouteDefinition } from './RouteRegistry';
import { mountToolBanner } from '../../media/pageBanner';

const MATCH_LABEL = { name: 'Name', alias: 'Alias', tag: 'Tag', content: 'Content' } as const;

/** Full-page search across every type, grouped by type. */
export const searchRoute: RouteDefinition = {
	id: 'search',
	needsWorld: true,
	title: () => 'Search',
	icon: () => 'search',
	render(ctx) {
		const s = ctx.session!;
		const page = ctx.el.createDiv({ cls: 'ws-page ws-page--search' });
		// A header like the other Tools pages', so it can carry a banner (0.12.2).
		const top = page.createDiv({ cls: 'ws-studio-head ws-search-head' });
		icon(top.createDiv({ cls: 'ws-db-header__mark ws-tint--blue' }), 'search');
		const tt = top.createDiv({ cls: 'ws-db-header__text' });
		tt.createEl('h1', { cls: 'ws-db-header__title', text: 'Search' });
		tt.createDiv({ cls: 'ws-db-header__desc', text: `Names, aliases, tags and details across ${s.world.name}.` });
		mountToolBanner(ctx, top, 'search');
		const head = page.createDiv({ cls: 'ws-search-hero' });
		const field = head.createDiv({ cls: 'ws-search-field ws-search-field--large' });
		icon(field, 'search', 'ws-search-field__icon');
		const input = field.createEl('input', {
			cls: 'ws-search-field__input',
			attr: { type: 'search', placeholder: 'Search names, aliases, tags and details…', 'aria-label': 'Search Worldsmith' },
		});
		input.value = ctx.params.q ?? '';
		const results = page.createDiv({ cls: 'ws-search-results', attr: { 'aria-live': 'polite' } });

		const run = () => {
			const q = input.value.trim();
			results.empty();
			if (!q) {
				emptyState(results, { icon: 'search', title: 'Search your world', body: 'Results update as you type.', compact: true });
				return;
			}
			const hits = s.search.search(q, { limit: 200 });
			if (!hits.length) {
				emptyState(results, { icon: 'search-x', title: `Nothing matches “${q}”`, body: 'Try a shorter word, an alias, or a tag.', compact: true });
				return;
			}
			results.createDiv({ cls: 'ws-search-results__count', text: `${hits.length}${hits.length === 200 ? '+' : ''} result${hits.length === 1 ? '' : 's'}` });
			const groups = new Map<string, typeof hits>();
			for (const h of hits) {
				const g = groups.get(h.entity.typeId) ?? [];
				g.push(h);
				groups.set(h.entity.typeId, g);
			}
			for (const [typeId, list] of groups) {
				const schema = s.schemas.get(typeId);
				const sec = results.createDiv({ cls: 'ws-search-group' });
				const gh = sec.createDiv({ cls: cx('ws-search-group__head', schema?.color ? `ws-tint--${schema.color}` : '') });
				icon(gh, schema?.icon ?? 'box');
				gh.createSpan({ text: `${schema?.plural ?? typeId} · ${list.length}` });
				for (const h of list) {
					const row = sec.createDiv({ cls: 'ws-list-row', attr: { tabindex: '0', role: 'link' } });
					avatar(row, ctx.ws.app, h.entity, schema, { size: 'sm' });
					const t = row.createDiv({ cls: 'ws-list-row__text' });
					t.createDiv({ cls: 'ws-list-row__name', text: h.entity.name });
					const sub = s.entityService.subtitle(h.entity);
					if (sub) t.createDiv({ cls: 'ws-list-row__sub', text: sub });
					row.createSpan({ cls: 'ws-badge', text: MATCH_LABEL[h.matched] });
					const open = (evt: MouseEvent | KeyboardEvent) => ctx.navigate(ROUTES.entity(h.entity.id), Keymap.isModEvent(evt) ? 'tab' : false);
					row.addEventListener('click', open);
					row.addEventListener('keydown', (e) => e.key === 'Enter' && open(e));
					row.addEventListener('contextmenu', (e) => {
						e.preventDefault();
						entityMenu(ctx.ws, h.entity).showAtMouseEvent(e);
					});
				}
			}
		};
		const onInput = debounce(() => {
			ctx.replaceParams(input.value ? { q: input.value } : {});
			run();
		}, 120);
		input.addEventListener('input', () => onInput());
		input.addEventListener('keydown', (e) => {
			if (e.key === 'Enter') (results.querySelector('.ws-list-row'))?.click();
		});
		ctx.component.register(() => onInput.cancel());
		run();
		window.setTimeout(() => input.focus(), 0);
	},
};
