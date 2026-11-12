import { Notice } from 'obsidian';
import type { ManuscriptItem } from '../../core/types';
import { diffLines, diffStats } from '../../core/util/diff';
import type { SnapshotMeta } from '../../services/writing/snapshots';
import { button, cx, icon } from '../components/dom';
import { confirmModal, promptModal, WorldsmithModal } from '../components/modals';
import { actionNotice } from '../components/notice';
import { caps, fmt, type Studio } from './kit';

/**
 * WS6 part two (0.25): revision. In the scene inspector: Snapshots (take one, the latest few,
 * compare, restore) and the project's revision passes (done or not, per scene). A compare view
 * shows a snapshot beside the scene as it is now. The Overview lists the passes with progress.
 */

const KIND_WORDS: Record<string, string> = { manual: '', auto: 'Start of the day', 'before-restore': 'Before a restore' };

function snapLabel(m: SnapshotMeta): string {
	return m.name || KIND_WORDS[m.kind] || 'Snapshot';
}

function when(t: number): string {
	return new Date(t).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

async function takeNamed(st: Studio, scene: ManuscriptItem, after: () => void): Promise<void> {
	const name = await promptModal(st.ws.app, { title: 'Take a snapshot', label: 'Name (optional)', placeholder: 'Before cutting the ending', confirmLabel: 'Take snapshot' });
	if (name === null) return;
	try {
		await st.ws.snapshots.take(scene, 'manual', name);
		new Notice('Snapshot taken.');
	} catch (e) {
		new Notice(e instanceof Error ? e.message : String(e));
	}
	after();
}

async function restoreFlow(st: Studio, scene: ManuscriptItem, m: SnapshotMeta, after: () => void): Promise<void> {
	const ok = await confirmModal(st.ws.app, {
		title: 'Restore this snapshot?',
		body: `“${scene.title}” goes back to “${snapLabel(m)}” (${when(m.createdAt)}). Your text as it is now is saved as a snapshot first, so nothing is lost.`,
		confirmLabel: 'Restore',
	});
	if (!ok) return;
	try {
		const undo = await st.ws.snapshots.restore(scene, m.id);
		actionNotice(`“${scene.title}” restored to “${snapLabel(m)}”.`, { label: 'Undo', run: () => void undo() });
	} catch (e) {
		new Notice(e instanceof Error ? e.message : String(e));
	}
	after();
}

/** The inspector's Snapshots section. */
export function renderSnapshotsSection(b: HTMLElement, st: Studio, scene: ManuscriptItem): void {
	const sec = b.createDiv({ cls: 'ws-wr-insp__field ws-wr-snaps' });
	caps(sec, 'Snapshots', 'ws-wr-sheet__label');
	if (!scene.notePath) {
		sec.createDiv({ cls: 'ws-wr-muted', text: 'This scene has no note yet.' });
		return;
	}
	const list = sec.createDiv({ cls: 'ws-wr-snaps__list' });
	const repaint = () => {
		if (!sec.isConnected) return;
		list.empty();
		void st.ws.snapshots.list(scene.id).then((all) => {
			if (!list.isConnected) return;
			list.empty();
			if (!all.length) list.createDiv({ cls: 'ws-wr-muted ws-wr-snaps__none', text: 'None yet. One is taken automatically each day you open this scene, before you change it.' });
			for (const m of all.slice(0, 4)) {
				const row = list.createDiv({ cls: cx('ws-wr-snaps__row', `is-${m.kind}`), attr: { 'data-snap': m.id } });
				const t = row.createDiv({ cls: 'ws-wr-snaps__text' });
				t.createDiv({ cls: 'ws-wr-snaps__name', text: snapLabel(m) });
				t.createDiv({ cls: 'ws-wr-snaps__meta', text: `${when(m.createdAt)} · ${fmt(m.words)} words` });
				button(row, { label: 'Compare', variant: 'ghost', size: 'sm', cls: 'ws-wr-snaps__compare', onClick: () => new CompareModal(st, scene, m, repaint).open() });
			}
			if (all.length > 4) button(list, { label: `All ${all.length} snapshots…`, variant: 'quiet', size: 'sm', cls: 'ws-wr-snaps__all', onClick: () => new SnapshotsModal(st, scene, repaint).open() });
		});
	};
	repaint();
	button(sec, { label: 'Take snapshot…', icon: 'camera', variant: 'ghost', size: 'sm', cls: 'ws-wr-snaps__take', onClick: () => void takeNamed(st, scene, repaint) });
}

/** The inspector's revision passes: a done box per pass. */
export function renderPassesSection(b: HTMLElement, st: Studio, scene: ManuscriptItem): void {
	const p = st.project!;
	const passes = p.passes ?? [];
	if (!passes.length) return;
	const sec = b.createDiv({ cls: 'ws-wr-insp__field ws-wr-passes' });
	caps(sec, 'Revision passes', 'ws-wr-sheet__label');
	for (const x of passes) {
		const lab = sec.createEl('label', { cls: 'ws-wr-passes__row', attr: { 'data-pass': x.id } });
		const box = lab.createEl('input', { attr: { type: 'checkbox' } });
		box.checked = x.done.includes(scene.id);
		lab.createSpan({ text: x.name });
		box.addEventListener('change', () => {
			const { before, after } = st.w.setPassDone(p.id, x.id, scene.id, box.checked);
			actionNotice(box.checked ? `“${scene.title}” is done in “${x.name}”.` : `“${scene.title}” is to do again in “${x.name}”.`, { label: 'Undo', run: () => st.w.restoreProject(before, after) });
		});
	}
}

/** The Overview's Revision passes: progress per pass, add, rename, remove. */
export function renderPassesOverview(st: Studio, parent: HTMLElement): void {
	const p = st.project!;
	const sec = parent.createEl('section', { cls: 'ws-wr-passview' });
	const head = sec.createDiv({ cls: 'ws-wr-passview__head' });
	caps(head, 'Revision passes', 'ws-wr-sheet__label');
	button(head, {
		label: 'New pass…',
		icon: 'plus',
		variant: 'ghost',
		size: 'sm',
		cls: 'ws-wr-passview__new',
		onClick: () => void (async () => {
			const name = await promptModal(st.ws.app, { title: 'New revision pass', label: 'What is this pass for?', placeholder: 'Tighten dialogue', confirmLabel: 'Add pass' });
			if (!name?.trim()) return;
			const { before, after } = st.w.addPass(p.id, name);
			actionNotice(`Pass “${name.trim()}” added. Mark scenes done in their inspector.`, { label: 'Undo', run: () => st.w.restoreProject(before, after) });
		})(),
	});
	const passes = p.passes ?? [];
	const total = st.w.scenes(p.id).length;
	if (!passes.length) {
		sec.createDiv({ cls: 'ws-wr-muted ws-wr-passview__none', text: 'A pass is one read-through with one aim (“continuity”, “cut 10%”). Add one, then tick scenes off in their inspector; boards can show what’s left.' });
		return;
	}
	const ul = sec.createEl('ul', { cls: 'ws-wr-passview__list' });
	for (const x of passes) {
		const done = x.done.filter((id) => st.w.item(id) && !st.w.item(id)!.trashedAt).length;
		const li = ul.createEl('li', { cls: 'ws-wr-passview__row', attr: { 'data-pass': x.id } });
		const name = li.createEl('button', { cls: 'ws-wr-passview__name', text: x.name, attr: { type: 'button', title: 'Rename' } });
		name.addEventListener('click', () => void (async () => {
			const n = await promptModal(st.ws.app, { title: 'Rename pass', value: x.name, confirmLabel: 'Rename' });
			if (!n?.trim() || n.trim() === x.name) return;
			const { before, after } = st.w.renamePass(p.id, x.id, n);
			actionNotice('Pass renamed.', { label: 'Undo', run: () => st.w.restoreProject(before, after) });
		})());
		const bar = li.createDiv({ cls: 'ws-wr-passview__bar', attr: { role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': String(total), 'aria-valuenow': String(done), 'aria-label': `${x.name}: ${done} of ${total} scenes done` } });
		bar.createDiv({ cls: 'ws-wr-passview__fill' }).style.width = `${total ? Math.round((done / total) * 100) : 0}%`;
		li.createSpan({ cls: 'ws-wr-passview__n', text: `${done} / ${total}` });
		const x2 = li.createEl('button', { cls: 'ws-wr-passview__x', attr: { type: 'button', 'aria-label': `Remove ${x.name}` } });
		icon(x2, 'x');
		x2.addEventListener('click', () => {
			const { before, after } = st.w.removePass(p.id, x.id);
			actionNotice(`Pass “${x.name}” removed.`, { label: 'Undo', run: () => st.w.restoreProject(before, after) });
		});
	}
}

/** A snapshot beside the scene as it is now. */
class CompareModal extends WorldsmithModal {
	constructor(
		private readonly st: Studio,
		private readonly scene: ManuscriptItem,
		private readonly snap: SnapshotMeta,
		private readonly after: () => void,
	) {
		super(st.ws.app);
		this.modalEl.addClass('ws-wr-compare-modal');
	}

	override onOpen(): void {
		this.setTitle(`Compare: ${snapLabel(this.snap)}`);
		void this.paint();
	}

	private async paint(): Promise<void> {
		const c = this.contentEl;
		c.empty();
		const snap = await this.st.ws.snapshots.read(this.scene.id, this.snap.id);
		const f = this.scene.notePath ? this.st.ws.app.vault.getFileByPath(this.scene.notePath) : null;
		const now = f ? await this.st.ws.app.vault.read(f) : '';
		if (!snap) {
			c.createDiv({ cls: 'ws-wr-muted', text: 'This snapshot can’t be read.' });
			return;
		}
		const ops = diffLines(snap.text, now);
		const head = c.createDiv({ cls: 'ws-wr-compare__head' });
		head.createDiv({ cls: 'ws-wr-compare__col', text: `${snapLabel(this.snap)} · ${when(snap.createdAt)} · ${fmt(snap.words)} words` });
		head.createDiv({ cls: 'ws-wr-compare__col', text: `Now · ${fmt((now.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) ?? []).length)} words` });
		if (!ops) c.createDiv({ cls: 'ws-wr-muted', text: 'These versions are too different to compare line by line. You can still restore the snapshot.' });
		else {
			const st = diffStats(ops);
			c.createDiv({ cls: 'ws-wr-compare__stats', text: st.removed || st.added ? `${st.removed} line${st.removed === 1 ? '' : 's'} only in the snapshot · ${st.added} only now` : 'No differences.' });
			const grid = c.createDiv({ cls: 'ws-wr-compare__grid', attr: { role: 'table', 'aria-label': 'Snapshot and now, line by line' } });
			for (const o of ops) {
				const row = grid.createDiv({ cls: cx('ws-wr-compare__row', `is-${o.kind}`), attr: { role: 'row' } });
				row.createDiv({ cls: 'ws-wr-compare__cell is-a', text: o.kind === 'added' ? '' : o.a, attr: { role: 'cell' } });
				row.createDiv({ cls: 'ws-wr-compare__cell is-b', text: o.kind === 'removed' ? '' : o.b, attr: { role: 'cell' } });
			}
		}
		const actions = c.createDiv({ cls: 'ws-modal-actions' });
		button(actions, { label: 'Close', variant: 'ghost', onClick: () => this.close() });
		button(actions, {
			label: 'Restore this version…',
			icon: 'history',
			variant: 'primary',
			cls: 'ws-wr-compare__restore',
			onClick: () => {
				this.close();
				void restoreFlow(this.st, this.scene, this.snap, this.after);
			},
		});
	}
}

/** Every snapshot of a scene. */
class SnapshotsModal extends WorldsmithModal {
	constructor(
		private readonly st: Studio,
		private readonly scene: ManuscriptItem,
		private readonly after: () => void,
	) {
		super(st.ws.app);
		this.modalEl.addClass('ws-wr-snaps-modal');
	}
	override onOpen(): void {
		this.setTitle(`Snapshots of “${this.scene.title}”`);
		void this.paint();
	}
	private async paint(): Promise<void> {
		const c = this.contentEl;
		c.empty();
		const all = await this.st.ws.snapshots.list(this.scene.id);
		const ul = c.createDiv({ cls: 'ws-wr-snaps__list' });
		for (const m of all) {
			const row = ul.createDiv({ cls: cx('ws-wr-snaps__row', `is-${m.kind}`) });
			const t = row.createDiv({ cls: 'ws-wr-snaps__text' });
			t.createDiv({ cls: 'ws-wr-snaps__name', text: snapLabel(m) });
			t.createDiv({ cls: 'ws-wr-snaps__meta', text: `${when(m.createdAt)} · ${fmt(m.words)} words` });
			button(row, {
				label: 'Compare',
				variant: 'ghost',
				size: 'sm',
				onClick: () => {
					this.close();
					new CompareModal(this.st, this.scene, m, this.after).open();
				},
			});
			button(row, {
				icon: 'trash-2',
				variant: 'quiet',
				size: 'sm',
				ariaLabel: `Delete snapshot ${snapLabel(m)}`,
				onClick: () => void (async () => {
					const ok = await confirmModal(this.st.ws.app, { title: 'Delete this snapshot?', body: `“${snapLabel(m)}” (${when(m.createdAt)}) is deleted. The scene isn’t changed.`, confirmLabel: 'Delete', danger: true });
					if (!ok) return;
					await this.st.ws.snapshots.remove(this.scene.id, m.id);
					this.after();
					void this.paint();
				})(),
			});
		}
		c.createDiv({ cls: 'ws-wr-sheet__help', text: 'Snapshots you take are kept until you delete them; the last 20 automatic ones and 10 from before a restore are kept per scene. They go into exports and manual backups.' });
	}
}
