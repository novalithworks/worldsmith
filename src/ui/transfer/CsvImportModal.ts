import { Notice, setIcon } from 'obsidian';
import type { WorldsmithContext } from '../../app/context';
import type { EntitySchema } from '../../core/types';
import type { CsvTable } from '../../services/transfer/csv';
import { autoMapping, BUILTIN_TARGETS, DEFAULT_IMPORT_OPTIONS, importableFields, planCsvImport, runCsvImport, type CsvImportOptions, type CsvImportPlan, type CsvMapping, type ExistingMode } from '../../services/transfer/csvImport';
import type { WorldSession } from '../../services/WorldSession';
import { ROUTES } from '../../state/route';
import { button, cx, icon } from '../components/dom';
import { WorldsmithModal } from '../components/modals';
import { actionNotice } from '../components/notice';

const PREVIEW_ROWS = 8;

/**
 * Spreadsheet import (Milestone 9): choose the type, check how columns map to fields (matched
 * by name), decide what happens to names that already exist, see exactly what will happen,
 * then import — with Undo.
 */
export class CsvImportModal extends WorldsmithModal {
	private schema: EntitySchema;
	private mapping: CsvMapping;
	private options: CsvImportOptions = { ...DEFAULT_IMPORT_OPTIONS };
	private plan!: CsvImportPlan;
	private body!: HTMLElement;

	constructor(
		private readonly ws: WorldsmithContext,
		private readonly s: WorldSession,
		private readonly table: CsvTable,
		private readonly fileName: string,
		typeId?: string,
	) {
		super(ws.app);
		this.modalEl.addClass('ws-csv-modal');
		// The type whose fields match the most columns, unless one was given.
		const types = s.schemas.list();
		const score = (t: EntitySchema) => autoMapping(t, ws.fieldTypes, table.headers).filter(Boolean).length;
		this.schema = (typeId && s.schemas.get(typeId)) || [...types].sort((a, b) => score(b) - score(a))[0]!;
		this.mapping = autoMapping(this.schema, ws.fieldTypes, table.headers);
	}

	override onOpen(): void {
		this.setTitle('Import a spreadsheet');
		this.contentEl.addClass('ws-csv');
		this.body = this.contentEl.createDiv();
		this.paint();
	}

	override onClose(): void {
		this.contentEl.empty();
	}

	private replan(): void {
		this.plan = planCsvImport(this.s, this.ws.fieldTypes, this.schema, this.table, this.mapping, this.options);
	}

