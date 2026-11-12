import { Menu, Notice, setIcon } from 'obsidian';
import type { WorldsmithContext } from '../../app/context';
import type { BackupInfo } from '../../data/backup/BackupService';
import type { BackupEntry, RestoreJournal } from '../../services/backup/BackupManager';
import type { ImportCheck } from '../../services/transfer/worldArchive';
import type { WorldSession } from '../../services/WorldSession';
import { button, cx, icon } from '../components/dom';
import { confirmModal, WorldsmithModal } from '../components/modals';
import { callout, foldList, formatBytes, interruptedCard, plural, ProgressView } from '../transfer/archiveModals';
import { exportsFolder } from '../transfer/files';
import type { RouteContext, RouteDefinition } from '../views/routes/RouteRegistry';
import { ROUTES } from '../../state/route';

/**
 * Backups & recovery (0.20): automatic backup settings, history (verify, restore, copy,
 * delete), and anything that needs attention after a crash (interrupted restores and imports,
 * damaged files set aside, a failing automatic backup).
 */

export const backupsRoute: RouteDefinition = {
	id: 'backups',
	needsWorld: true,
	title: () => 'Backups & recovery',
	icon: () => 'life-buoy',
	render(ctx) {
		new BackupsPage(ctx, ctx.session!).mount();
	},
};

export const KIND_LABELS: Record<string, string> = {
	auto: 'Automatic',
	manual: 'Manual',
	'before-restore': 'Before a restore',
	'before-migration': 'Before an upgrade',
	'before-delete': 'Before deleting',
};
const KIND_ICONS: Record<string, string> = { auto: 'clock', manual: 'save', 'before-restore': 'shield-check', 'before-migration': 'shield-check', 'before-delete': 'shield-check' };

function relTime(t: number): string {
	const s = Math.round((Date.now() - t) / 1000);
	if (s < 60) return 'just now';
	const m = Math.round(s / 60);
	if (m < 60) return `${m} minute${m === 1 ? '' : 's'} ago`;
	const h = Math.round(m / 60);
	if (h < 48) return `${h} hour${h === 1 ? '' : 's'} ago`;
	const d = Math.round(h / 24);
	return `${d} days ago`;
}

const INTERVALS: Array<[number, string]> = [
	[15, 'every 15 minutes'],
	[30, 'every 30 minutes'],
	[60, 'every hour'],
	[240, 'every 4 hours'],
	[1440, 'once a day'],
];

function checksList(parent: HTMLElement, checks: ImportCheck[]): void {
	const ul = parent.createEl('ul', { cls: 'ws-arch-checks' });
	for (const ch of checks) {
		const li = ul.createEl('li', { cls: cx('ws-arch-check', ch.ok ? 'is-ok' : 'is-bad') });
		icon(li, ch.ok ? 'check' : 'x', 'ws-arch-check__icon');
		const t = li.createDiv();
		t.createDiv({ cls: 'ws-arch-check__label', text: ch.label });
		if (ch.detail) t.createDiv({ cls: 'ws-arch-check__detail', text: ch.detail });
	}
}

class BackupsPage {
	private page!: HTMLElement;
	private dead = false;

	constructor(
		private readonly ctx: RouteContext,
		private readonly s: WorldSession,
	) {}

	private get ws(): WorldsmithContext {
		return this.ctx.ws;
	}

	mount(): void {
		this.page = this.ctx.el.createDiv({ cls: 'ws-page ws-page--backups' });
		this.ctx.component.register(() => (this.dead = true));
		const off = this.ws.backups.onChange(() => !this.dead && this.paintStatusOnly());
		this.ctx.component.register(() => void off());
		void this.paint().catch((e) => console.error('[Worldsmith] backups page', e));
	}

	private statusEl: HTMLElement | null = null;

	private async paint(): Promise<void> {
		const page = this.page;
		page.empty();
		const head = page.createDiv({ cls: 'ws-studio-head' });
		icon(head.createDiv({ cls: 'ws-db-header__mark ws-tint--green' }), 'life-buoy');
		const ht = head.createDiv({ cls: 'ws-db-header__text' });
		ht.createEl('h1', { cls: 'ws-db-header__title', text: 'Backups & recovery' });
		ht.createDiv({ cls: 'ws-db-header__desc', text: `Copies of ${this.s.world.name} you can check and go back to. Everything stays on your device.` });

		const alerts = page.createDiv({ cls: 'ws-bk-alerts' });
		this.alertsEl = alerts;
		this.statusEl = page.createDiv({ cls: 'ws-bk-status' });
		const history = page.createDiv({ cls: 'ws-bk-history' });
		const older = page.createDiv({ cls: 'ws-bk-older' });
		await this.paintAlerts(alerts);
		await this.paintStatus();
		await this.paintHistory(history);
		await this.paintOlder(older);
	}

