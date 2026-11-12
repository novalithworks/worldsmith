import { Notice } from 'obsidian';
import type { WorldsmithContext } from '../../app/context';
import type { MigrationPlan, MigrationRecord, MigrationRow } from '../../services/notes/migration';
import { MIGRATION_KEEP_MS } from '../../services/notes/migration';
import type { MigrationScope } from '../../services/notes/NoteMigrationService';
import { relativeTime } from '../../core/util/strings';
import { button, cx, icon } from '../components/dom';
import { confirmModal, WorldsmithModal } from '../components/modals';
import { actionNotice } from '../components/notice';

/**
 * Turn entries into native notes (0.17), opt-in per entry, type or world. The dry run comes
 * first and writes nothing; running it makes a world backup and keeps a safety record so the
 * whole migration can be undone until it is confirmed (or for 30 days).
 */
export class MigrationModal extends WorldsmithModal {
	private plan: MigrationPlan | null = null;
	private running = false;

	constructor(
		private readonly ws: WorldsmithContext,
		private readonly target: MigrationScope,
	) {
		super(ws.app);
		this.modalEl.addClass('ws-nn-migrate');
	}

	override onOpen(): void {
		this.setTitle(`Native notes for ${this.ws.noteMigrations.scopeLabel(this.target)}`);
		this.contentEl.createDiv({ cls: 'ws-nn-muted', text: 'Checking what would happen… nothing is written yet.' });
		void this.ws.noteMigrations.plan(this.target).then((p) => {
			this.plan = p;
			this.paint();
		});
	}

	private paint(): void {
		const c = this.contentEl;
		c.empty();
		const p = this.plan!;
		const eyebrow = c.createDiv({ cls: 'ws-nn-eyebrow' });
		icon(eyebrow, 'flask-conical');
		eyebrow.createSpan({ text: 'Dry run · nothing has been written' });
		const tiles = c.createDiv({ cls: 'ws-nn-tiles' });
		const tile = (n: number, label: string, tone = '') => {
			const t = tiles.createDiv({ cls: cx('ws-nn-tile', tone && `is-${tone}`) });
			t.createDiv({ cls: 'ws-nn-tile__n', text: String(n) });
			t.createDiv({ cls: 'ws-nn-tile__label', text: label });
		};
		tile(p.counts.create, p.counts.create === 1 ? 'new note' : 'new notes');
		tile(p.counts.link, p.counts.link === 1 ? 'existing note linked' : 'existing notes linked');
		tile(p.counts.adopt, p.counts.adopt === 1 ? 'section of yours adopted' : 'sections of yours adopted');
		tile(p.counts.clash, p.counts.clash === 1 ? 'name clash' : 'name clashes', p.counts.clash ? 'warning' : '');
		tile(p.counts.skip, 'skipped');
		const todo = p.counts.create + p.counts.link;
		c.createEl('p', {
			cls: 'ws-nn-muted',
			text: todo
				? `Each note gets Worldsmith’s Properties and sections${p.counts.long ? `, with ${p.counts.long} long-text field${p.counts.long === 1 ? '' : 's'} written into them` : ''}. First a backup of the world is made, and every note that is touched is copied, so you can undo it all. Existing notes keep every word of your own text; nothing is deleted.`
				: 'There is nothing to do here.',
		});
		if (p.rows.length) {
			const wrap = c.createDiv({ cls: 'ws-nn-rows' });
			const table = wrap.createEl('table', { cls: 'ws-nn-table ws-nn-table--plan' });
			const head = table.createEl('thead').createEl('tr');
			for (const h of ['Entry', 'What happens', 'Note']) head.createEl('th', { text: h });
			const body = table.createEl('tbody');
			const order = (r: MigrationRow) => (r.action === 'skip' ? 2 : r.clash ? 0 : 1);
			const rows = [...p.rows].sort((a, b) => order(a) - order(b) || a.name.localeCompare(b.name));
			for (const r of rows.slice(0, 300)) {
				const tr = body.createEl('tr', { cls: `is-${r.action}` });
				const who = tr.createEl('td');
				who.createEl('b', { text: r.name });
				who.createDiv({ cls: 'ws-nn-faint', text: r.typeName });
				const what = tr.createEl('td');
				what.createSpan({ cls: cx('ws-nn-pill', r.action === 'skip' ? '' : r.clash ? 'is-warning' : 'is-ok'), text: r.action === 'create' ? 'New note' : r.action === 'link' ? 'Link this note' : 'Skipped' });
				if (r.reason) what.createDiv({ cls: 'ws-nn-faint', text: r.reason });
				if (r.adopt.length) what.createDiv({ cls: 'ws-nn-faint', text: `Your “${r.adopt.join('”, “')}” section${r.adopt.length === 1 ? ' becomes the field’s' : 's become the fields’'}` });
				tr.createEl('td', { cls: 'ws-nn-path', text: r.path ?? '' });
			}
			if (rows.length > 300) c.createDiv({ cls: 'ws-nn-faint', text: `And ${rows.length - 300} more.` });
		}
		const row = c.createDiv({ cls: 'ws-modal-actions ws-nn-actions' });
		button(row, { label: 'Cancel', onClick: () => this.close() });
		if (todo)
			button(row, {
				label: `Make ${todo} native note${todo === 1 ? '' : 's'}`,
				icon: 'file-check',
				variant: 'primary',
				cls: 'ws-nn-migrate__go',
				onClick: () => void this.run(),
			});
	}

