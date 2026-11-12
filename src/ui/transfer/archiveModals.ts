import type { WorldsmithContext } from '../../app/context';
import type { ArchiveDependency, ArchiveManifest } from '../../services/transfer/archive';
import { WorldArchiveService, type ExportChoices, type ExportPlan, type ImportJournal, type ImportReport } from '../../services/transfer/worldArchive';
import { button, cx, icon } from '../components/dom';
import { WorldsmithModal } from '../components/modals';
import { dateStamp, exportsFolder } from './files';

/**
 * World archives in the Import & export studio (0.19): Export world, Import world and
 * Verify archive. Every step shows what it is doing; success is shown only after the
 * service has verified the result.
 */

export function formatBytes(n: number): string {
	if (n < 1024) return `${n} B`;
	if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB`;
	if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
	return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

/** A labelled progress bar. */
export class ProgressView {
	private label: HTMLElement;
	private bar: HTMLElement;
	private count: HTMLElement;
	constructor(parent: HTMLElement, title: string) {
		const el = parent.createDiv({ cls: 'ws-arch-progress', attr: { role: 'status', 'aria-live': 'polite' } });
		el.createDiv({ cls: 'ws-arch-progress__title', text: title });
		this.label = el.createDiv({ cls: 'ws-arch-progress__label', text: 'Starting…' });
		const track = el.createDiv({ cls: 'ws-arch-progress__track' });
		this.bar = track.createDiv({ cls: 'ws-arch-progress__bar' });
		this.count = el.createDiv({ cls: 'ws-arch-progress__count' });
	}
	update(stage: string, done: number, total: number): void {
		this.label.setText(stage);
		const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
		this.bar.style.width = `${total > 1 ? pct : 0}%`;
		this.bar.toggleClass('is-indeterminate', total <= 1);
		this.count.setText(total > 1 ? `${done.toLocaleString()} of ${total.toLocaleString()}` : '');
	}
}

export function countsGrid(parent: HTMLElement, rows: Array<[string, number]>): void {
	const g = parent.createDiv({ cls: 'ws-arch-counts' });
	for (const [label, n] of rows) {
		const c = g.createDiv({ cls: 'ws-arch-count' });
		c.createDiv({ cls: 'ws-arch-count__n', text: n.toLocaleString() });
		c.createDiv({ cls: 'ws-arch-count__label', text: label });
	}
}

export function callout(parent: HTMLElement, kind: 'ok' | 'warn' | 'error' | 'info', title: string, body?: string): HTMLElement {
	const c = parent.createDiv({ cls: cx('ws-arch-callout', `is-${kind}`), attr: { role: kind === 'error' ? 'alert' : 'note' } });
	icon(c, kind === 'ok' ? 'circle-check' : kind === 'warn' ? 'triangle-alert' : kind === 'error' ? 'octagon-alert' : 'info', 'ws-arch-callout__icon');
	const t = c.createDiv({ cls: 'ws-arch-callout__text' });
	t.createDiv({ cls: 'ws-arch-callout__title', text: title });
	if (body) t.createDiv({ cls: 'ws-arch-callout__body', text: body });
	return t;
}

/** A folded list (“Show 12 files”). */
export function foldList(parent: HTMLElement, label: string, items: Array<{ main: string; sub?: string }>): void {
	if (!items.length) return;
	const d = parent.createEl('details', { cls: 'ws-arch-fold' });
	d.createEl('summary', { text: label });
	const ul = d.createEl('ul', { cls: 'ws-arch-fold__list' });
	for (const it of items.slice(0, 500)) {
		const li = ul.createEl('li');
		li.createDiv({ cls: 'ws-arch-fold__main', text: it.main });
		if (it.sub) li.createDiv({ cls: 'ws-arch-fold__sub', text: it.sub });
	}
	if (items.length > 500) ul.createEl('li', { cls: 'ws-arch-fold__more', text: `…and ${items.length - 500} more` });
}

export const depItems = (deps: ArchiveDependency[]) => deps.map((d) => ({ main: d.vaultPath, sub: d.usedBy.slice(0, 3).join(' · ') + (d.usedBy.length > 3 ? ` · +${d.usedBy.length - 3}` : '') }));

// ── export ──────────────────────────────────────────────────────────────────

export class ExportArchiveModal extends WorldsmithModal {
	private plan: ExportPlan | null = null;
	private choices: ExportChoices = { adopted: true, extra: true, scenes: true };
	private busy = false;

	constructor(private readonly ws: WorldsmithContext) {
		super(ws.app);
		this.modalEl.addClass('ws-arch-modal', 'ws-arch-modal--export');
	}

	override onOpen(): void {
		this.setTitle(`Export ${this.ws.worlds.session?.world.name ?? 'world'}`);
		this.contentEl.createDiv({ cls: 'ws-arch-loading', text: 'Looking at what the world uses…' });
		void this.ws.archives.plan().then(
			(p) => {
				this.plan = p;
				this.paint();
			},
			(e) => this.fail(e),
		);
	}

	override onClose(): void {
		// Closing never cancels a running export; it finishes and keeps its file.
	}

	private paint(): void {
		const p = this.plan!;
		const c = this.contentEl;
		c.empty();
		const wrap = c.createDiv({ cls: 'ws-arch' });
		wrap.createEl('p', { cls: 'ws-arch__lead', text: 'One .worldsmith.zip file with everything this world needs in another vault: its data, notes, images and attachments. It is checked after saving.' });
		countsGrid(wrap, [
			['entries', p.counts.entries],
			['types', p.counts.types],
			['connections', p.counts.relations],
			['tasks', p.counts.tasks],
			['maps', p.counts.maps],
			['writing projects', p.counts.projects],
		]);

		const groups = (g: string) => p.items.filter((i) => i.group === g);
		const size = (list: typeof p.items) => list.reduce((n, i) => n + i.size, 0);
		const sec = wrap.createDiv({ cls: 'ws-arch-section' });
		sec.createDiv({ cls: 'ws-arch-section__title', text: 'Always included' });
		const always = sec.createEl('ul', { cls: 'ws-arch-always' });
		always.createEl('li', { text: 'The world’s data: entries, types, connections, tasks, layouts, views, dashboards, maps, calendars, Writing Studio plans and note templates' });
		const native = groups('native');
		always.createEl('li', { text: `${plural(native.length, 'native note')}${native.length ? ` (${formatBytes(size(native))})` : ''}` });
		const media = p.items.filter((i) => i.kind !== 'note' && i.usedBy.some((u) => !u.startsWith('Embedded in ')));
		always.createEl('li', { text: `${plural(media.length, 'image or file', 'images and files')} the world uses (${formatBytes(size(media))})` });
		// Every file that goes along is named (0.20.2): nothing is included unseen.
		foldList(sec, 'Show the images and files', media.map((i) => ({ main: i.vaultPath, sub: i.usedBy.slice(0, 2).join(' · ') })));

		const opt = wrap.createDiv({ cls: 'ws-arch-section' });
		opt.createDiv({ cls: 'ws-arch-section__title', text: 'Your own notes — choose what goes along' });
		opt.createDiv({ cls: 'ws-arch-section__hint', text: 'These are notes you linked or adopted. Pictures embedded in a note go with it. Unrelated notes in your vault are never included.' });
		const toggle = (key: keyof ExportChoices, title: string, list: typeof p.items) => {
			const row = opt.createDiv({ cls: 'ws-arch-choice' });
			const lab = row.createEl('label', { cls: 'ws-arch-choice__label' });
			const box = lab.createEl('input', { attr: { type: 'checkbox', 'data-choice': key } });
			box.checked = this.choices[key];
			box.disabled = !list.length;
			box.addEventListener('change', () => {
				this.choices[key] = box.checked;
				this.paintTotal();
			});
			const t = lab.createDiv();
			t.createDiv({ cls: 'ws-arch-choice__title', text: `${title} (${list.length.toLocaleString()})` });
			t.createDiv({ cls: 'ws-arch-choice__sub', text: list.length ? formatBytes(size(list)) : 'None in this world' });
			foldList(row, 'Show them', list.map((i) => ({ main: i.vaultPath, sub: i.usedBy.slice(0, 2).join(' · ') })));
		};
		toggle('adopted', 'Notes linked or adopted as an entry’s note', groups('adopted'));
		toggle('extra', 'Other notes linked to entries', groups('extra'));
		toggle('scenes', 'Writing Studio scene notes', groups('scene'));
		const embedded = p.items.filter((i) => i.kind !== 'note' && !i.usedBy.some((u) => !u.startsWith('Embedded in ')));
		if (embedded.length) {
			opt.createDiv({ cls: 'ws-arch-section__hint', text: `${plural(embedded.length, 'picture or file', 'pictures and files')} embedded in these notes go${embedded.length === 1 ? 'es' : ''} along with the note that embeds ${embedded.length === 1 ? 'it' : 'them'}.` });
			foldList(opt, 'Show them', embedded.map((i) => ({ main: i.vaultPath, sub: i.viaNotes.slice(0, 2).map((n) => `in ${n}`).join(' · ') })));
		}

		if (p.missing.length) {
			const t = callout(wrap, 'warn', `${plural(p.missing.length, 'file')} the world uses ${p.missing.length === 1 ? 'is' : 'are'} missing from your vault`, 'They can’t be included. The archive lists them, so you know what to look for.');
			foldList(t, 'Show which', depItems(p.missing));
		}
		if (p.remote.length) {
			const t = callout(wrap, 'info', `${plural(p.remote.length, 'image')} ${p.remote.length === 1 ? 'is a web address' : 'are web addresses'}`, 'Web images aren’t downloaded; the archive keeps their addresses.');
			foldList(t, 'Show which', depItems(p.remote));
		}
		wrap.createDiv({ cls: 'ws-arch-total' });
		this.paintTotal();
		wrap.createDiv({ cls: 'ws-arch-where', text: `Saved in ${exportsFolder(this.ws)} — a new file each time, nothing is written over.` });
		const actions = wrap.createDiv({ cls: 'ws-modal-actions' });
		button(actions, { label: 'Cancel', variant: 'ghost', onClick: () => this.close() });
		button(actions, { label: 'Export', icon: 'file-output', variant: 'primary', cls: 'ws-arch-go', onClick: () => void this.run() });
	}

	private paintTotal(): void {
		const p = this.plan!;
		const el = this.contentEl.querySelector('.ws-arch-total');
		if (!el) return;
		const inc = p.items.filter((i) => WorldArchiveService.included(i, this.choices, p));
		el.setText(`About ${formatBytes(inc.reduce((n, i) => n + i.size, 0))} of notes and files, ${plural(inc.length, 'file')} in all (before compression).`);
	}

	private async run(): Promise<void> {
		if (this.busy) return;
		this.busy = true;
		const c = this.contentEl;
		c.empty();
		const wrap = c.createDiv({ cls: 'ws-arch' });
		const prog = new ProgressView(wrap, 'Exporting');
		try {
			const name = `${this.ws.worlds.session?.world.name ?? 'World'} ${dateStamp()}`;
			const r = await this.ws.archives.export(exportsFolder(this.ws), name, this.choices, (s, d, t) => prog.update(s, d, t));
			c.empty();
			const done = c.createDiv({ cls: 'ws-arch' });
			callout(done, 'ok', 'Exported and verified', `The archive was saved, read back and every file’s checksum matched.`);
			const facts = done.createDiv({ cls: 'ws-arch-facts' });
			const fact = (k: string, v: string) => {
				const row = facts.createDiv({ cls: 'ws-arch-fact' });
				row.createDiv({ cls: 'ws-arch-fact__k', text: k });
				row.createDiv({ cls: 'ws-arch-fact__v', text: v });
			};
			fact('File', r.path);
			fact('Size', formatBytes(r.bytes));
			fact('Inside', `${plural(r.manifest.counts.entries, 'entry', 'entries')}, ${plural(r.manifest.counts.notes, 'note')}, ${plural(r.manifest.counts.images, 'image')}, ${plural(r.manifest.counts.attachments, 'attachment')}`);
			if (r.manifest.missing.length) {
				const t = callout(done, 'warn', `${plural(r.manifest.missing.length, 'file')} couldn’t be included because ${r.manifest.missing.length === 1 ? 'it is' : 'they are'} missing`);
				foldList(t, 'Show which', depItems(r.manifest.missing));
			}
			const left = r.manifest.excluded.filter((d) => d.reason === 'not-chosen');
			if (left.length) {
				const t = callout(done, 'info', `${plural(left.length, 'file')} left out as you chose`);
				foldList(t, 'Show which', depItems(left));
			}
			const actions = done.createDiv({ cls: 'ws-modal-actions' });
			button(actions, { label: 'Done', variant: 'primary', onClick: () => this.close() });
		} catch (e) {
			this.fail(e);
		} finally {
			this.busy = false;
		}
	}

	private fail(e: unknown): void {
		const c = this.contentEl;
		c.empty();
		const wrap = c.createDiv({ cls: 'ws-arch' });
		callout(wrap, 'error', 'The export didn’t finish', e instanceof Error ? e.message : String(e));
		wrap.createDiv({ cls: 'ws-arch-where', text: 'Your world wasn’t changed. Nothing was left half-written.' });
		const actions = wrap.createDiv({ cls: 'ws-modal-actions' });
		button(actions, { label: 'Close', variant: 'primary', onClick: () => this.close() });
	}
}

// ── import ──────────────────────────────────────────────────────────────────

function manifestFacts(parent: HTMLElement, m: ArchiveManifest, bytes: number): void {
	const facts = parent.createDiv({ cls: 'ws-arch-facts' });
	const fact = (k: string, v: string) => {
		const row = facts.createDiv({ cls: 'ws-arch-fact' });
		row.createDiv({ cls: 'ws-arch-fact__k', text: k });
		row.createDiv({ cls: 'ws-arch-fact__v', text: v });
	};
	fact('World', m.world.name);
	fact('Made', `${new Date(m.createdAt).toLocaleString()} with Worldsmith ${m.app}`);
	fact('Archive', `format ${m.v} · ${plural(m.files.length, 'file')} · ${formatBytes(bytes)}`);
}

function manifestCounts(parent: HTMLElement, m: ArchiveManifest): void {
	const c = m.counts;
	countsGrid(parent, [
		['entries', c.entries],
		['types', c.types],
		['connections', c.relations],
		['notes', c.notes],
		['images', c.images],
		['maps', c.maps],
		['writing projects', c.projects],
		['tasks', c.tasks],
	]);
}

export class ImportArchiveModal extends WorldsmithModal {
	private busy = false;

	constructor(
		private readonly ws: WorldsmithContext,
		private readonly file: { name: string; bytes: Uint8Array },
		private readonly onOpened: () => void,
	) {
		super(ws.app);
		this.modalEl.addClass('ws-arch-modal', 'ws-arch-modal--import');
	}

	override onOpen(): void {
		this.setTitle('Import a world');
		const wrap = this.contentEl.createDiv({ cls: 'ws-arch' });
		const prog = new ProgressView(wrap, 'Checking the archive');
		prog.update(`Reading ${this.file.name}`, 0, 1);
		void this.ws.archives.inspect(this.file.bytes).then((r) => this.preview(r), (e) => this.fail(e, false));
	}

	private async preview(r: Awaited<ReturnType<WorldsmithContext['archives']['inspect']>>): Promise<void> {
		const c = this.contentEl;
		c.empty();
		const wrap = c.createDiv({ cls: 'ws-arch' });
		if (!r.ok || !r.manifest) {
			callout(wrap, 'error', 'This archive can’t be imported', 'Nothing was changed in your vault.');
			const ul = wrap.createEl('ul', { cls: 'ws-arch-problems' });
			for (const p of r.problems.slice(0, 20)) ul.createEl('li', { text: p });
			if (r.problems.length > 20) ul.createEl('li', { text: `…and ${r.problems.length - 20} more` });
			const actions = wrap.createDiv({ cls: 'ws-modal-actions' });
			button(actions, { label: 'Close', variant: 'primary', onClick: () => this.close() });
			return;
		}
		const m = r.manifest;
		manifestFacts(wrap, m, this.file.bytes.length);
		manifestCounts(wrap, m);
		const plan = await this.ws.archives.preview(r, r.exists);
		if (r.exists) callout(wrap, 'info', 'This world is already in your vault', `It will be added as a separate copy, “${m.world.name} (copy)”. Your current world isn’t changed.`);
		else callout(wrap, 'ok', 'It will be added as a new world', 'Your current worlds aren’t changed.');
		if (plan.moved.size) {
			const t = callout(wrap, 'info', `${plural(plan.moved.size, 'file')} will be placed beside a file with the same name`, 'Nothing in your vault is written over; the world is pointed at the new files.');
			foldList(t, 'Show which', [...plan.moved].map(([from, to]) => ({ main: to, sub: `instead of ${from}` })));
		}
		const reused = plan.placements.filter((p) => p.action === 'reuse').length;
		if (reused) wrap.createDiv({ cls: 'ws-arch-where', text: `${plural(reused, 'image')} ${reused === 1 ? 'is' : 'are'} already in your vault, identical, and will be used as ${reused === 1 ? 'it is' : 'they are'}.` });
		if (m.missing.length) {
			const t = callout(wrap, 'warn', `${plural(m.missing.length, 'file')} ${m.missing.length === 1 ? 'was' : 'were'} missing when this world was exported`, 'The world still imports; those images or notes will show as missing.');
			foldList(t, 'Show which', depItems(m.missing));
		}
		const left = m.excluded.filter((d) => d.reason !== 'remote');
		if (left.length) {
			const t = callout(wrap, 'info', `${plural(left.length, 'file')} ${left.length === 1 ? 'was' : 'were'} left out of this archive on purpose`);
			foldList(t, 'Show which', depItems(left));
		}
		wrap.createDiv({ cls: 'ws-arch-where', text: 'Replacing an existing world isn’t done by importing. To go back to an earlier state of a world, use Backups & recovery.' });
		const actions = wrap.createDiv({ cls: 'ws-modal-actions' });
		button(actions, { label: 'Cancel', variant: 'ghost', onClick: () => this.close() });
		button(actions, { label: r.exists ? 'Import as a copy' : 'Import', icon: 'file-input', variant: 'primary', cls: 'ws-arch-go', onClick: () => void this.run(r.exists) });
	}

	private async run(asCopy: boolean): Promise<void> {
		if (this.busy) return;
		this.busy = true;
		const c = this.contentEl;
		c.empty();
		const wrap = c.createDiv({ cls: 'ws-arch' });
		const prog = new ProgressView(wrap, 'Importing');
		try {
			const r = await this.ws.archives.import(this.file.bytes, { asCopy, archiveName: this.file.name }, (s, d, t) => prog.update(s, d, t));
			this.report(r);
		} catch (e) {
			this.fail(e, true);
		} finally {
			this.busy = false;
		}
	}

	private report(r: ImportReport): void {
		const c = this.contentEl;
		c.empty();
		const wrap = c.createDiv({ cls: 'ws-arch' });
		if (r.ok) callout(wrap, 'ok', `“${r.worldName}” is imported and checked`, `${plural(r.written, 'file')} written${r.reused ? `, ${plural(r.reused, 'identical image')} reused` : ''}. Nothing in your vault was written over.`);
		else callout(wrap, 'warn', `“${r.worldName}” is imported, but some checks didn’t pass`, 'The world is there and nothing was overwritten. See below what to look at.');
		const ul = wrap.createEl('ul', { cls: 'ws-arch-checks' });
		for (const ch of r.checks) {
			const li = ul.createEl('li', { cls: cx('ws-arch-check', ch.ok ? 'is-ok' : 'is-bad') });
			icon(li, ch.ok ? 'check' : 'x', 'ws-arch-check__icon');
			const t = li.createDiv();
			t.createDiv({ cls: 'ws-arch-check__label', text: ch.label });
			if (ch.detail) t.createDiv({ cls: 'ws-arch-check__detail', text: ch.detail });
		}
		if (r.moved.length) foldList(wrap, `${plural(r.moved.length, 'file')} placed beside a file with the same name`, r.moved.map((x) => ({ main: x.to, sub: `instead of ${x.from}` })));
		const actions = wrap.createDiv({ cls: 'ws-modal-actions' });
		button(actions, {
			label: 'Open the world',
			variant: 'primary',
			onClick: () => {
				this.close();
				this.onOpened();
			},
		});
	}

	private fail(e: unknown, started: boolean): void {
		const c = this.contentEl;
		c.empty();
		const wrap = c.createDiv({ cls: 'ws-arch' });
		callout(wrap, 'error', started ? 'The import was stopped' : 'The archive couldn’t be read', e instanceof Error ? e.message : String(e));
		if (!started) wrap.createDiv({ cls: 'ws-arch-where', text: 'Nothing was changed in your vault.' });
		const actions = wrap.createDiv({ cls: 'ws-modal-actions' });
		button(actions, { label: 'Close', variant: 'primary', onClick: () => this.close() });
	}
}

// ── verify ──────────────────────────────────────────────────────────────────

export class VerifyArchiveModal extends WorldsmithModal {
	constructor(
		private readonly ws: WorldsmithContext,
		private readonly file: { name: string; bytes: Uint8Array },
	) {
		super(ws.app);
		this.modalEl.addClass('ws-arch-modal', 'ws-arch-modal--verify');
	}

	override onOpen(): void {
		this.setTitle('Verify an archive');
		const wrap = this.contentEl.createDiv({ cls: 'ws-arch' });
		const prog = new ProgressView(wrap, 'Checking');
		prog.update(`Reading ${this.file.name}`, 0, 1);
		void this.ws.archives.inspect(this.file.bytes).then(
			(r) => {
				const c = this.contentEl;
				c.empty();
				const w = c.createDiv({ cls: 'ws-arch' });
				if (r.ok && r.manifest) {
					callout(w, 'ok', 'The archive is intact', `Every file is present and its checksum matches. This Worldsmith can import it. Nothing was changed in your vault.`);
					manifestFacts(w, r.manifest, this.file.bytes.length);
					manifestCounts(w, r.manifest);
					if (r.manifest.missing.length) {
						const t = callout(w, 'warn', `${plural(r.manifest.missing.length, 'file')} ${r.manifest.missing.length === 1 ? 'was' : 'were'} missing when it was exported`);
						foldList(t, 'Show which', depItems(r.manifest.missing));
					}
					if (r.manifest.excluded.length) {
						const t = callout(w, 'info', `${plural(r.manifest.excluded.length, 'file')} left out on purpose`);
						foldList(t, 'Show which', depItems(r.manifest.excluded));
					}
				} else {
					callout(w, 'error', 'The archive has problems', 'It can’t be imported as it is. Nothing was changed in your vault.');
					if (r.manifest) manifestFacts(w, r.manifest, this.file.bytes.length);
					const ul = w.createEl('ul', { cls: 'ws-arch-problems' });
					for (const p of r.problems.slice(0, 20)) ul.createEl('li', { text: p });
					if (r.problems.length > 20) ul.createEl('li', { text: `…and ${r.problems.length - 20} more` });
				}
				const actions = w.createDiv({ cls: 'ws-modal-actions' });
				button(actions, { label: 'Close', variant: 'primary', onClick: () => this.close() });
			},
			(e) => {
				const c = this.contentEl;
				c.empty();
				const w = c.createDiv({ cls: 'ws-arch' });
				callout(w, 'error', 'The archive couldn’t be read', e instanceof Error ? e.message : String(e));
			},
		);
	}
}

// ── an import cut short ─────────────────────────────────────────────────────

/** A card on the Import & export page for each import that didn't finish. */
export function interruptedCard(parent: HTMLElement, ws: WorldsmithContext, j: ImportJournal, done: () => void): void {
	const t = callout(parent, 'warn', `An import of “${j.worldName}” didn’t finish`, `It started ${new Date(j.startedAt).toLocaleString()} from ${j.archiveName}, and stopped before the world was ready (Obsidian may have closed). ${plural(j.created.length, 'file')} it wrote can be taken back; files changed since are kept.`);
	t.closest('.ws-arch-callout')?.addClass('ws-arch-interrupted');
	const row = t.createDiv({ cls: 'ws-arch-callout__actions' });
	button(row, {
		label: 'Undo that import',
		icon: 'undo-2',
		variant: 'primary',
		size: 'sm',
		onClick: () => void (async () => {
			const kept = await ws.archives.undoInterrupted(j);
			row.empty();
			row.createSpan({ text: kept.length ? `Undone. ${plural(kept.length, 'file')} kept because ${kept.length === 1 ? 'it' : 'they'} changed: ${kept.slice(0, 3).join(', ')}` : 'Undone. Your vault is as it was before that import.' });
			done();
		})(),
	});
}