	private alertsEl: HTMLElement | null = null;

	private paintStatusOnly(): void {
		void this.paintStatus().catch(() => undefined);
		// When an operation ends, what needs attention may have changed (a restore finished).
		if (!this.ws.backups.status.running && this.alertsEl) void this.paintAlerts(this.alertsEl).catch(() => undefined);
	}

	// ── needs attention ────────────────────────────────────────────────────

	private async paintAlerts(el: HTMLElement): Promise<void> {
		el.empty();
		const bm = this.ws.backups;
		for (const j of await bm.interruptedRestores()) this.restoreCard(el, j);
		for (const j of await this.ws.archives.interrupted()) interruptedCard(el, this.ws, j, () => undefined);
		const bad = await bm.quarantined();
		if (bad.length) {
			const t = callout(el, 'warn', `${plural(bad.length, 'damaged file')} ${bad.length === 1 ? 'was' : 'were'} set aside`, 'Worldsmith couldn’t read them, so it kept a copy and loaded the rest of your data without them. If something is missing, restore a backup from before the damage (as a new world first, to compare). The copies stay where they are for you to inspect.');
			t.closest('.ws-arch-callout')?.addClass('ws-bk-quarantine');
			foldList(t, 'Show which', bad.map((p) => ({ main: p.split('/').pop() ?? p, sub: p })));
		}
	}

	private restoreCard(el: HTMLElement, j: RestoreJournal): void {
		const t = callout(el, 'warn', `A restore of “${j.worldName}” didn’t finish`, j.phase === 'staging' ? 'It stopped before changing anything.' : `It stopped partway (Obsidian may have closed). You can put the world back as it was before the restore, or keep what was restored. A safety backup from just before is in the list either way.`);
		t.closest('.ws-arch-callout')?.addClass('ws-bk-interrupted');
		const row = t.createDiv({ cls: 'ws-arch-callout__actions' });
		button(row, {
			label: 'Put it back as it was',
			icon: 'undo-2',
			variant: 'primary',
			size: 'sm',
			cls: 'ws-bk-undo-restore',
			onClick: () => void (async () => {
				const kept = await this.ws.backups.undoInterruptedRestore(j);
				new Notice(kept.length ? `The world is back as it was. ${plural(kept.length, 'file')} you changed since ${kept.length === 1 ? 'was' : 'were'} kept.` : 'The world is back as it was before the restore.');
				void this.paint();
			})(),
		});
		if (j.phase !== 'staging')
			button(row, {
				label: 'Keep the restored version',
				variant: 'ghost',
				size: 'sm',
				onClick: () => void (async () => {
					await this.ws.backups.keepInterruptedRestore(j);
					void this.paint();
				})(),
			});
	}

	// ── status and settings ────────────────────────────────────────────────

