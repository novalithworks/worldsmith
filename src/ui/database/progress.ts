import { setIcon, setTooltip } from 'obsidian';
import type { DevTask, EntityRecord, EntitySchema } from '../../core/types';
import { today } from '../../core/util/dates';
import { relativeTime } from '../../core/util/strings';
import type { Group } from '../../services/entryQuery';
import { missingKeyFields } from '../../services/viewQuery';
import type { WorldSession } from '../../services/WorldSession';
import { avatar } from '../components/avatar';
import { cx, icon, progressRing, statusPill, nameRegion } from '../components/dom';
import { NewTaskModal, TaskModal } from '../tasks/TaskModal';
import { checkbox, dueChip, isOverdue, priorityFlag, type TaskUiHost } from '../tasks/taskUi';

/**
 * The Progress layout (Milestone 8): how far along each entry is, what's next on its
 * checklist, and which key details are still missing — with a summary of the whole view.
 */

interface Row {
	e: EntityRecord;
	ratio: number;
	fields: { done: number; total: number };
	tasks: DevTask[];
	open: DevTask[];
	done: number;
	counted: number;
	overdue: number;
	missing: string[];
}

/** Open tasks in the order to tackle them: overdue, then due soonest, then priority, then checklist order. */
function nextFirst(a: DevTask, b: DevTask): number {
	const now = today();
	const ao = a.due && a.due < now ? 0 : 1;
	const bo = b.due && b.due < now ? 0 : 1;
	if (ao !== bo) return ao - bo;
	if (a.due !== b.due) return !a.due ? 1 : !b.due ? -1 : a.due.localeCompare(b.due);
	return b.priority - a.priority || a.order - b.order;
}

export function progressRows(s: WorldSession, schema: EntitySchema, entries: EntityRecord[]): Row[] {
	const optional = s.world.progress.includeOptional;
	return entries.map((e) => {
		const p = s.entityService.progress(e);
		const tasks = s.tasks.forEntity(e.id);
		const counted = tasks.filter((t) => optional || !t.optional);
		const open = counted.filter((t) => t.status !== 'done').sort(nextFirst);
		return {
			e,
			ratio: p.ratio,
			fields: p.fields,
			tasks,
			open,
			done: counted.length - open.length,
			counted: counted.length,
			overdue: open.filter((t) => isOverdue(t)).length,
			missing: missingKeyFields(s, schema, e),
		};
	});
}

