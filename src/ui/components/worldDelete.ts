import { Notice } from 'obsidian';
import type { WorldsmithContext } from '../../app/context';
import type { DeletedWorld } from '../../services/WorldTrash';
import { callout, plural, ProgressView } from '../transfer/archiveModals';
import { button, icon } from './dom';
import { WorldsmithModal } from './modals';

/**
 * Deleting a world (0.20.1): one calm dialog that says what happens, asks for the world's
 * name, makes a backup and moves the world to Deleted worlds. And the Deleted worlds list:
 * restore, or delete for good.
 */

function whenText(t: number): string {
	const d = new Date(t);
	return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) + ', ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

export class DeleteWorldModal extends WorldsmithModal {
	private busy = false;

	constructor(
		private readonly ws: WorldsmithContext,
		private readonly afterDelete: () => void,
	) {
		super(ws.app);
		this.modalEl.addClass('ws-arch-modal', 'ws-wdel-modal');
	}

	override onOpen(): void {
		const s = this.ws.worlds.session;
		if (!s) return this.close();
		const name = s.world.name;
		const entries = [...s.entities.values()].filter((e) => !e.trashedAt).length;
		const notes = [...s.entities.values()].filter((e) => e.linkedNote || e.nativeNote).length;
		this.setTitle('Delete this world?');
		const c = this.contentEl.createDiv({ cls: 'ws-arch ws-wdel' });

		const card = c.createDiv({ cls: 'ws-wdel__world' });
		icon(card.createDiv({ cls: 'ws-wdel__mark' }), s.world.icon || 'globe-2');
		const t = card.createDiv({ cls: 'ws-wdel__who' });
		t.createDiv({ cls: 'ws-wdel__name', text: name });
		t.createDiv({ cls: 'ws-wdel__meta', text: `${plural(entries, 'entry', 'entries')} · ${plural(s.schemas.list().length, 'type')}` });

		const ul = c.createEl('ul', { cls: 'ws-wdel__points' });
		const point = (ic: string, text: string) => {
			const li = ul.createEl('li');
			icon(li, ic, 'ws-wdel__point-icon');
			li.createSpan({ text });
		};
		point('shield-check', 'A backup is made first and kept, so the world can be restored later.');
		point('archive', 'The world moves to Deleted worlds. You can put it back from there, or delete it for good.');
		point('file-text', notes ? `Your notes and images stay in your vault. ${plural(notes, 'entry', 'entries')} with notes won’t be linked to anything until the world comes back.` : 'Notes and images in your vault aren’t touched.');

		const field = c.createDiv({ cls: 'ws-wdel__confirm' });
		const label = field.createEl('label', { cls: 'ws-wdel__label', attr: { for: 'ws-wdel-name' } });
		label.append('Type ');
		label.createEl('strong', { text: name });
		label.append(' to confirm');
		const input = field.createEl('input', { cls: 'ws-wdel__input', attr: { id: 'ws-wdel-name', type: 'text', autocomplete: 'off', spellcheck: 'false' } });

		const actions = c.createDiv({ cls: 'ws-modal-actions' });
		button(actions, { label: 'Cancel', variant: 'ghost', onClick: () => this.close() });
		const go = button(actions, { label: 'Delete world', icon: 'trash-2', variant: 'primary', cls: 'ws-wdel__go mod-warning', onClick: () => void this.run() });
		go.disabled = true;
		const sync = () => (go.disabled = input.value.trim() !== name.trim());
		input.addEventListener('input', sync);
		input.addEventListener('keydown', (e) => {
			if (e.key === 'Enter' && !go.disabled) void this.run();
		});
		window.setTimeout(() => input.focus(), 30);
	}

	private async run(): Promise<void> {
		if (this.busy) return;
		this.busy = true;
		const name = this.ws.worlds.session?.world.name ?? 'The world';
		const c = this.contentEl;
		c.empty();
		const wrap = c.createDiv({ cls: 'ws-arch' });
		const prog = new ProgressView(wrap, 'Deleting the world');
		prog.update('Making a backup first', 0, 1);
		try {
			const d = await this.ws.worldTrash.deleteOpenWorld();
			this.close();
			new Notice(`“${d.name}” was moved to Deleted worlds. A backup of it was kept.`, 8000);
			this.afterDelete();
		} catch (e) {
			c.empty();
			const w = c.createDiv({ cls: 'ws-arch' });
			callout(w, 'error', `“${name}” wasn’t deleted`, `${e instanceof Error ? e.message : String(e)} Nothing was changed.`);
			const actions = w.createDiv({ cls: 'ws-modal-actions' });
			button(actions, { label: 'Close', variant: 'primary', onClick: () => this.close() });
		} finally {
			this.busy = false;
		}
	}
}