	private async paintStatus(): Promise<void> {
		const el = this.statusEl;
		if (!el) return;
		const bm = this.ws.backups;
		const set = this.ws.settings.backups;
		const list = await bm.list(this.s.worldId);
		if (this.dead) return;
		el.empty();
		const card = el.createEl('section', { cls: 'ws-xcard ws-tint--green ws-bk-card' });
		const top = card.createDiv({ cls: 'ws-bk-top' });
		const last = list[0];
		const lastGood = list.find((e) => e.verified === 'ok');
		const summary = top.createDiv({ cls: 'ws-bk-summary' });
		summary.createDiv({ cls: 'ws-bk-summary__title', text: last ? `Last backup ${relTime(last.createdAt)}` : 'No backups yet' });
		summary.createDiv({
			cls: 'ws-bk-summary__sub',
			text: last ? `${new Date(last.createdAt).toLocaleString()} · ${KIND_LABELS[last.kind] ?? last.kind} · ${last.verified === 'ok' ? 'verified' : last.verified === 'failed' ? 'failed its check' : 'not checked yet'}` : 'Make one now, or let automatic backups start within the hour.',
		});
		const go = button(top, { label: bm.status.running ? 'Working…' : 'Back up now', icon: 'save', variant: 'primary', cls: 'ws-bk-now', onClick: () => void this.backupNow(card) });
		go.disabled = bm.status.running;

		if (bm.status.lastError) callout(card, 'error', 'The last backup failed', `${bm.status.lastError}. Your older backups were kept. Worldsmith tries again at the next interval.`);
		else if (last && !lastGood) callout(card, 'warn', 'None of the backups has passed its check', 'Use Verify on one, or make a new backup.');

		const opts = card.createDiv({ cls: 'ws-bk-opts' });
		const save = async () => {
			await this.ws.saveSettings();
			void this.paintStatus();
		};
		const row = (title: string, hint: string) => {
			const r = opts.createDiv({ cls: 'ws-bk-opt' });
			const t = r.createDiv({ cls: 'ws-bk-opt__text' });
			t.createDiv({ cls: 'ws-bk-opt__title', text: title });
			t.createDiv({ cls: 'ws-bk-opt__hint', text: hint });
			return r.createDiv({ cls: 'ws-bk-opt__control' });
		};
		const auto = row('Automatic backups', set.auto ? `On, ${INTERVALS.find(([m]) => m === set.intervalMinutes)?.[1] ?? `every ${set.intervalMinutes} minutes`} while Obsidian is open. Skipped when nothing changed.` : 'Off. Only backups you make yourself (and safety backups before a restore).');
		const tog = auto.createEl('input', { attr: { type: 'checkbox', 'aria-label': 'Automatic backups', 'data-opt': 'auto' } });
		tog.checked = set.auto;
		tog.addEventListener('change', () => {
			set.auto = tog.checked;
			void save();
		});
		const every = row('How often', 'An automatic backup is made when this much time has passed since the last one.');
		const sel = every.createEl('select', { cls: 'dropdown', attr: { 'aria-label': 'How often', 'data-opt': 'interval' } });
		for (const [m, label] of INTERVALS) sel.createEl('option', { text: label[0]!.toUpperCase() + label.slice(1), attr: { value: String(m) } });
		sel.value = String(set.intervalMinutes);
		sel.disabled = !set.auto;
		sel.addEventListener('change', () => {
			set.intervalMinutes = Number(sel.value);
			void save();
		});
		const keep = row('How many to keep', 'The oldest are deleted once a new backup has been made and checked. The newest checked backup is never deleted.');
		const num = (key: 'keepAuto' | 'keepManual', label: string) => {
			const w = keep.createEl('label', { cls: 'ws-bk-keep' });
			w.createSpan({ text: label });
			const i = w.createEl('input', { attr: { type: 'number', min: '1', max: key === 'keepAuto' ? '100' : '200', value: String(set[key]), 'data-opt': key } });
			i.addEventListener('change', () => {
				const v = Math.round(Number(i.value));
				if (!Number.isFinite(v) || v < 1) return void (i.value = String(set[key]));
				set[key] = Math.min(key === 'keepAuto' ? 100 : 200, v);
				void save();
			});
		};
		num('keepAuto', 'Automatic');
		num('keepManual', 'Manual');
		const imgs = row('Images in automatic backups', set.autoImages ? 'Included. Uses more disk space.' : 'Not included, to save disk space: automatic backups hold the world’s data and all its notes. Backups you make yourself always include images.');
		const it = imgs.createEl('input', { attr: { type: 'checkbox', 'aria-label': 'Images in automatic backups', 'data-opt': 'autoImages' } });
		it.checked = set.autoImages;
		it.addEventListener('change', () => {
			set.autoImages = it.checked;
			void save();
		});

		const foot = card.createDiv({ cls: 'ws-xcard__note ws-bk-where' });
		icon(foot, 'folder-open');
		foot.createSpan({ text: `Kept in ${bm.dir(this.s.worldId)} inside your vault, so sync and backup tools you use copy them too. ${list.length ? `${plural(list.length, 'backup')} use ${formatBytes(bm.totalSize(list))}.` : ''}` });
		const foot2 = card.createDiv({ cls: 'ws-xcard__note' });
		icon(foot2, 'info');
		foot2.createSpan({ text: 'A backup holds the world’s data, its native notes, the notes you linked or adopted, and Writing Studio scenes. Backups you make yourself also hold images and scene snapshots; automatic ones leave both out to stay small (images can be switched on above). Notes not linked to the world are never included.' });
	}

