import { Component, MarkdownRenderer, setTooltip } from 'obsidian';
import type { DevTask } from '../../core/types';
import { TASK_STATUSES } from '../../core/types';
import { addDays, fromISO, startOfWeek, today } from '../../core/util/dates';
import { blockActions } from '../../layouts/renderer/LayoutRenderer';
import { button, cx, emptyState, nameRegion } from '../../ui/components/dom';
import type { BlockDefinition } from '../BlockRegistry';
import { scopedTasks, typesField, watchTasks } from './common';

type ChartKind = 'by-type' | 'by-status' | 'per-week';

const dayOf = (ms: number) => {
	const d = new Date(ms);
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** Small bar charts over tasks. Plain HTML bars keep it theme-native and accessible. */
export const taskChartBlock: BlockDefinition = {
	id: 'task-chart',
	name: 'Task chart',
	icon: 'bar-chart-3',
	description: 'Bars of tasks by type, by status, or completed per week.',
	hint: 'By type, status or week',
	surfaces: ['tasks'],
	frame: 'card',
	defaultSize: { w: 6, h: 1 },
	defaultConfig: { chart: 'per-week', weeks: 8 },
	configFields: (s) => [
		{ id: 'chart', type: 'select', label: 'Chart', config: { options: [{ id: 'per-week', label: 'Completed per week' }, { id: 'by-type', label: 'Open and done by type' }, { id: 'by-status', label: 'Tasks by status' }] } },
		{ id: 'weeks', type: 'number', label: 'Weeks (per-week chart)', config: { min: 4, max: 26 } },
		typesField(s),
	],
	title: (ctx) => ({ 'per-week': 'Completed per week', 'by-type': 'Tasks by type', 'by-status': 'Tasks by status' })[(ctx.config.chart as ChartKind) ?? 'per-week'] ?? 'Chart',
	render(ctx) {
		const s = ctx.session;
		const root = ctx.el.createDiv({ cls: 'ws-chart' });
		const paint = () => {
			root.empty();
			const kind = (['by-type', 'by-status', 'per-week'].includes(ctx.config.chart as string) ? ctx.config.chart : 'per-week') as ChartKind;
			const tasks = scopedTasks(ctx);
			if (!tasks.length) {
				emptyState(root, { icon: 'bar-chart-3', title: 'No tasks yet', compact: true });
				return;
			}
			if (kind === 'per-week') {
				const weeks = typeof ctx.config.weeks === 'number' ? ctx.config.weeks : 8;
				const ws = ctx.ws.settings.weekStart;
				const thisWeek = startOfWeek(today(), ws);
				const buckets: Array<{ label: string; n: number; title: string }> = [];
				for (let i = weeks - 1; i >= 0; i--) {
					const a = addDays(thisWeek, -7 * i);
					const b = addDays(a, 6);
					const n = tasks.filter((t: DevTask) => t.completedAt && dayOf(t.completedAt) >= a && dayOf(t.completedAt) <= b).length;
					const d = fromISO(a);
					buckets.push({ label: `${d.getMonth() + 1}/${d.getDate()}`, n, title: `Week of ${d.toLocaleDateString()}: ${n} completed` });
				}
				const max = Math.max(1, ...buckets.map((x) => x.n));
				const cols = root.createDiv({ cls: 'ws-chart__cols', attr: { role: 'img'} });
				nameRegion(cols, buckets.map((x) => x.title).join('; ') );
				buckets.forEach((x, i) => {
					const c = cols.createDiv({ cls: cx('ws-chart__col', i === buckets.length - 1 && 'is-current') });
					c.createDiv({ cls: 'ws-chart__val', text: x.n ? String(x.n) : '' });
					const bar = c.createDiv({ cls: 'ws-chart__bar' });
					bar.style.height = `${Math.max(2, (x.n / max) * 100)}%`;
					c.createDiv({ cls: 'ws-chart__label', text: x.label });
					setTooltip(c, x.title, { delay: 200 });
				});
				return;
			}
			if (kind === 'by-status') {
				const total = tasks.length;
				const stack = root.createDiv({ cls: 'ws-chart__stack', attr: { role: 'img' } });
				const legend = root.createDiv({ cls: 'ws-chart__legend' });
				for (const st of TASK_STATUSES) {
					const n = tasks.filter((t) => t.status === st.id).length;
					if (!n) continue;
					const seg = stack.createDiv({ cls: cx('ws-chart__seg', `ws-tint--${st.color}`) });
					seg.style.width = `${(n / total) * 100}%`;
					setTooltip(seg, `${st.label}: ${n}`, { delay: 200 });
					const k = legend.createSpan({ cls: cx('ws-cal__key', `ws-tint--${st.color}`) });
					k.createSpan({ cls: 'ws-cal__dot' });
					k.createSpan({ text: `${st.label} ${n}` });
				}
				return;
			}
			const per = new Map<string, { open: number; done: number }>();
			for (const t of tasks) {
				if (!t.typeId) continue;
				const p = per.get(t.typeId) ?? { open: 0, done: 0 };
				if (t.status === 'done') p.done++;
				else p.open++;
				per.set(t.typeId, p);
			}
			const max = Math.max(1, ...[...per.values()].map((p) => p.open + p.done));
			for (const [typeId, p] of [...per].sort((a, b) => b[1].open + b[1].done - (a[1].open + a[1].done))) {
				const schema = s.schemas.get(typeId);
				const row = root.createDiv({ cls: cx('ws-chart__row', `ws-tint--${schema?.color ?? 'gray'}`) });
				row.createSpan({ cls: 'ws-chart__name', text: schema?.plural ?? typeId });
				const track = row.createDiv({ cls: 'ws-chart__track' });
				const done = track.createDiv({ cls: 'ws-chart__done' });
				done.style.width = `${(p.done / max) * 100}%`;
				const open = track.createDiv({ cls: 'ws-chart__open' });
				open.style.width = `${(p.open / max) * 100}%`;
				row.createSpan({ cls: 'ws-chart__num', text: `${p.done}/${p.open + p.done}` });
				setTooltip(row, `${p.done} done, ${p.open} open`, { delay: 200 });
			}
		};
		paint();
		watchTasks(ctx, paint, { entities: false });
	},
};

/** Free Markdown notes on the page (stored in the widget's settings). */
export const taskNotesBlock: BlockDefinition = {
	id: 'task-notes',
	name: 'Notes',
	icon: 'notebook-pen',
	description: 'A scratchpad for plans and reminders, in Markdown.',
	hint: 'A Markdown scratchpad',
	surfaces: ['tasks'],
	frame: 'card',
	defaultSize: { w: 4, h: 1 },
	defaultConfig: { text: '' },
	render(ctx) {
		const root = ctx.el.createDiv({ cls: 'ws-rich ws-notes-widget' });
		let editing = false;
		let scope: Component | null = null;
		const paint = () => {
			if (scope) ctx.component.removeChild(scope);
			scope = new Component();
			ctx.component.addChild(scope);
			root.empty();
			const text = typeof ctx.config.text === 'string' ? ctx.config.text : '';
			if (editing) {
				const ta = root.createEl('textarea', { cls: 'ws-input ws-notes-widget__input', attr: { rows: '8', 'aria-label': 'Notes' } });
				ta.value = text;
				// The box grows with the text instead of being dragged wider than its widget.
				const grow = () => {
					ta.setCssStyles({ height: 'auto' });
					ta.style.height = `${Math.max(140, ta.scrollHeight + 2)}px`;
				};
				ta.addEventListener('input', grow);
				window.requestAnimationFrame(grow);
				ta.addEventListener('blur', () => {
					editing = false;
					ctx.config = { ...ctx.config, text: ta.value };
					ctx.setConfig?.(ctx.config);
					paint();
				});
				window.setTimeout(() => ta.focus(), 0);
				return;
			}
			const preview = root.createDiv({ cls: 'ws-rich__preview markdown-rendered', attr: { tabindex: '0', role: 'button', 'aria-label': 'Edit notes' } });
			if (text.trim()) void MarkdownRenderer.render(ctx.app, text, preview, '', scope);
			else preview.createDiv({ cls: 'ws-rich__placeholder', text: 'Click to write plans, reminders, goals…' });
			preview.addEventListener('click', (ev) => {
				if ((ev.target as HTMLElement).closest('a')) return;
				editing = true;
				paint();
			});
			preview.addEventListener('keydown', (ev) => {
				if (ev.key === 'Enter') {
					editing = true;
					paint();
				}
			});
		};
		const a = blockActions(ctx.el);
		if (a) button(a, { icon: 'pencil', variant: 'quiet', size: 'sm', tooltip: 'Edit', onClick: () => {
			editing = true;
			paint();
		} });
		paint();
	},
};