export function renderProgressView(
	parent: HTMLElement,
	o: {
		s: WorldSession;
		schema: EntitySchema;
		host: TaskUiHost;
		entries: EntityRecord[];
		/** Present when the view is grouped. */
		groups: Group[] | null;
		collapsed: Set<string>;
		/** No sort chosen: least developed first. */
		autoOrder: boolean;
		facts: (e: EntityRecord) => string;
		wire: (el: HTMLElement, e: EntityRecord) => void;
		toggleGroup: (key: string) => void;
		openEntity: (e: EntityRecord, evt: MouseEvent) => void;
	},
): void {
	const { s, schema, host } = o;
	const all = progressRows(s, schema, o.entries);
	const byId = new Map(all.map((r) => [r.e.id, r]));
	const order = (rows: Row[]) => (o.autoOrder ? [...rows].sort((a, b) => a.ratio - b.ratio || a.e.name.localeCompare(b.e.name)) : rows);

	// Summary of everything in the view.
	const sum = parent.createDiv({ cls: 'ws-prog__summary' });
	const avg = all.length ? all.reduce((a, r) => a + r.ratio, 0) / all.length : 0;
	const tile = (cls: string, label: string, value: string, sub: string, tint: string) => {
		const t = sum.createDiv({ cls: cx('ws-prog__tile', cls, `ws-tint--${tint}`) });
		t.createDiv({ cls: 'ws-prog__tile-label', text: label });
		t.createDiv({ cls: 'ws-prog__tile-value', text: value });
		t.createDiv({ cls: 'ws-prog__tile-sub', text: sub });
		return t;
	};
	const dev = tile('is-dev', 'Developed', `${Math.round(avg * 100)}%`, `on average, across ${all.length} ${all.length === 1 ? 'entry' : 'entries'}`, 'blue');
	progressRing(dev.createDiv({ cls: 'ws-prog__tile-ring' }), avg, 44);
	const tDone = all.reduce((a, r) => a + r.done, 0);
	const tAll = all.reduce((a, r) => a + r.counted, 0);
	const tasksTile = tile('is-tasks', 'Tasks done', `${tDone} / ${tAll}`, tAll ? `${tAll - tDone} still open` : 'no checklist tasks yet', 'purple');
	const bar = tasksTile.createDiv({ cls: 'ws-bar ws-bar--thin ws-prog__tile-bar' });
	bar.createDiv({ cls: 'ws-bar__fill' }).style.width = `${tAll ? Math.round((tDone / tAll) * 100) : 0}%`;
	const over = all.reduce((a, r) => a + r.overdue, 0);
	tile(cx('is-over', over > 0 && 'is-alert').join(' '), 'Overdue', String(over), over ? `task${over === 1 ? '' : 's'} past due` : 'nothing past due', over ? 'red' : 'green');
	const complete = all.filter((r) => r.ratio >= 0.999).length;
	const gaps = all.reduce((a, r) => a + r.missing.length, 0);
	tile('is-done', 'Fully developed', String(complete), gaps ? `${gaps} key details still missing` : 'every key detail filled in', 'green');

	const table = parent.createDiv({ cls: 'ws-prog', attr: { role: 'table'} });
	nameRegion(table, `${schema.plural} progress` );
	const head = table.createDiv({ cls: 'ws-prog__row ws-prog__row--head', attr: { role: 'row' } });
	for (const h of [schema.singular, 'Developed', 'Next up', 'Still missing', '']) head.createDiv({ cls: 'ws-prog__cell', text: h, attr: { role: 'columnheader' } });

	const paintRow = (r: Row) => {
		const row = table.createDiv({ cls: 'ws-prog__row', attr: { role: 'row' } });
		o.wire(row, r.e);
		// Who
		const who = row.createDiv({ cls: 'ws-prog__cell ws-prog__who', attr: { role: 'cell' } });
		avatar(who, host.ws.app, r.e, schema, { size: 'sm' });
		const wt = who.createDiv({ cls: 'ws-prog__who-text' });
		wt.createDiv({ cls: 'ws-prog__name', text: r.e.name });
		const meta = wt.createDiv({ cls: 'ws-prog__meta' });
		statusPill(meta, s.world.statuses.find((x) => x.id === r.e.status));
		const facts = o.facts(r.e);
		if (facts) meta.createSpan({ cls: 'ws-prog__facts', text: facts });
		// Developed
		const devCell = row.createDiv({ cls: 'ws-prog__cell ws-prog__dev', attr: { role: 'cell' } });
		progressRing(devCell, r.ratio, 34);
		const dt = devCell.createDiv({ cls: 'ws-prog__dev-text' });
		dt.createDiv({ cls: 'ws-prog__dev-line', text: r.counted ? `${r.done} of ${r.counted} tasks` : 'No tasks' });
		dt.createDiv({ cls: 'ws-prog__dev-line is-faint', text: `${r.fields.done} of ${r.fields.total} key details` });
		// Next up
		const next = row.createDiv({ cls: 'ws-prog__cell ws-prog__next', attr: { role: 'cell' } });
		const t = r.open[0];
		if (t) {
			const line = next.createDiv({ cls: 'ws-prog__task' });
			checkbox(line, host, t);
			const title = line.createEl('button', { cls: 'ws-prog__task-title', attr: { type: 'button' }, text: t.title });
			title.addEventListener('click', (evt) => {
				evt.stopPropagation();
				new TaskModal(host, t.id).open();
			});
			priorityFlag(line, t.priority);
			if (t.due) dueChip(line, host, t);
			if (r.open.length > 1) next.createDiv({ cls: 'ws-prog__more', text: `+${r.open.length - 1} more open${r.overdue > 1 || (r.overdue === 1 && !isOverdue(t)) ? ` · ${r.overdue} overdue` : ''}` });
		} else if (r.counted) {
			const ok = next.createDiv({ cls: 'ws-prog__clear' });
			icon(ok, 'check-circle-2');
			ok.createSpan({ text: 'Checklist done' });
		} else next.createDiv({ cls: 'ws-prog__none', text: 'No tasks yet' });
		// Missing
		const miss = row.createDiv({ cls: 'ws-prog__cell ws-prog__missing', attr: { role: 'cell' } });
		if (!r.missing.length) {
			const ok = miss.createDiv({ cls: 'ws-prog__clear' });
			icon(ok, 'check');
			ok.createSpan({ text: 'All filled in' });
		}
		for (const m of r.missing.slice(0, 2)) {
			const chip = miss.createEl('button', { cls: 'ws-prog__gap', attr: { type: 'button' }, text: m });
			setTooltip(chip, `Fill in ${m} on ${r.e.name}’s page`, { delay: 400 });
			chip.addEventListener('click', (evt) => {
				evt.stopPropagation();
				o.openEntity(r.e, evt);
			});
		}
		if (r.missing.length > 2) {
			const more = miss.createSpan({ cls: 'ws-prog__gap-more', text: `+${r.missing.length - 2}` });
			setTooltip(more, r.missing.slice(2).join(', '), { delay: 300 });
		}
		// Actions
		const act = row.createDiv({ cls: 'ws-prog__cell ws-prog__act', attr: { role: 'cell' } });
		act.createSpan({ cls: 'ws-prog__when', text: relativeTime(r.e.updatedAt) });
		const add = act.createEl('button', { cls: 'ws-prog__add clickable-icon', attr: { type: 'button', 'aria-label': `New task for ${r.e.name}` } });
		setIcon(add, 'list-plus');
		setTooltip(add, 'Add a task', { delay: 300 });
		add.addEventListener('click', (evt) => {
			evt.stopPropagation();
			new NewTaskModal(host, { entityId: r.e.id }).open();
		});
	};

	if (!o.groups) {
		for (const r of order(all)) paintRow(r);
		return;
	}
	for (const g of o.groups) {
		const rows = g.entries.map((e) => byId.get(e.id)).filter((r): r is Row => !!r);
		const open = !o.collapsed.has(g.key);
		const gh = table.createDiv({ cls: cx('ws-prog__group', !open && 'is-collapsed') });
		const btn = gh.createEl('button', { cls: 'ws-vgroup__head', attr: { type: 'button', 'aria-expanded': String(open) } });
		const caret = btn.createSpan({ cls: 'ws-vgroup__caret' });
		setIcon(caret, 'chevron-down');
		if (g.color) btn.createSpan({ cls: cx('ws-vgroup__dot', `ws-tint--${g.color}`) });
		btn.createSpan({ cls: cx('ws-vgroup__label', g.key === '__none' && 'is-none'), text: g.label });
		btn.createSpan({ cls: 'ws-vgroup__count', text: String(rows.length) });
		const gAvg = rows.length ? rows.reduce((a, r) => a + r.ratio, 0) / rows.length : 0;
		const gb = gh.createDiv({ cls: 'ws-prog__group-bar' });
		const b = gb.createDiv({ cls: 'ws-bar ws-bar--thin' });
		b.createDiv({ cls: 'ws-bar__fill' }).style.width = `${Math.round(gAvg * 100)}%`;
		gb.createSpan({ text: `${Math.round(gAvg * 100)}% developed` });
		btn.addEventListener('click', () => o.toggleGroup(g.key));
		if (open) for (const r of order(rows)) paintRow(r);
	}
}