	private async backupNow(card: HTMLElement): Promise<void> {
		const host = card.createDiv({ cls: 'ws-bk-progress' });
		const prog = new ProgressView(host, 'Backing up');
		try {
			await this.ws.backups.create('manual', { progress: (s, d, t) => prog.update(s, d, t) });
			new Notice('Backup made and verified.');
		} catch (e) {
			new Notice(e instanceof Error ? e.message : String(e), 12000);
		}
		void this.paint();
	}

	// ── history ────────────────────────────────────────────────────────────

	private async paintHistory(el: HTMLElement): Promise<void> {
		el.empty();
		const list = await this.ws.backups.list(this.s.worldId);
		el.createEl('h2', { cls: 'ws-bk-h2', text: 'Backups' });
		if (!list.length) {
			el.createDiv({ cls: 'ws-bk-empty', text: 'No backups of this world yet. A backup is a checked copy you can go back to if something goes wrong, or restore as a separate world. The first automatic one is made within the hour; Back up now makes one straight away.' });
			return;
		}
		const ul = el.createDiv({ cls: 'ws-bk-list', attr: { role: 'list' } });
		for (const e of list) this.row(ul, e);
	}

	private row(parent: HTMLElement, e: BackupEntry): void {
		const r = parent.createDiv({ cls: cx('ws-bk-row', `is-${e.verified}`), attr: { role: 'listitem', 'data-file': e.file } });
		const g = r.createDiv({ cls: 'ws-bk-row__icon' });
		setIcon(g, KIND_ICONS[e.kind] ?? 'archive');
		const main = r.createDiv({ cls: 'ws-bk-row__main' });
		main.createDiv({ cls: 'ws-bk-row__title', text: new Date(e.createdAt).toLocaleString() });
		main.createDiv({ cls: 'ws-bk-row__sub', text: `${relTime(e.createdAt)} · ${KIND_LABELS[e.kind] ?? e.kind} · ${formatBytes(e.size)}` });
		const c = e.counts;
		main.createDiv({ cls: 'ws-bk-row__what', text: `${plural(c.entries, 'entry', 'entries')} · ${plural(c.notes, 'note')} · ${e.images ? plural(c.images, 'image') : 'no images'}${e.missing ? ` · ${e.missing} missing when made` : ''}` });
		const chip = r.createDiv({ cls: cx('ws-bk-chip', `is-${e.verified}`) });
		icon(chip, e.verified === 'ok' ? 'circle-check' : e.verified === 'failed' ? 'circle-alert' : 'circle-dashed');
		chip.createSpan({ text: e.verified === 'ok' ? 'Verified' : e.verified === 'failed' ? 'Failed check' : 'Not checked' });
		if (e.verified === 'ok' && e.verifiedAt) chip.setAttr('title', `Checked ${new Date(e.verifiedAt).toLocaleString()}`);
		if (e.problem) chip.setAttr('title', e.problem);
		const actions = r.createDiv({ cls: 'ws-bk-row__actions' });
		button(actions, { label: 'Verify', variant: 'ghost', size: 'sm', cls: 'ws-bk-verify', onClick: () => void this.verify(e) });
		button(actions, { label: 'Restore…', variant: 'ghost', size: 'sm', cls: 'ws-bk-restore', onClick: () => new RestoreModal(this.ws, this.s.worldId, e, () => void this.paint(), (r2) => this.ctx.navigate(r2)).open() });
		const more = button(actions, { icon: 'more-horizontal', variant: 'quiet', size: 'sm', ariaLabel: 'More', cls: 'ws-bk-more', onClick: () => {} });
		more.addEventListener('click', (evt) => {
			const m = new Menu();
			m.addItem((i) =>
				i
					.setTitle('Save a copy to Exports')
					.setIcon('copy')
					.onClick(async () => {
						try {
							const p = await this.ws.backups.exportCopy(this.s.worldId, e, exportsFolder(this.ws));
							new Notice(`Copy saved to ${p}. It’s a world archive: it can be imported into any vault.`);
						} catch (err) {
							new Notice(`The copy couldn’t be saved: ${err instanceof Error ? err.message : String(err)}`);
						}
					}),
			);
			m.addItem((i) =>
				i
					.setTitle('Delete this backup')
					.setIcon('trash-2')
					.onClick(async () => {
						const ok = await confirmModal(this.ws.app, { title: 'Delete this backup?', body: `The backup from ${new Date(e.createdAt).toLocaleString()} is deleted. The world itself isn’t changed.`, confirmLabel: 'Delete backup', danger: true });
						if (!ok) return;
						await this.ws.backups.remove(this.s.worldId, e);
						void this.paint();
					}),
			);
			m.showAtMouseEvent(evt);
		});
	}

