import { Menu, Notice } from 'obsidian';
import type { ManuscriptItem } from '../../core/types';
import { uuid } from '../../core/util/ids';
import { diffLines } from '../../core/util/diff';
import type { SnapshotMeta } from '../../services/writing/snapshots';
import { button, cx, icon } from '../components/dom';
import { confirmModal, promptModal } from '../components/modals';
import { actionNotice } from '../components/notice';
import { caps, head, panel, type Studio } from './kit';

/**
 * Revision (0.28): one place for revising a book. Passes on the left (each one read-through
 * with one aim, with how many scenes are done); the chosen pass's checklist; passages marked
 * while writing, with their notes; the book's snapshots, and a comparison of one with the
 * scene as it is now (restore asks first and keeps the current text as a snapshot).
 */

const USUAL = ['Structural edit', 'Character development', 'Continuity edit', 'Dialogue', 'Prose', 'Copyedit', 'Proofread'];

function when(t: number): string {
	const d = new Date(t);
	const today = new Date();
	if (d.toDateString() === today.toDateString()) return `Today ${d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`;
	return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

export class RevisionScreen {
	private readonly el: HTMLElement;
	private passId: string | null;
	private snap: { scene: ManuscriptItem; meta: SnapshotMeta } | null = null;

	constructor(
		private readonly st: Studio,
		parent: HTMLElement,
		passId: string | null,
		private readonly onSelect: (id: string | null) => void,
	) {
		this.el = parent.createDiv({ cls: 'ws-wr-revpage' });
		this.passId = passId;
	}

	mount(): void {
		this.refresh();
	}

	refresh(): void {
		if (this.el.contains(activeDocument.activeElement) && activeDocument.activeElement?.tagName === 'INPUT') return;
		const st = this.st;
		const p = st.project!;
		this.el.empty();
		const passes = p.passes ?? [];
		if (!this.passId || !passes.some((x) => x.id === this.passId)) this.passId = passes[0]?.id ?? null;
		const pass = passes.find((x) => x.id === this.passId) ?? null;
		const scenes = st.w.scenes(p.id).filter((s) => !s.trashedAt);
		const tools = head(this.el, { eyebrow: 'Revision', title: 'Revision', sub: pass ? `${pass.name} · started ${new Date(pass.createdAt).toLocaleDateString(undefined, { day: 'numeric', month: 'long' })}` : 'Read-throughs with one aim each, the passages you marked, and copies to go back to.' });
		button(tools, { label: 'Take a snapshot', icon: 'camera', variant: 'ghost', size: 'sm', cls: 'ws-wr-rev-snap', onClick: () => void this.takeSnapshot(scenes) });
		button(tools, { label: 'New pass', icon: 'plus', variant: 'primary', size: 'sm', cls: 'ws-wr-rev-newpass', onClick: () => void this.newPass() });

		const grid = this.el.createDiv({ cls: 'ws-wr-revgrid' });
		// Passes.
		const left = grid.createDiv({ cls: 'ws-wr-panel ws-wr-revpasses' });
		caps(left, 'Passes', 'ws-wr-revpasses__head');
		if (!passes.length) {
			left.createDiv({ cls: 'ws-wr-muted ws-wr-revpasses__none', text: 'No passes yet.' });
			button(left, {
				label: 'Start with the usual passes',
				variant: 'ghost',
				size: 'sm',
				cls: 'ws-wr-rev-usual',
				onClick: () => {
					const before = st.w.project(p.id)!;
					let after = before;
					for (const name of USUAL) after = st.w.addPass(p.id, name).after;
					actionNotice('Seven passes added.', { label: 'Undo', run: () => st.w.restoreProject(before, after) });
				},
			});
		}
		for (const x of passes) {
			const done = x.done.filter((id) => scenes.some((s) => s.id === id)).length;
			const checksDone = (x.checklist ?? []).length > 0 && (x.checklist ?? []).every((c) => c.done);
			const complete = (scenes.length > 0 && done >= scenes.length) || checksDone;
			const b = left.createEl('button', { cls: cx('ws-wr-revpass', x.id === this.passId && 'is-active', complete && 'is-complete'), attr: { type: 'button', 'data-pass': x.id } });
			icon(b, complete ? 'check-circle-2' : 'circle', 'ws-wr-revpass__icon');
			b.createSpan({ cls: 'ws-wr-revpass__name', text: x.name });
			if (x.id === this.passId) b.createSpan({ cls: 'ws-wr-revpass__n', text: `${done} of ${scenes.length}` });
			b.addEventListener('click', () => {
				this.passId = x.id;
				this.onSelect(x.id);
				this.refresh();
			});
			// Rename or remove a pass (Undo for both).
			const more = b.createSpan({ cls: 'ws-wr-revpass__more', attr: { role: 'button', tabindex: '0', 'aria-label': `More for ${x.name}` } });
			icon(more, 'more-horizontal');
			const menu = (e: MouseEvent | KeyboardEvent) => {
				e.stopPropagation();
				const m = new Menu();
				m.addItem((i) =>
					i
						.setTitle('Rename pass…')
						.setIcon('pencil')
						.onClick(async () => {
							const n = await promptModal(st.ws.app, { title: 'Rename pass', value: x.name, confirmLabel: 'Rename' });
							if (!n?.trim() || n.trim() === x.name) return;
							const { before, after } = st.w.renamePass(p.id, x.id, n);
							actionNotice('Pass renamed.', { label: 'Undo', run: () => st.w.restoreProject(before, after) });
						}),
				);
				m.addItem((i) =>
					i
						.setTitle('Remove pass')
						.setIcon('trash-2')
						.onClick(() => {
							const { before, after } = st.w.removePass(p.id, x.id);
							actionNotice(`Pass “${x.name}” removed.`, { label: 'Undo', run: () => st.w.restoreProject(before, after) });
						}),
				);
				if (e instanceof MouseEvent && e.detail !== 0) m.showAtMouseEvent(e);
				else {
					const r = more.getBoundingClientRect();
					m.showAtPosition({ x: r.left, y: r.bottom + 4 });
				}
			};
			more.addEventListener('click', menu);
			more.addEventListener('keydown', (e) => {
				if (e.key === 'Enter' || e.key === ' ') {
					e.preventDefault();
					menu(e);
				}
			});
		}
		if (passes.length) {
			const add = left.createEl('button', { cls: 'ws-wr-revpass__add', text: '+ Custom pass', attr: { type: 'button' } });
			add.addEventListener('click', () => void this.newPass());
		}

		// The pass's checklist, and marked passages.
		const mid = grid.createDiv({ cls: 'ws-wr-revmid' });
		if (pass) {
			const cl = panel(mid, `${pass.name} · checklist`, 'ws-wr-revcheck');
			const items = pass.checklist ?? [];
			for (const c of items) {
				const lab = cl.createEl('label', { cls: cx('ws-wr-rcheck', c.done && 'is-done'), attr: { 'data-check': c.id } });
				const box = lab.createEl('input', { attr: { type: 'checkbox' } });
				box.checked = c.done;
				lab.createSpan({ text: c.text });
				box.addEventListener('change', () => {
					const r = st.w.setPassChecklist(p.id, pass.id, items.map((i) => (i.id === c.id ? { ...i, done: box.checked } : i)));
					void r;
				});
				const x = lab.createEl('button', { cls: 'ws-wr-rcheck__x', attr: { type: 'button', 'aria-label': `Remove “${c.text}”` } });
				icon(x, 'x');
				x.addEventListener('click', (e) => {
					e.preventDefault();
					const { before, after } = st.w.setPassChecklist(p.id, pass.id, items.filter((i) => i.id !== c.id));
					actionNotice('Removed from the checklist.', { label: 'Undo', run: () => st.w.restoreProject(before, after) });
				});
			}
			const addRow = cl.createDiv({ cls: 'ws-wr-rcheck__add' });
			const input = addRow.createEl('input', { cls: 'ws-input', attr: { type: 'text', placeholder: 'Add something to check in this pass…', 'aria-label': 'Add to the checklist' } });
			input.addEventListener('keydown', (e) => {
				if (e.key !== 'Enter' || !input.value.trim()) return;
				st.w.setPassChecklist(p.id, pass.id, [...items, { id: uuid(), text: input.value.trim(), done: false }]);
				input.value = '';
				input.blur();
				this.refresh();
				this.el.querySelector<HTMLInputElement>('.ws-wr-rcheck__add input')?.focus();
			});
		}
		const mk = panel(mid, 'Marked passages', 'ws-wr-revmarks');
		const marks = [...(p.marks ?? [])].reverse();
		if (!marks.length) mk.createDiv({ cls: 'ws-wr-muted', text: 'Select a passage while writing and run “Mark passage for revision” (or use the toolbar’s comment button): it appears here with your note.' });
		for (const m of marks) {
			const scene = st.w.item(m.sceneId);
			const card = mk.createDiv({ cls: 'ws-wr-mark', attr: { 'data-mark': m.id } });
			card.createDiv({ cls: 'ws-wr-mark__quote', text: `“${m.quote.length > 220 ? `${m.quote.slice(0, 220)}…` : m.quote}”` });
			const foot = card.createDiv({ cls: 'ws-wr-mark__foot' });
			icon(foot, 'message-square');
			foot.createSpan({ cls: 'ws-wr-mark__note', text: m.note || 'No note' });
			if (scene) {
				const go = foot.createEl('button', { cls: 'ws-wr-mark__scene', text: `· ${scene.title}`, attr: { type: 'button' } });
				go.addEventListener('click', () => st.go({ project: p.id, view: 'manuscript', item: scene.id }));
			}
			const done = foot.createEl('button', { cls: 'ws-wr-mark__done', attr: { type: 'button', 'aria-label': 'Dealt with: remove' } });
			icon(done, 'check');
			done.addEventListener('click', () => {
				const { before, after } = st.w.removeMark(p.id, m.id);
				actionNotice('Passage cleared.', { label: 'Undo', run: () => st.w.restoreProject(before, after) });
			});
		}

		// Snapshots of the book, and a comparison.
		const right = grid.createDiv({ cls: 'ws-wr-revright' });
		const sn = panel(right, 'Snapshots', 'ws-wr-revsnaps');
		const list = sn.createDiv({ cls: 'ws-wr-revsnaps__list' });
		const cmp = panel(right, this.snap ? `Compare with “${this.snap.meta.name || 'snapshot'}”` : 'Compare', 'ws-wr-revcompare');
		void (async () => {
			const all: Array<{ scene: ManuscriptItem; meta: SnapshotMeta }> = [];
			for (const s of scenes) for (const meta of await st.ws.snapshots.list(s.id).catch(() => [] as SnapshotMeta[])) all.push({ scene: s, meta });
			all.sort((a, b) => b.meta.createdAt - a.meta.createdAt);
			if (!list.isConnected) return;
			if (!all.length) list.createDiv({ cls: 'ws-wr-muted', text: 'No snapshots yet. One is taken each day you open a scene; take one any time.' });
			for (const x of all.slice(0, 8)) {
				const b = list.createEl('button', { cls: cx('ws-wr-revsnap', this.snap?.meta.id === x.meta.id && 'is-active'), attr: { type: 'button', 'data-snap': x.meta.id } });
				icon(b, 'history', 'ws-wr-revsnap__icon');
				const t = b.createSpan({ cls: 'ws-wr-revsnap__text' });
				t.createSpan({ cls: 'ws-wr-revsnap__name', text: x.meta.name || (x.meta.kind === 'auto' ? `${x.scene.title}: start of the day` : x.scene.title) });
				t.createSpan({ cls: 'ws-wr-revsnap__when', text: `${when(x.meta.createdAt)} · ${x.scene.title}` });
				b.addEventListener('click', () => {
					this.snap = x;
					this.refresh();
				});
			}
			if (!this.snap) cmp.createDiv({ cls: 'ws-wr-muted', text: 'Choose a snapshot to see what changed since.' });
			else await this.paintCompare(cmp);
		})();
	}

	private async paintCompare(box: HTMLElement): Promise<void> {
		const st = this.st;
		const x = this.snap!;
		const snap = await st.ws.snapshots.read(x.scene.id, x.meta.id);
		const f = x.scene.notePath ? st.ws.app.vault.getFileByPath(x.scene.notePath) : null;
		const now = f ? await st.ws.app.vault.read(f) : '';
		if (!snap || !box.isConnected) return;
		const ops = diffLines(snap.text, now);
		const out = box.createDiv({ cls: 'ws-wr-revdiff' });
		if (!ops) out.createDiv({ cls: 'ws-wr-muted', text: 'Too different to compare line by line.' });
		else {
			const changed = ops.filter((o) => o.kind !== 'same');
			if (!changed.length) out.createDiv({ cls: 'ws-wr-muted', text: 'No differences: the scene is as it was.' });
			for (const o of changed.slice(0, 12)) {
				if (o.kind === 'removed') out.createDiv({ cls: 'ws-wr-revdiff__line is-removed', text: o.a });
				else if (o.kind === 'added') out.createDiv({ cls: 'ws-wr-revdiff__line is-added', text: o.b });
			}
			if (changed.length > 12) out.createDiv({ cls: 'ws-wr-muted', text: `…and ${changed.length - 12} more lines.` });
		}
		const row = box.createDiv({ cls: 'ws-wr-revcompare__actions' });
		button(row, {
			label: 'Restore this version…',
			icon: 'undo-2',
			variant: 'ghost',
			size: 'sm',
			cls: 'ws-wr-rev-restore',
			onClick: () => void (async () => {
				const ok = await confirmModal(st.ws.app, { title: 'Restore this snapshot?', body: `“${x.scene.title}” goes back to this version. Your text as it is now is saved as a snapshot first, so nothing is lost.`, confirmLabel: 'Restore' });
				if (!ok) return;
				const undo = await st.ws.snapshots.restore(x.scene, x.meta.id);
				actionNotice(`“${x.scene.title}” restored.`, { label: 'Undo', run: () => void undo() });
				this.snap = null;
				this.refresh();
			})(),
		});
		row.createSpan({ cls: 'ws-wr-muted ws-wr-revcompare__help', text: 'Asks first; the current text is saved as a snapshot.' });
	}

	private async newPass(): Promise<void> {
		const p = this.st.project!;
		const name = await promptModal(this.st.ws.app, { title: 'New revision pass', label: 'What is this pass for?', placeholder: 'Continuity edit', confirmLabel: 'Add pass' });
		if (!name?.trim()) return;
		const { before, after, id } = this.st.w.addPass(p.id, name);
		this.passId = id;
		this.onSelect(id);
		actionNotice(`Pass “${name.trim()}” added.`, { label: 'Undo', run: () => this.st.w.restoreProject(before, after) });
	}

	private async takeSnapshot(scenes: ManuscriptItem[]): Promise<void> {
		// The scene written in most recently, or the first one.
		const withNote = scenes.filter((s) => s.notePath && this.st.ws.app.vault.getFileByPath(s.notePath));
		const latest = withNote.sort((a, b) => (this.st.ws.app.vault.getFileByPath(b.notePath!)?.stat.mtime ?? 0) - (this.st.ws.app.vault.getFileByPath(a.notePath!)?.stat.mtime ?? 0))[0];
		if (!latest) return void new Notice('No scene has a note yet.');
		const name = await promptModal(this.st.ws.app, { title: `Snapshot of “${latest.title}”`, label: 'Name (optional)', placeholder: 'Before continuity pass', confirmLabel: 'Take snapshot' });
		if (name === null) return;
		await this.st.ws.snapshots.take(latest, 'manual', name);
		new Notice('Snapshot taken.');
		this.refresh();
	}
}
