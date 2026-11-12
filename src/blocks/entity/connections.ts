import { Keymap, Menu, setIcon, setTooltip } from 'obsidian';
import { formatChronoDate } from '../../core/types';
import { blockActions } from '../../layouts/renderer/LayoutRenderer';
import { relationConfig, type EdgeView } from '../../services/RelationService';
import { ROUTES } from '../../state/route';
import { avatar } from '../../ui/components/avatar';
import { button, cx, emptyState, icon } from '../../ui/components/dom';
import { own } from '../../ui/components/lifecycle';
import { openAddConnection, removeConnection } from '../../ui/relationActions';
import type { BlockDefinition } from '../BlockRegistry';
import { currentEntity } from '../util';

/** Remembered per entry type for the session: show every connection or only unlisted ones. */
const showAllByType = new Map<string, boolean>();

const STATUS_LABEL: Record<string, string> = { ended: 'Ended', strained: 'Strained', unknown: 'Unknown' };

/**
 * Everything connected to this entry, grouped by how it's connected — including
 * connections made from the *other* entry's fields (backlinks). By default it leaves out
 * what this page's relation fields already show, so nothing is listed twice.
 */
export const connectionsBlock: BlockDefinition = {
	id: 'connections',
	category: 'Connections',
	name: 'Connections',
	icon: 'waypoints',
	description: 'All connections of this entry, grouped by relationship — including ones made from the other side.',
	surfaces: ['entity'],
	frame: 'card',
	defaultSize: { w: 8, h: 1 },
	defaultConfig: {},
	render(ctx) {
		const entity = ctx.entity;
		if (!entity) return;
		const s = ctx.session;
		const R = s.relations;
		const root = ctx.el.createDiv({ cls: 'ws-conn' });
		const add = () => {
			const e = currentEntity(ctx);
			if (e) openAddConnection(ctx.ws, s, e);
		};
		const actions = blockActions(ctx.el);
		if (actions) button(actions, { icon: 'plus', variant: 'quiet', size: 'sm', tooltip: 'Add connection', onClick: add });

		const inFields = (): Set<string> => {
			const e = currentEntity(ctx);
			const schema = e ? s.schemas.get(e.typeId) : undefined;
			const ids = new Set<string>();
			if (!e || !schema) return ids;
			for (const f of schema.fields) {
				if (f.type !== 'relation' || f.hidden || !relationConfig(f).relationType) continue;
				for (const v of R.fieldViews(e.id, f)) ids.add(v.edge.id);
			}
			return ids;
		};

		let shownIds = new Set<string>();
		const paint = () => {
			root.empty();
			const e = currentEntity(ctx);
			if (!e) return;
			const all = R.viewsOf(e.id);
			const listed = inFields();
			const showAll = showAllByType.get(e.typeId) ?? false;
			const views = showAll ? all : all.filter((v) => !listed.has(v.edge.id));
			shownIds = new Set(all.map((v) => v.other.id));
			ctx.setTitle(all.length ? `Connections · ${all.length}` : 'Connections');

			// Filter line
			const hiddenCount = all.length - views.length;
			if (listed.size) {
				const bar = root.createDiv({ cls: 'ws-conn__bar' });
				bar.createSpan({
					cls: 'ws-conn__bar-text',
					text: showAll ? 'Showing every connection.' : hiddenCount ? `${hiddenCount} more ${hiddenCount === 1 ? 'is' : 'are'} shown in the fields above.` : '',
				});
				const t = bar.createEl('button', { cls: 'ws-link-btn', attr: { type: 'button' }, text: showAll ? 'Hide ones in fields' : 'Show all' });
				t.addEventListener('click', () => {
					showAllByType.set(e.typeId, !showAll);
					paint();
				});
			}

			if (!views.length) {
				emptyState(root, {
					icon: 'waypoints',
					title: all.length ? 'Everything is listed in the fields above' : 'No connections yet',
					body: all.length ? undefined : 'Link entries through the fields above, or add any kind of connection here — it shows up on both entries.',
					actionLabel: 'Add connection',
					actionIcon: 'plus',
					onAction: add,
					compact: true,
				});
				return;
			}

			// Group by label, keeping the first-seen order of relationship categories.
			const groups = new Map<string, EdgeView[]>();
			for (const v of views) {
				const key = `${v.edge.type}|${v.outgoing ? 'f' : 'r'}`;
				const g = groups.get(key) ?? [];
				g.push(v);
				groups.set(key, g);
			}
			const sorted = [...groups.values()].sort((a, b) => (a[0]?.label ?? '').localeCompare(b[0]?.label ?? ''));
			const grid = root.createDiv({ cls: 'ws-conn__groups' });
			for (const g of sorted) {
				const first = g[0] as EdgeView;
				const sec = grid.createDiv({ cls: 'ws-conn__group' });
				const head = sec.createDiv({ cls: 'ws-conn__head' });
				icon(head, first.type?.icon ?? 'link-2', 'ws-conn__head-icon');
				head.createSpan({ cls: 'ws-conn__label', text: first.label });
				head.createSpan({ cls: 'ws-conn__count', text: String(g.length) });
				const list = sec.createDiv({ cls: 'ws-conn__list', attr: { role: 'list' } });
				for (const v of g) row(list, v);
			}
		};

		const row = (list: HTMLElement, v: EdgeView) => {
			const { edge, other } = v;
			const os = s.schemas.get(other.typeId);
			const r = list.createDiv({
				cls: cx('ws-conn__row', edge.secret && 'is-secret', edge.status === 'ended' && 'is-ended', !!other.archivedAt && 'is-archived'),
				attr: { role: 'listitem', tabindex: '0' },
			});
			avatar(r, ctx.app, other, os, { size: 'sm' });
			const t = r.createDiv({ cls: 'ws-conn__text' });
			const nameLine = t.createDiv({ cls: 'ws-conn__name' });
			nameLine.createSpan({ text: other.name });
			if (edge.secret) {
				const sec = nameLine.createSpan({ cls: 'ws-conn__flag' });
				setIcon(sec, 'eye-off');
				setTooltip(sec, 'Secret');
			}
			const meta: string[] = [];
			if (os) meta.push(os.singular);
			if (edge.status && STATUS_LABEL[edge.status]) meta.push(STATUS_LABEL[edge.status] as string);
			if (edge.start || edge.end) meta.push(`${edge.start ? formatChronoDate(edge.start) : '…'} – ${edge.end ? formatChronoDate(edge.end) : 'now'}`);
			if (edge.description) meta.push(edge.description);
			t.createDiv({ cls: 'ws-conn__meta', text: meta.join(' · ') });
			if (edge.strength) {
				const st = r.createDiv({ cls: 'ws-conn__strength', attr: { 'aria-label': `Strength ${edge.strength} of 5` } });
				for (let i = 1; i <= 5; i++) st.createSpan({ cls: cx('ws-conn__pip', i <= (edge.strength ?? 0) && 'is-on') });
			}
			const det = r.createEl('button', { cls: 'ws-conn__details', attr: { type: 'button', 'aria-label': `Connection with ${other.name}` } });
			setIcon(det, 'chevron-right');
			setTooltip(det, 'Connection details');
			det.addEventListener('click', (evt) => {
				evt.stopPropagation();
				ctx.navigate(ROUTES.relation(edge.id), Keymap.isModEvent(evt));
			});
			r.addEventListener('click', (evt) => ctx.navigate(ROUTES.entity(other.id), Keymap.isModEvent(evt)));
			r.addEventListener('keydown', (evt) => {
				if (evt.key === 'Enter') ctx.navigate(ROUTES.entity(other.id), Keymap.isModEvent(evt));
			});
			r.addEventListener('contextmenu', (evt) => {
				evt.preventDefault();
				const m = new Menu();
				m.addItem((i) => i.setTitle(`Open ${other.name}`).setIcon('arrow-up-right').onClick(() => ctx.navigate(ROUTES.entity(other.id))));
				m.addItem((i) => i.setTitle('Open in new tab').setIcon('file-plus-2').onClick(() => ctx.navigate(ROUTES.entity(other.id), 'tab')));
				m.addItem((i) => i.setTitle('Connection details').setIcon('link-2').onClick(() => ctx.navigate(ROUTES.relation(edge.id))));
				m.addSeparator();
				m.addItem((i) => i.setTitle('Remove connection').setIcon('x').setWarning(true).onClick(() => removeConnection(s, edge, other.name)));
				m.showAtMouseEvent(evt);
			});
		};

		paint();
		let queued = false;
		const later = () => {
			if (queued) return;
			queued = true;
			window.requestAnimationFrame(() => {
				queued = false;
				paint();
			});
		};
		const touches = (e: { from: string; to: string }) => e.from === entity.id || e.to === entity.id;
		own(ctx.component, s.events.on('edge:created', ({ edge }) => touches(edge) && later()));
		own(ctx.component, s.events.on('edge:deleted', ({ edge }) => touches(edge) && later()));
		own(ctx.component, s.events.on('edge:updated', ({ edge, prev }) => (touches(edge) || touches(prev)) && later()));
		own(ctx.component, s.events.on('entity:updated', ({ entity: e }) => shownIds.has(e.id) && later()));
		own(ctx.component, s.events.on('relationType:updated', later));
	},
};
