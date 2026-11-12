import { setIcon, setTooltip } from 'obsidian';
import type { TaskStatus } from '../../core/types';
import { TASK_PRIORITIES, TASK_STATUSES } from '../../core/types';
import { uuid } from '../../core/util/ids';
import { DUE_FILTERS, defaultTiles, evalStat, METRICS, normalizeTile, PERIODS, type StatTile } from '../../services/taskStats';
import type { WorldSession } from '../../services/WorldSession';
import { button, cx, icon, progressRing } from '../../ui/components/dom';
import { IconPickerModal, WorldsmithModal } from '../../ui/components/modals';
import { colorSwatches, segmented, toggle, typePicker } from '../../ui/views/routes/typeStudio/common';
import type { BlockDefinition } from '../BlockRegistry';
import { watchTasks } from './common';

/**
 * A row of stat tiles — small rollups over tasks and entries. Each tile is configured in
 * customize mode (gear on the tile); tiles can be added and removed.
 */
export const taskStatsBlock: BlockDefinition = {
	id: 'task-stats',
	name: 'Stats',
	icon: 'hash',
	description: 'A row of numbers: open, due, overdue, completed, development — each one configurable.',
	hint: 'Rollups you configure',
	surfaces: ['tasks'],
	frame: 'plain',
	defaultSize: { w: 12, h: 1 },
	defaultConfig: { tiles: defaultTiles(), captions: true },
	configFields: [{ id: 'captions', type: 'boolean', label: 'Show the detail line under each number', description: 'Like “1 type” or “+3 this week”. Each tile can also hide its own (gear on the tile).' }],
	render(ctx) {
		const s = ctx.session;
		const root = ctx.el.createDiv({ cls: 'ws-stats' });
		const tilesOf = (): StatTile[] => (Array.isArray(ctx.config.tiles) ? (ctx.config.tiles as unknown[]).map(normalizeTile) : defaultTiles());
		let tiles = tilesOf();
		const save = (next: StatTile[]) => {
			tiles = next;
			ctx.config = { ...ctx.config, tiles: next };
			ctx.setConfig?.(ctx.config);
			paint();
		};

		const paint = () => {
			root.empty();
			const statCtx = {
				tasks: s.tasks.visible(),
				entities: s.entities.all(),
				progress: (e: Parameters<typeof s.entityService.progress>[0]) => s.entityService.progress(e).ratio,
				weekStart: ctx.ws.settings.weekStart,
				includeOptional: s.world.progress.includeOptional,
			};
			tiles.forEach((tile, i) => {
				const r = evalStat(tile, statCtx);
				const el = root.createDiv({ cls: cx('ws-stat', `ws-tint--${tile.color}`, r.alert && 'is-alert', tile.ring && r.ratio !== null && 'has-ring'), attr: { 'data-tile': tile.id } });
				const label = el.createDiv({ cls: 'ws-stat__label' });
				icon(label, tile.icon);
				label.createSpan({ text: tile.label });
				el.createDiv({ cls: 'ws-stat__value', text: r.display });
				if (tile.caption && ctx.config.captions !== false && r.sub) el.createDiv({ cls: 'ws-stat__sub', text: r.sub });
				if (tile.ring && r.ratio !== null) progressRing(el.createDiv({ cls: 'ws-stat__ring' }), r.ratio, 46);
				setTooltip(el, METRICS.find((m) => m.id === tile.metric)?.hint ?? '', { delay: 600 });
				if (ctx.editing) {
					const bar = el.createDiv({ cls: 'ws-stat__edit' });
					const gear = bar.createEl('button', { cls: 'ws-edit-chrome__btn', attr: { type: 'button', 'aria-label': `Edit “${tile.label}”` } });
					setIcon(gear, 'settings-2');
					gear.addEventListener('click', () => new StatTileModal(ctx.ws.app, s, tile, ctx.ws.settings.weekStart, (next) => save(tiles.map((t, j) => (j === i ? next : t)))).open());
					if (i > 0) {
						const left = bar.createEl('button', { cls: 'ws-edit-chrome__btn', attr: { type: 'button', 'aria-label': 'Move left' } });
						setIcon(left, 'arrow-left');
						left.addEventListener('click', () => {
							const next = [...tiles];
							[next[i - 1], next[i]] = [next[i] as StatTile, next[i - 1] as StatTile];
							save(next);
						});
					}
					const x = bar.createEl('button', { cls: 'ws-edit-chrome__btn is-danger', attr: { type: 'button', 'aria-label': `Remove “${tile.label}”` } });
					setIcon(x, 'x');
					x.addEventListener('click', () => save(tiles.filter((_, j) => j !== i)));
				}
			});
			if (ctx.editing) {
				const add = root.createEl('button', { cls: 'ws-stat ws-stat--add', attr: { type: 'button' } });
				icon(add, 'plus');
				add.createSpan({ text: 'Add a stat' });
				add.addEventListener('click', () => {
					const tile: StatTile = { ...(defaultTiles()[0] as StatTile), id: `tile-${uuid().slice(0, 6)}`, label: 'New stat', icon: 'hash', color: 'gray' };
					new StatTileModal(ctx.ws.app, s, tile, ctx.ws.settings.weekStart, (next) => save([...tiles, next]), true).open();
				});
			}
			if (!tiles.length && !ctx.editing) root.createDiv({ cls: 'ws-stats__empty', text: 'No stats — add some in Customize.' });
		};
		paint();
		watchTasks(ctx, paint);
	},
};

/** Configure one stat tile, with a live preview of its value. */
export class StatTileModal extends WorldsmithModal {
	private ws_tile: StatTile;