	private paint(): void {
		this.replan();
		const scroll = this.body.querySelector('.ws-csv__scroll')?.scrollTop ?? 0;
		const b = this.body;
		b.empty();
		const { schema, table, plan } = this;

		const head = b.createDiv({ cls: 'ws-csv__head' });
		const file = head.createDiv({ cls: 'ws-csv__file' });
		icon(file, 'sheet');
		file.createSpan({ cls: 'ws-csv__fname', text: this.fileName });
		file.createSpan({ cls: 'ws-csv__fmeta', text: `${table.rows.length} row${table.rows.length === 1 ? '' : 's'} · ${table.headers.length} column${table.headers.length === 1 ? '' : 's'}` });
		const into = head.createDiv({ cls: 'ws-csv__into' });
		into.createSpan({ text: 'Into' });
		const sel = into.createEl('select', { cls: 'dropdown ws-csv__type', attr: { 'aria-label': 'Type to import into' } });
		for (const t of this.s.schemas.list()) sel.createEl('option', { value: t.id, text: t.plural });
		sel.value = schema.id;
		sel.addEventListener('change', () => {
			const t = this.s.schemas.get(sel.value);
			if (!t) return;
			this.schema = t;
			this.mapping = autoMapping(t, this.ws.fieldTypes, table.headers);
			this.paint();
		});

		if (table.warning) {
			const w = b.createDiv({ cls: 'ws-csv__warn ws-csv__filewarn' });
			w.setText(table.warning);
		}
		const scrollEl = b.createDiv({ cls: 'ws-csv__scroll' });

		// Columns → fields.
		const map = scrollEl.createDiv({ cls: 'ws-csv__sec' });
		map.createDiv({ cls: 'ws-csv__h', text: 'Columns' });
		map.createDiv({ cls: 'ws-fm__hint', text: 'Matched by name. Change any column, or leave it out.' });
		const grid = map.createDiv({ cls: 'ws-csv__map' });
		const fields = importableFields(schema, this.ws.fieldTypes);
		table.headers.forEach((h, col) => {
			const target = this.mapping[col] ?? null;
			const row = grid.createDiv({ cls: cx('ws-csv__col', !target && 'is-off'), attr: { 'data-col': String(col) } });
			const left = row.createDiv({ cls: 'ws-csv__src' });
			left.createDiv({ cls: 'ws-csv__src-name', text: h });
			const samples = table.rows.map((r) => (r[col] ?? '').trim()).filter(Boolean).slice(0, 2);
			left.createDiv({ cls: 'ws-csv__src-sample', text: samples.length ? samples.join(' · ') : 'empty' });
			const arrow = row.createSpan({ cls: 'ws-csv__arrow' });
			setIcon(arrow, 'arrow-right');
			const pick = row.createEl('select', { cls: 'dropdown ws-csv__target', attr: { 'aria-label': `Import “${h}” as` } });
			pick.createEl('option', { value: '', text: 'Don’t import' });
			const g1 = pick.createEl('optgroup', { attr: { label: 'Every entry' } });
			for (const bt of BUILTIN_TARGETS) g1.createEl('option', { value: bt.id, text: bt.label });
			const g2 = pick.createEl('optgroup', { attr: { label: `${schema.singular} fields` } });
			for (const f of fields) g2.createEl('option', { value: f.id, text: `${f.label}${f.type === 'relation' ? ' (links)' : ''}` });
			pick.value = target ?? '';
			pick.addEventListener('change', () => {
				const v = pick.value || null;
				// One column per target: taking it from another column clears that one.
				this.mapping = this.mapping.map((m, i) => (i === col ? v : m === v && v ? null : m));
				this.paint();
			});
		});
		if (!this.mapping.includes('__name')) map.createDiv({ cls: 'ws-csv__warn', text: 'Choose which column holds each entry’s name — rows without a name are skipped.' });

		// Options.
		const opts = scrollEl.createDiv({ cls: 'ws-csv__sec' });
		opts.createDiv({ cls: 'ws-csv__h', text: 'Options' });
		const existingCount = plan.rows.filter((r) => r.existingId).length;
		const ex = opts.createDiv({ cls: 'ws-csv__opt' });
		ex.createDiv({ cls: 'ws-csv__opt-label', text: `When a name matches an existing ${schema.singular.toLowerCase()}${existingCount ? ` (${existingCount})` : ''}` });
		const seg = ex.createDiv({ cls: 'ws-segmented ws-segmented--labels ws-segmented--sm' });
		for (const [id, label] of [
			['skip', 'Skip the row'],
			['update', 'Update it'],
			['add', 'Add another'],
		] as Array<[ExistingMode, string]>) {
			const on = this.options.existing === id;
			const btn = seg.createEl('button', { cls: cx('ws-segmented__item', on && 'is-active'), text: label, attr: { type: 'button', 'aria-pressed': String(on), 'data-mode': id } });
			btn.addEventListener('click', () => {
				this.options = { ...this.options, existing: id };
				this.paint();
			});
		}
		if (this.options.existing === 'update') ex.createDiv({ cls: 'ws-fm__hint', text: 'Filled cells replace values; empty cells never clear anything. Tags and names are added to.' });
		const choiceN = Object.values(plan.newChoices).reduce((n, l) => n + l.length, 0);
		if (choiceN) this.check(opts, 'addChoices', `Add ${choiceN} new choice${choiceN === 1 ? '' : 's'} to choice fields`, Object.entries(plan.newChoices).map(([fid, l]) => `${fields.find((f) => f.id === fid)?.label}: ${l.join(', ')}`).join(' · '));
		const linkN = Object.values(plan.missingLinks).reduce((n, l) => n + l.length, 0);
		if (linkN) this.check(opts, 'createLinked', `Create ${linkN} linked entr${linkN === 1 ? 'y' : 'ies'} that don’t exist yet`, Object.values(plan.missingLinks).flat().slice(0, 12).join(', '));

		// Preview.
		const pv = scrollEl.createDiv({ cls: 'ws-csv__sec' });
		pv.createDiv({ cls: 'ws-csv__h', text: 'What will happen' });
		const pills = pv.createDiv({ cls: 'ws-csv__pills' });
		const pill = (n: number, label: string, cls: string) => n && pills.createSpan({ cls: `ws-csv__pill ${cls}`, text: `${n} ${label}` });
		pill(plan.counts.create, 'new', 'is-new');
		pill(plan.counts.update, 'updated', 'is-update');
		pill(plan.counts.skip, 'skipped', 'is-skip');
		pill(plan.counts.problems, `with a problem`, 'is-problem');
		const list = pv.createDiv({ cls: 'ws-csv__rows' });
		// Rows with problems first, so they're seen.
		const ordered = [...plan.rows].sort((a, b) => Number(b.problems.length > 0) - Number(a.problems.length > 0) || a.index - b.index);
		for (const r of ordered.slice(0, PREVIEW_ROWS)) {
			const row = list.createDiv({ cls: cx('ws-csv__row', `is-${r.action}`, r.problems.length > 0 && 'has-problem') });
			row.createSpan({ cls: 'ws-csv__badge', text: r.action === 'create' ? 'New' : r.action === 'update' ? 'Update' : 'Skip' });
			const tx = row.createDiv({ cls: 'ws-csv__row-text' });
			tx.createDiv({ cls: 'ws-csv__row-name', text: r.name || `Row ${r.index + 2}` });
			const filled = Object.keys(r.values).length + r.links.length + (r.tags ? 1 : 0) + (r.status ? 1 : 0) + (r.aliases ? 1 : 0) + (r.description ? 1 : 0);
			tx.createDiv({ cls: 'ws-csv__row-meta', text: r.problems.length ? r.problems.join(' · ') : r.action === 'skip' && r.existingId ? `Already exists` : `${filled} value${filled === 1 ? '' : 's'}` });
		}
		if (plan.rows.length > PREVIEW_ROWS) list.createDiv({ cls: 'ws-csv__more', text: `and ${plan.rows.length - PREVIEW_ROWS} more row${plan.rows.length - PREVIEW_ROWS === 1 ? '' : 's'}` });

		const foot = b.createDiv({ cls: 'ws-modal-actions ws-csv__foot' });
		button(foot, { label: 'Cancel', variant: 'ghost', onClick: () => this.close() });
		const n = plan.counts.create + plan.counts.update;
		button(foot, {
			label: n ? `Import ${n} ${n === 1 ? schema.singular.toLowerCase() : schema.plural.toLowerCase()}` : 'Nothing to import',
			icon: 'download',
			variant: 'primary',
			cls: 'ws-csv__go',
			disabled: !n,
			onClick: () => this.run(),
		});
		scrollEl.scrollTop = scroll;
	}

