import { Menu } from 'obsidian';
import type { BlockRenderContext } from '../../../blocks/BlockRegistry';
import type { BlockInstance } from '../../../core/types';
import { TASKS_LAYOUT, materialize } from '../../../layouts/defaults';
import { LayoutEditor, renderWidgetDrawer } from '../../../layouts/editor/LayoutEditor';
import { BlockSettingsModal } from '../../components/BlockSettingsModal';
import { button, cx, icon } from '../../components/dom';
import { own } from '../../components/lifecycle';
import { confirmModal } from '../../components/modals';
import { mountPageBanner, pageBannerKey } from '../../media/pageBanner';
import { NewTaskModal } from '../../tasks/TaskModal';
import type { RouteDefinition } from './RouteRegistry';

const PAGE_ID = 'tasks';

/**
 * The Tasks home: a customizable page of task widgets (stats, calendar, lists…). The
 * layout is saved in world.json (`pages.tasks`), so it syncs with the world.
 */
export const tasksRoute: RouteDefinition = {
	id: 'tasks',
	needsWorld: true,
	title: () => 'Tasks',
	icon: () => 'list-checks',
	render(ctx) {
		const s = ctx.session!;
		const ws = ctx.ws;
		const page = ctx.el.createDiv({ cls: 'ws-page ws-page--tasks' });
		const editBar = page.createDiv({ cls: 'ws-editbar' });
		const head = page.createDiv({ cls: 'ws-db-header ws-tasks-head' });
		const mark = head.createDiv({ cls: 'ws-db-header__mark ws-tint--blue' });
		icon(mark, 'list-checks');
		const text = head.createDiv({ cls: 'ws-db-header__text' });
		text.createEl('h1', { cls: 'ws-db-header__title', text: 'Tasks' });
		text.createDiv({ cls: 'ws-db-header__desc', text: `Everything left to build in ${s.world.name}.` });
		const actions = head.createDiv({ cls: 'ws-db-header__actions' });
		mountPageBanner({ ws, session: s, component: ctx.component, header: head, key: pageBannerKey.tasks(), label: 'the Tasks page' });
		const body = page.createDiv({ cls: 'ws-tasks-body' });
		const layoutHost = body.createDiv({ cls: 'ws-tasks-layout' });
		const drawerHost = body.createDiv({ cls: 'ws-tasks-drawer' });

		const host = { ws, session: s, navigate: ctx.navigate };
		const saved = (): BlockInstance[] => {
			const p = s.world.pages[PAGE_ID];
			return p?.blocks.length ? p.blocks : materialize(TASKS_LAYOUT);
		};
		let selfSave = 0;
		const persist = (blocks: BlockInstance[]) => {
			selfSave++;
			try {
				s.updateWorld({ pages: { ...s.world.pages, [PAGE_ID]: { blocks } } });
			} finally {
				selfSave--;
			}
		};

		const editor = new LayoutEditor({
			registry: ws.blocks,
			surface: 'tasks',
			makeContext: (instance, def, el, component, setTitle): BlockRenderContext => ({
				ws,
				app: ws.app,
				session: s,
				el,
				instance,
				config: { ...def.defaultConfig, ...instance.config },
				component,
				surface: 'tasks',
				navigate: (r, nl) => ctx.navigate(r, nl),
				setTitle,
			}),
			onChange: persist,
			openSettings: (instance, def, save) => new BlockSettingsModal(ws, s, instance, def, save).open(),
		});
		ctx.component.addChild(editor);

		const paintChrome = () => {
			const editing = editor.isEditing;
			page.toggleClass('is-editing', editing);
			actions.empty();
			editBar.empty();
			drawerHost.empty();
			if (editing) {
				icon(editBar, 'layout-grid', 'ws-editbar__icon');
				const t = editBar.createDiv({ cls: 'ws-editbar__text' });
				t.createEl('b', { text: 'Customizing Tasks. ' });
				t.createSpan({ text: 'Drag widgets to rearrange, drag the right edge to resize, or open a widget’s settings.' });
				button(editBar, {
					label: 'Reset layout',
					icon: 'rotate-ccw',
					variant: 'ghost',
					size: 'sm',
					onClick: () => void (async () => {
						const ok = await confirmModal(ws.app, { title: 'Reset the Tasks page?', body: 'Widgets go back to the default layout. Your tasks aren’t affected.', confirmLabel: 'Reset layout' });
						if (!ok) return;
						const blocks = materialize(TASKS_LAYOUT);
						persist(blocks);
						editor.replace(blocks);
						paintChrome();
					})(),
				});
				button(editBar, {
					label: 'Done',
					icon: 'check',
					variant: 'primary',
					size: 'sm',
					onClick: () => {
						editor.setEditing(false);
						paintChrome();
					},
				});
				renderWidgetDrawer(drawerHost, ws.blocks, 'tasks', editor.current, (type) => {
					editor.add(type);
					paintChrome();
				});
				return;
			}
			button(actions, {
				label: 'Customize',
				icon: 'layout-grid',
				variant: 'ghost',
				onClick: () => {
					editor.setEditing(true);
					paintChrome();
				},
			});
			button(actions, { label: 'New task', icon: 'plus', variant: 'primary', onClick: () => new NewTaskModal(host).open() });
			button(actions, {
				icon: 'more-horizontal',
				variant: 'quiet',
				tooltip: 'Task settings',
				onClick: (evt) => {
					const p = s.world.progress;
					const m = new Menu();
					m.addItem((i) => i.setTitle('Development counts…').setIsLabel(true));
					for (const [id, label] of [
						['blend', 'Tasks and key fields'],
						['tasks', 'Only tasks'],
						['fields', 'Only key fields'],
					] as const) {
						m.addItem((i) => i.setTitle(label).setChecked(p.mode === id).onClick(() => s.updateWorld({ progress: { ...p, mode: id } })));
					}
					m.addItem((i) => i.setTitle('Count optional tasks').setChecked(p.includeOptional).onClick(() => s.updateWorld({ progress: { ...p, includeOptional: !p.includeOptional } })));
					m.addSeparator();
					m.addItem((i) =>
						i
							.setTitle(ws.settings.weekStart === 1 ? 'Start weeks on Sunday' : 'Start weeks on Monday')
							.setIcon('calendar-range')
							.onClick(async () => {
								ws.settings.weekStart = ws.settings.weekStart === 1 ? 0 : 1;
								await ws.saveSettings();
								editor.draw();
							}),
					);
					m.showAtMouseEvent(evt);
				},
			});
		};

		editor.mount(layoutHost, saved());
		paintChrome();

		// The same world open in another pane (or synced) changed the layout.
		own(
			ctx.component,
			s.events.on('world:updated', ({ keys }) => {
				if (!keys.includes('pages') || selfSave) return;
				editor.replace(saved());
				if (editor.isEditing) paintChrome();
			}),
		);
		void cx;
	},
};