	private async verify(e: BackupEntry): Promise<void> {
		const r = await this.ws.backups.verify(this.s.worldId, e);
		new Notice(r.verified === 'ok' ? 'The backup is intact: every file is there and matches.' : `The backup failed its check: ${r.problem ?? 'it’s damaged'}`, r.verified === 'ok' ? 5000 : 12000);
		void this.paint();
	}

	// ── older backups (before 0.20) ────────────────────────────────────────

	private async paintOlder(el: HTMLElement): Promise<void> {
		el.empty();
		const list: BackupInfo[] = await this.ws.db.backups.list(this.s.worldId);
		if (!list.length) return;
		el.createEl('h2', { cls: 'ws-bk-h2', text: 'Older backups' });
		el.createDiv({ cls: 'ws-bk-empty', text: 'Made by earlier versions of Worldsmith, or before a data upgrade. They hold the world’s data and native notes only (no images or other notes), and can’t be verified.' });
		const ul = el.createDiv({ cls: 'ws-bk-list' });
		for (const b of list) {
			const r = ul.createDiv({ cls: 'ws-bk-row is-legacy' });
			setIcon(r.createDiv({ cls: 'ws-bk-row__icon' }), 'archive');
			const main = r.createDiv({ cls: 'ws-bk-row__main' });
			main.createDiv({ cls: 'ws-bk-row__title', text: b.createdAt ? new Date(b.createdAt).toLocaleString() : b.name });
			main.createDiv({ cls: 'ws-bk-row__sub', text: b.createdAt ? relTime(b.createdAt) : b.path });
			const actions = r.createDiv({ cls: 'ws-bk-row__actions' });
			button(actions, {
				label: 'Restore as a new world',
				variant: 'ghost',
				size: 'sm',
				onClick: () => void (async () => {
					try {
						await this.ws.backups.restoreLegacyAsNew(b.path);
						new Notice('Restored as a separate world.');
						this.ctx.navigate(ROUTES.dashboard());
					} catch (e) {
						new Notice(e instanceof Error ? e.message : String(e), 12000);
					}
				})(),
			});
			button(actions, {
				label: 'Restore over this world…',
				variant: 'ghost',
				size: 'sm',
				cls: 'ws-bk-legacy-restore',
				onClick: () => void (async () => {
					const ok = await confirmModal(this.ws.app, {
						title: 'Restore this older backup over the world?',
						body: 'Entries in the backup go back to their saved state; entries made since are kept. A safety backup of the world as it is now is made first, so you can go back.',
						confirmLabel: 'Restore',
						danger: true,
					});
					if (!ok) return;
					try {
						const res = await this.ws.backups.restoreLegacy(b.path);
						new Notice(`Restored. A safety backup of the world from just before is in the list.${res.notesMoved ? ` ${plural(res.notesMoved, 'native note')} you changed since kept your version (the backup’s is beside it as “(restored)”).` : ''}`, 12000);
					} catch (e) {
						new Notice(e instanceof Error ? e.message : String(e), 12000);
					}
					void this.paint();
				})(),
			});
		}
	}
}

// ── restore dialog ──────────────────────────────────────────────────────────

class RestoreModal extends WorldsmithModal {
	private busy = false;

	constructor(
		private readonly ws: WorldsmithContext,
		private readonly worldId: string,
		private readonly e: BackupEntry,
		private readonly done: () => void,
		private readonly navigate: (r: ReturnType<typeof ROUTES.dashboard>) => void,
	) {
		super(ws.app);
		this.modalEl.addClass('ws-arch-modal', 'ws-bk-restore-modal');
	}

	override onOpen(): void {
		this.setTitle('Restore a backup');
		this.choose();
	}