export class DeletedWorldsModal extends WorldsmithModal {
	constructor(
		private readonly ws: WorldsmithContext,
		private readonly afterRestore: () => void,
	) {
		super(ws.app);
		this.modalEl.addClass('ws-arch-modal', 'ws-wdel-modal');
	}

	override onOpen(): void {
		this.setTitle('Deleted worlds');
		void this.paint();
	}

	private async paint(): Promise<void> {
		const c = this.contentEl;
		c.empty();
		const wrap = c.createDiv({ cls: 'ws-arch ws-wdel' });
		const list = await this.ws.worldTrash.list();
		if (!list.length) {
			wrap.createDiv({ cls: 'ws-wdel__empty', text: 'No deleted worlds.' });
			const actions = wrap.createDiv({ cls: 'ws-modal-actions' });
			button(actions, { label: 'Close', variant: 'primary', onClick: () => this.close() });
			return;
		}
		wrap.createEl('p', { cls: 'ws-arch__lead', text: 'Worlds you deleted stay here until you delete them for good. Putting one back restores it exactly as it was.' });
		const ul = wrap.createDiv({ cls: 'ws-wdel__list', attr: { role: 'list' } });
		for (const d of list) this.row(ul, d);
		const actions = wrap.createDiv({ cls: 'ws-modal-actions' });
		button(actions, { label: 'Close', variant: 'ghost', onClick: () => this.close() });
	}

	private row(parent: HTMLElement, d: DeletedWorld): void {
		const r = parent.createDiv({ cls: 'ws-wdel__row', attr: { role: 'listitem', 'data-world': d.worldId } });
		icon(r.createDiv({ cls: 'ws-wdel__mark ws-wdel__mark--sm' }), d.icon);
		const t = r.createDiv({ cls: 'ws-wdel__who' });
		t.createDiv({ cls: 'ws-wdel__name', text: d.name });
		t.createDiv({ cls: 'ws-wdel__meta', text: `Deleted ${whenText(d.deletedAt)} · ${plural(d.entries, 'entry', 'entries')}` });
		const a = r.createDiv({ cls: 'ws-wdel__row-actions' });
		button(a, {
			label: 'Put back',
			icon: 'undo-2',
			variant: 'ghost',
			size: 'sm',
			cls: 'ws-wdel__restore',
			onClick: () => void (async () => {
				try {
					await this.ws.worldTrash.restore(d);
					this.close();
					new Notice(`“${d.name}” is back.`);
					this.afterRestore();
				} catch (e) {
					new Notice(e instanceof Error ? e.message : String(e), 10000);
				}
			})(),
		});
		button(a, { label: 'Delete for good…', variant: 'ghost', size: 'sm', cls: 'ws-wdel__forever', onClick: () => void this.forever(r, d) });
	}

	/** Inline confirmation in the row: the world and, if chosen, its backups. */
	private async forever(row: HTMLElement, d: DeletedWorld): Promise<void> {
		if (row.querySelector('.ws-wdel__sure')) return;
		const n = await this.ws.worldTrash.backupCount(d);
		const sure = row.createDiv({ cls: 'ws-wdel__sure' });
		sure.createDiv({ cls: 'ws-wdel__sure-text', text: `“${d.name}” will be deleted for good. This can’t be undone.` });
		let alsoBackups = false;
		if (n) {
			const lab = sure.createEl('label', { cls: 'ws-wdel__also' });
			const box = lab.createEl('input', { attr: { type: 'checkbox' } });
			lab.createSpan({ text: `Also delete its ${plural(n, 'backup')} (otherwise they’re kept, and can be imported as a world later)` });
			box.addEventListener('change', () => (alsoBackups = box.checked));
		}
		const a = sure.createDiv({ cls: 'ws-wdel__sure-actions' });
		button(a, { label: 'Keep it', variant: 'ghost', size: 'sm', onClick: () => sure.remove() });
		button(a, {
			label: 'Delete for good',
			icon: 'trash-2',
			variant: 'primary',
			size: 'sm',
			cls: 'ws-wdel__forever-go mod-warning',
			onClick: () => void (async () => {
				try {
					await this.ws.worldTrash.deleteForever(d, { backups: alsoBackups });
					new Notice(`“${d.name}” was deleted for good.`);
				} catch (e) {
					new Notice(e instanceof Error ? e.message : String(e), 10000);
				}
				void this.paint();
			})(),
		});
	}
}
