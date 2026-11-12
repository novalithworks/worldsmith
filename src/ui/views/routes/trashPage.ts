import { relativeTime } from '../../../core/util/strings';
import { ROUTES } from '../../../state/route';
import { deletePermanently } from '../../actions';
import { avatar } from '../../components/avatar';
import { button, emptyState, icon } from '../../components/dom';
import { confirmModal } from '../../components/modals';
import { own } from '../../components/lifecycle';
import type { RouteDefinition } from './RouteRegistry';
import { mountToolBanner } from '../../media/pageBanner';

export const trashRoute: RouteDefinition = {
	id: 'trash',
	needsWorld: true,
	title: () => 'Trash',
	icon: () => 'trash-2',
	render(ctx) {
		const s = ctx.session!;
		const page = ctx.el.createDiv({ cls: 'ws-page ws-page--trash' });
		const header = page.createDiv({ cls: 'ws-db-header ws-tint--gray' });
		const mark = header.createDiv({ cls: 'ws-db-header__mark' });
		icon(mark, 'trash-2');
		const text = header.createDiv({ cls: 'ws-db-header__text' });
		text.createEl('h1', { cls: 'ws-db-header__title', text: 'Trash' });
		const count = text.createDiv({ cls: 'ws-db-header__count' });
		text.createDiv({ cls: 'ws-db-header__desc', text: 'Entries stay here until you delete them permanently.' });
		const actions = header.createDiv({ cls: 'ws-db-header__actions' });
		mountToolBanner(ctx, header, 'trash');
		const emptyBtn = button(actions, {
			label: 'Empty trash',
			icon: 'trash-2',
			variant: 'danger',
			onClick: () => void (async () => {
				const n = s.index.trashedEntities().length;
				const ok = await confirmModal(ctx.ws.app, {
					title: `Permanently delete ${n} ${n === 1 ? 'entry' : 'entries'}?`,
					body: 'This can’t be undone. Linked notes stay in your vault.',
					confirmLabel: 'Empty trash',
					danger: true,
				});
				if (ok) s.entityService.emptyTrash();
			})(),
		});
		const list = page.createDiv({ cls: 'ws-list' });

		const paint = () => {
			list.empty();
			const items = s.index.trashedEntities();
			count.setText(`${items.length} ${items.length === 1 ? 'entry' : 'entries'}`);
			emptyBtn.disabled = items.length === 0;
			if (!items.length) {
				emptyState(list, { icon: 'trash', title: 'Trash is empty', compact: true });
				return;
			}
			for (const e of items) {
				const schema = s.schemas.get(e.typeId);
				const row = list.createDiv({ cls: 'ws-list-row' });
				avatar(row, ctx.ws.app, e, schema, { size: 'sm' });
				const t = row.createDiv({ cls: 'ws-list-row__text' });
				const name = t.createEl('a', { cls: 'ws-list-row__name', text: e.name, attr: { href: '#' } });
				name.addEventListener('click', (evt) => {
					evt.preventDefault();
					ctx.navigate(ROUTES.entity(e.id));
				});
				t.createDiv({ cls: 'ws-list-row__sub', text: `${schema?.singular ?? e.typeId} • trashed ${relativeTime(e.trashedAt ?? 0)}` });
				const a = row.createDiv({ cls: 'ws-list-row__actions' });
				button(a, { label: 'Restore', icon: 'undo-2', variant: 'ghost', size: 'sm', onClick: () => s.entityService.restore(e.id) });
				button(a, { icon: 'trash-2', variant: 'quiet', size: 'sm', tooltip: 'Delete permanently', onClick: () => void deletePermanently(ctx.ws, e) });
			}
		};
		paint();
		const refresh = () => window.requestAnimationFrame(paint);
		own(ctx.component, s.events.on('entity:updated', ({ change }) => change.keys.includes('trashedAt') && refresh()));
		own(ctx.component, s.events.on('entity:deleted', refresh));
	},
};