	constructor(
		app: import('obsidian').App,
		private readonly ws_session: WorldSession,
		tile: StatTile,
		private readonly ws_weekStart: number,
		private readonly ws_save: (t: StatTile) => void,
		private readonly ws_isNew = false,
	) {
		super(app);
		this.ws_tile = { ...tile };
		this.modalEl.addClass('ws-stat-modal');
	}

	override onOpen(): void {
		this.render();
	}

	private set(patch: Partial<StatTile>): void {
		this.ws_tile = { ...this.ws_tile, ...patch };
		if (!this.ws_isNew) this.ws_save(this.ws_tile);
		this.render();
	}

	private render(): void {
		const t = this.ws_tile;
		const s = this.ws_session;
		const c = this.contentEl;
		const scroll = c.scrollTop;
		c.empty();
		this.setTitle(this.ws_isNew ? 'New stat' : `Stat: “${t.label}”`);
		const row = (label: string, hint?: string) => {
			const r = c.createDiv({ cls: 'ws-tm__row' });
			const l = r.createDiv({ cls: 'ws-tm__label', text: label });
			if (hint) l.createDiv({ cls: 'ws-fm__hint', text: hint });
			return r.createDiv({ cls: 'ws-tm__control' });
		};

		const metric = row('Show').createEl('select', { cls: 'ws-input dropdown', attr: { 'aria-label': 'Metric' } });
		for (const m of METRICS) metric.createEl('option', { text: m.label, value: m.id });
		metric.value = t.metric;
		metric.addEventListener('change', () => this.set({ metric: metric.value as StatTile['metric'], ring: metric.value === 'avg-progress' || metric.value === 'percent-done' }));

		if (t.metric === 'tasks') {
			const st = row('Status', 'None selected = everything not done');
			const wrap = st.createDiv({ cls: 'ws-stat-chips' });
			for (const x of TASK_STATUSES) {
				const on = t.statuses.includes(x.id);
				const b = wrap.createEl('button', { cls: cx('ws-chip', `ws-tint--${x.color}`, on && 'is-on'), text: x.label, attr: { type: 'button', 'aria-pressed': String(on) } });
				b.addEventListener('click', () => this.set({ statuses: on ? t.statuses.filter((y) => y !== x.id) : ([...t.statuses, x.id] as TaskStatus[]) }));
			}
		}
		if (t.metric === 'tasks' || t.metric === 'percent-done') {
			const due = row('Due').createEl('select', { cls: 'ws-input dropdown', attr: { 'aria-label': 'Due' } });
			for (const d of DUE_FILTERS) due.createEl('option', { text: d.label, value: d.id });
			due.value = t.due;
			due.addEventListener('change', () => this.set({ due: due.value as StatTile['due'] }));
		}
		if (t.metric === 'done-in-period') {
			segmented(row('Period'), PERIODS.map((p) => ({ id: p.id, label: p.label })), t.period, (v) => this.set({ period: v }), 'Period');
			toggle(row('Compare', 'With the period before'), t.compare, (v) => this.set({ compare: v }), 'Compare with previous period');
		}
		typePicker(row('Types', 'Empty = every type'), s, t.types, (next) => this.set({ types: next }), 'All types');
		if (t.metric !== 'entries' && t.metric !== 'avg-progress') {
			const pr = row('Priority at least').createEl('select', { cls: 'ws-input dropdown', attr: { 'aria-label': 'Minimum priority' } });
			for (const p of TASK_PRIORITIES) pr.createEl('option', { text: p.id === 0 ? 'Any priority' : p.label, value: String(p.id) });
			pr.value = String(t.minPriority);
			pr.addEventListener('change', () => this.set({ minPriority: Number(pr.value) as StatTile['minPriority'] }));
		}

		const label = row('Label').createEl('input', { cls: 'ws-input', attr: { type: 'text', 'aria-label': 'Label' } });
		label.value = t.label;
		label.addEventListener('change', () => this.set({ label: label.value.trim() || 'Stat' }));
		const ic = row('Icon').createEl('button', { cls: 'ws-icon-pick', attr: { type: 'button', 'aria-label': 'Change icon' } });
		icon(ic, t.icon);
		ic.addEventListener('click', () => new IconPickerModal(this.app, (id) => this.set({ icon: id })).open());
		colorSwatches(row('Color'), t.color, (col) => this.set({ color: col ?? 'gray' }), false);
		if (t.metric === 'avg-progress' || t.metric === 'percent-done') toggle(row('Show ring'), t.ring, (v) => this.set({ ring: v }), 'Show a progress ring');
		toggle(row('Detail line', 'The small text under the number'), t.caption, (v) => this.set({ caption: v }), 'Show the detail line');

		const r = evalStat(t, {
			tasks: s.tasks.visible(),
			entities: s.entities.all(),
			progress: (e) => s.entityService.progress(e).ratio,
			weekStart: this.ws_weekStart,
			includeOptional: s.world.progress.includeOptional,
		});
		const pv = c.createDiv({ cls: cx('ws-stat-preview', `ws-tint--${t.color}`) });
		pv.createSpan({ cls: 'ws-stat-preview__value', text: r.display });
		pv.createSpan({ text: r.sub });

		const actions = c.createDiv({ cls: 'ws-modal-actions' });
		if (this.ws_isNew) {
			button(actions, { label: 'Cancel', variant: 'ghost', onClick: () => this.close() });
			button(actions, {
				label: 'Add stat',
				icon: 'plus',
				variant: 'primary',
				onClick: () => {
					this.ws_save(this.ws_tile);
					this.close();
				},
			});
		} else button(actions, { label: 'Done', variant: 'primary', onClick: () => this.close() });
		c.scrollTop = scroll;
	}

	override onClose(): void {
		this.contentEl.empty();
	}
}