	private choose(): void {
		const c = this.contentEl;
		c.empty();
		const wrap = c.createDiv({ cls: 'ws-arch' });
		wrap.createEl('p', { cls: 'ws-arch__lead', text: `The backup from ${new Date(this.e.createdAt).toLocaleString()} (${KIND_LABELS[this.e.kind] ?? this.e.kind.toLowerCase()}).` });
		const opt = (cls: string, ic: string, title: string, body: string, run: () => void) => {
			const b = wrap.createEl('button', { cls: cx('ws-bk-choice', cls), attr: { type: 'button' } });
			icon(b, ic, 'ws-bk-choice__icon');
			const t = b.createDiv();
			t.createDiv({ cls: 'ws-bk-choice__title', text: title });
			t.createDiv({ cls: 'ws-bk-choice__body', text: body });
			b.addEventListener('click', run);
		};
		opt('ws-bk-as-new', 'copy', 'Restore as a new world', 'The safest choice. The backup becomes a separate world beside this one, so you can look through it and copy what you need. Your current world isn’t changed.', () => void this.asNew());
		opt('ws-bk-replace', 'rotate-ccw', 'Replace the current world', `The world goes back to how it was then. A safety backup of it as it is now is made first. You’ll see what changes before anything happens.`, () => void this.preview());
		const actions = wrap.createDiv({ cls: 'ws-modal-actions' });
		button(actions, { label: 'Cancel', variant: 'ghost', onClick: () => this.close() });
	}

	private async asNew(): Promise<void> {
		if (this.busy) return;
		this.busy = true;
		const c = this.contentEl;
		c.empty();
		const wrap = c.createDiv({ cls: 'ws-arch' });
		const prog = new ProgressView(wrap, 'Restoring as a new world');
		try {
			const r = await this.ws.backups.restoreAsNew(this.worldId, this.e, (s, d, t) => prog.update(s, d, t));
			c.empty();
			const w = c.createDiv({ cls: 'ws-arch' });
			callout(w, r.ok ? 'ok' : 'warn', r.ok ? `Restored as “${r.worldName}” and checked` : `Restored as “${r.worldName}”, but some checks didn’t pass`, 'Your other worlds weren’t changed. Nothing in your vault was written over.');
			checksList(w, r.checks);
			const actions = w.createDiv({ cls: 'ws-modal-actions' });
			button(actions, {
				label: 'Open it',
				variant: 'primary',
				onClick: () => {
					this.close();
					this.navigate(ROUTES.dashboard());
				},
			});
		} catch (err) {
			this.fail(err);
		} finally {
			this.busy = false;
		}
	}