	private async run(): Promise<void> {
		if (this.running || !this.plan) return;
		this.running = true;
		const c = this.contentEl;
		c.empty();
		const msg = c.createDiv({ cls: 'ws-nn-muted', text: 'Making a backup of the world…' });
		const bar = c.createDiv({ cls: 'ws-nn-progress' }).createDiv({ cls: 'ws-nn-progress__bar' });
		try {
			const res = await this.ws.noteMigrations.run(this.target, this.plan, (done, total) => {
				msg.setText(`Writing notes… ${done} of ${total}`);
				bar.style.width = `${Math.round((done / Math.max(1, total)) * 100)}%`;
			});
			this.running = false;
			this.close();
			const n = res.record.entries.length;
			const parts = [`Made ${n} native note${n === 1 ? '' : 's'}.`];
			if (res.conflicts) parts.push(`${res.conflicts} need${res.conflicts === 1 ? 's' : ''} a decision (open the note menu).`);
			if (res.failed.length) parts.push(`${res.failed.length} couldn’t be done: ${res.failed.slice(0, 3).map((f) => `${f.name} (${f.error})`).join('; ')}.`);
			parts.push('Undo stays available in Import & export until you confirm.');
			actionNotice(parts.join(' '), { label: 'Undo', run: () => void undoMigration(this.ws, res.record) }, 15000);
			this.ws.events.emit('native-note:status', { entityId: '' });
			if (n) void this.ws.noteStyles?.afterNoteCreated();
		} catch (e) {
			this.running = false;
			msg.setText(`Stopped: ${e instanceof Error ? e.message : String(e)}. Notes already made can be undone in Import & export.`);
		}
	}

	override onClose(): void {
		this.contentEl.empty();
	}
}

export async function undoMigration(ws: WorldsmithContext, rec: MigrationRecord, ask = false): Promise<void> {
	if (ask) {
		const ok = await confirmModal(ws.app, {
			title: `Undo the native notes for ${rec.scope.label}?`,
			body: `${rec.entries.length} note${rec.entries.length === 1 ? '' : 's'}: new notes go to the trash and linked notes get their exact earlier text back. A note you’ve edited since is left as it is.`,
			confirmLabel: 'Undo',
		});
		if (!ok) return;
	}
	try {
		const r = await ws.noteMigrations.undo(rec);
		const parts = [`Undone for ${r.restored} entr${r.restored === 1 ? 'y' : 'ies'}.`];
		if (r.keptNotes.length) parts.push(`${r.keptNotes.length} note${r.keptNotes.length === 1 ? ' was' : 's were'} edited since and left as ${r.keptNotes.length === 1 ? 'it is' : 'they are'}.`);
		if (r.keptValues.length) parts.push(`Values changed since were kept for ${r.keptValues.slice(0, 3).join(', ')}${r.keptValues.length > 3 ? '…' : ''}.`);
		new Notice(parts.join(' '), 10000);
	} catch (e) {
		new Notice(`Couldn’t undo: ${e instanceof Error ? e.message : String(e)}`);
	}
	ws.events.emit('native-note:status', { entityId: '' });
}

/** Import & export → Native notes: start a migration, and the ones awaiting Confirm. */
export function renderMigrations(host: HTMLElement, ws: WorldsmithContext, repaint: () => void): void {
	const list = host.createDiv({ cls: 'ws-nn-pending' });
	void ws.noteMigrations.pending().then((recs) => {
		if (!recs.length) return;
		list.createDiv({ cls: 'ws-nn-label', text: 'Waiting for your OK' });
		for (const r of recs) {
			const row = list.createDiv({ cls: 'ws-nn-pending__row' });
			const t = row.createDiv({ cls: 'ws-nn-pending__text' });
			t.createDiv({ cls: 'ws-nn-pending__title', text: `${r.scope.label}: ${r.entries.length} note${r.entries.length === 1 ? '' : 's'}` });
			const left = Math.max(0, Math.ceil((r.createdAt + MIGRATION_KEEP_MS - Date.now()) / 86400000));
			t.createDiv({ cls: 'ws-nn-faint', text: `Made ${relativeTime(r.createdAt)} · the safety copy is kept ${left} more day${left === 1 ? '' : 's'}` });
			button(row, { label: 'Undo', variant: 'ghost', size: 'sm', onClick: () => void undoMigration(ws, r, true).then(repaint) });
			button(row, {
				label: 'Confirm',
				variant: 'ghost',
				size: 'sm',
				tooltip: 'Keep the notes and remove the safety copy (the world backup stays)',
				onClick: () =>
					void ws.noteMigrations.confirm(r).then(() => {
						new Notice('Confirmed. The world backup stays in Settings → Data & backups.');
						repaint();
					}),
			});
		}
	});
}