	private check(parent: HTMLElement, key: 'addChoices' | 'createLinked', label: string, detail: string): void {
		const l = parent.createEl('label', { cls: 'ws-csv__check', attr: { 'data-option': key } });
		const cb = l.createEl('input', { attr: { type: 'checkbox' } });
		cb.checked = this.options[key];
		const tx = l.createDiv();
		tx.createDiv({ text: label });
		if (detail) tx.createDiv({ cls: 'ws-fm__hint', text: detail });
		cb.addEventListener('change', () => {
			this.options = { ...this.options, [key]: cb.checked };
			this.paint();
		});
	}

	private run(): void {
		const { s, schema } = this;
		try {
			const res = runCsvImport(s, this.plan, this.options);
			this.close();
			const parts = [res.created.length && `${res.created.length} new`, res.updated.length && `${res.updated.length} updated`, res.createdLinked.length && `${res.createdLinked.length} linked entr${res.createdLinked.length === 1 ? 'y' : 'ies'} created`].filter(Boolean);
			actionNotice(`Imported into ${schema.plural}: ${parts.join(', ')}.`, {
				label: 'Undo',
				run: () => {
					res.undo();
					new Notice('Import undone. New entries are in the trash.');
				},
			}, 12000);
			this.ws.open(ROUTES.database(schema.id)).catch(() => {});
		} catch (e) {
			new Notice(`Import failed: ${e instanceof Error ? e.message : String(e)}`);
		}
	}
}