	private async preview(): Promise<void> {
		const c = this.contentEl;
		c.empty();
		const wrap = c.createDiv({ cls: 'ws-arch' });
		const prog = new ProgressView(wrap, 'Comparing the backup with the world as it is now');
		prog.update('Reading the backup', 0, 1);
		const p = await this.ws.backups.previewReplace(this.worldId, this.e);
		c.empty();
		const w = c.createDiv({ cls: 'ws-arch' });
		if (!p.ok) {
			callout(w, 'error', 'This backup can’t replace the world', p.problem);
			const a = w.createDiv({ cls: 'ws-modal-actions' });
			button(a, { label: 'Back', variant: 'ghost', onClick: () => this.choose() });
			return;
		}
		const day = new Date(this.e.createdAt).toLocaleString();
		w.createEl('p', { cls: 'ws-arch__lead', text: `The world goes back to ${day}. Here is what that changes:` });
		const ul = w.createEl('ul', { cls: 'ws-bk-changes' });
		const li = (text: string, cls = '') => ul.createEl('li', { text, cls });
		li(`${plural(p.entries.now, 'entry', 'entries')} now → ${plural(p.entries.backup, 'entry', 'entries')} after restoring.`);
		if (p.entries.changed) li(`${plural(p.entries.changed, 'entry', 'entries')} ${p.entries.changed === 1 ? 'goes back to its' : 'go back to their'} earlier version.`);
		if (p.entries.onlyBackup.length) li(`${plural(p.entries.onlyBackup.length, 'entry', 'entries')} deleted since ${p.entries.onlyBackup.length === 1 ? 'comes' : 'come'} back.`);
		if (p.entries.onlyNow.length) li(`${plural(p.entries.onlyNow.length, 'entry', 'entries')} made since the backup won’t be in the world (they stay in the safety backup).`, 'is-warn');
		li(p.notes.missing.length ? `${plural(p.notes.missing.length, 'note')} missing now ${p.notes.missing.length === 1 ? 'comes' : 'come'} back.` : 'No notes are missing.');
		if (p.notes.changed.length) li(`${plural(p.notes.changed.length, 'note')} you edited since ${p.notes.changed.length === 1 ? 'keeps' : 'keep'} your version; the backup’s version is saved beside ${p.notes.changed.length === 1 ? 'it' : 'each'} as “… (from backup)”.`, 'is-info');
		if (p.images.missing.length) li(`${plural(p.images.missing.length, 'image')} missing now ${p.images.missing.length === 1 ? 'comes' : 'come'} back.`);
		if (p.images.changed.length) li(`${plural(p.images.changed.length, 'image')} that changed since ${p.images.changed.length === 1 ? 'stays' : 'stay'} as ${p.images.changed.length === 1 ? 'it is' : 'they are'} now.`);
		if (!this.e.images) li('This backup has no images; images in the vault stay as they are.');
		if (p.entries.onlyNow.length) foldList(w, 'Entries made since the backup', p.entries.onlyNow.map((n) => ({ main: n })));
		if (p.notes.changed.length) foldList(w, 'Notes you edited since', p.notes.changed.map((n) => ({ main: n })));
		callout(w, 'info', 'Native notes you edited since keep your writing', 'Their Properties and sections stay as you left them, and the entry follows them, so nothing you wrote in a note is lost.');
		callout(w, 'ok', 'A safety backup is made first', 'If you change your mind, restore it from the list. If anything fails, the world is put back as it was.');
		const lab = w.createEl('label', { cls: 'ws-adopt__check ws-bk-confirm' });
		const box = lab.createEl('input', { attr: { type: 'checkbox' } });
		lab.createDiv({ cls: 'ws-adopt__check-title', text: `I understand the world will go back to ${day}.` });
		const actions = w.createDiv({ cls: 'ws-modal-actions' });
		button(actions, { label: 'Back', variant: 'ghost', onClick: () => this.choose() });
		const go = button(actions, { label: 'Replace with this backup', icon: 'rotate-ccw', variant: 'primary', cls: 'ws-bk-go-replace mod-warning', onClick: () => void this.replace() });
		go.disabled = true;
		box.addEventListener('change', () => (go.disabled = !box.checked));
	}

	private async replace(): Promise<void> {
		if (this.busy) return;
		this.busy = true;
		const c = this.contentEl;
		c.empty();
		const wrap = c.createDiv({ cls: 'ws-arch' });
		const prog = new ProgressView(wrap, 'Restoring');
		try {
			const r = await this.ws.backups.replace(this.worldId, this.e, (s, d, t) => prog.update(s, d, t));
			c.empty();
			const w = c.createDiv({ cls: 'ws-arch' });
			callout(w, r.ok ? 'ok' : 'warn', r.ok ? 'The world is restored and checked' : 'The world is restored, but some checks didn’t pass', `A safety backup of the world from just before is in the list.${r.restoredFiles ? ` ${plural(r.restoredFiles, 'missing file')} came back.` : ''}`);
			checksList(w, r.checks);
			if (r.beside.length) foldList(w, `${plural(r.beside.length, 'note')} kept your version; the backup’s is beside it`, r.beside.map((b) => ({ main: b.path, sub: `beside ${b.besideOf}` })));
			if (r.keptImages.length) foldList(w, `${plural(r.keptImages.length, 'image')} kept as ${r.keptImages.length === 1 ? 'it was' : 'they were'}`, r.keptImages.map((p) => ({ main: p })));
			const actions = w.createDiv({ cls: 'ws-modal-actions' });
			button(actions, {
				label: 'Done',
				variant: 'primary',
				onClick: () => {
					this.close();
					this.done();
				},
			});
		} catch (err) {
			this.fail(err);
			this.done();
		} finally {
			this.busy = false;
		}
	}

	private fail(err: unknown): void {
		const c = this.contentEl;
		c.empty();
		const w = c.createDiv({ cls: 'ws-arch' });
		callout(w, 'error', 'The restore didn’t finish', err instanceof Error ? err.message : String(err));
		const actions = w.createDiv({ cls: 'ws-modal-actions' });
		button(actions, { label: 'Close', variant: 'primary', onClick: () => this.close() });
	}
}
