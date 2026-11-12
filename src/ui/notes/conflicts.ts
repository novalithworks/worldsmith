import { Notice, type TFile } from 'obsidian';
import type { WorldsmithContext } from '../../app/context';
import type { EntityRecord, NoteConflict } from '../../core/types';
import { button, icon } from '../components/dom';
import { WorldsmithModal } from '../components/modals';
import { actionNotice } from '../components/notice';

/** What Undo needs to put a note and its entry back as they were. */
export interface NoteSnapshot {
	entityId: string;
	path: string;
	text: string;
	entity: Pick<EntityRecord, 'values' | 'description' | 'aliases' | 'tags' | 'status' | 'nativeNote'>;
}

export async function snapshot(ws: WorldsmithContext, entity: EntityRecord): Promise<NoteSnapshot | null> {
	const file = ws.nativeNotes.file(entity);
	if (!file) return null;
	const text = await ws.app.vault.read(file);
	const e = JSON.parse(JSON.stringify(entity)) as EntityRecord;
	return { entityId: e.id, path: file.path, text, entity: { values: e.values, description: e.description, aliases: e.aliases, tags: e.tags, status: e.status, nativeNote: e.nativeNote } };
}

/**
 * Put a note and its entry back. The note is restored only when it still holds what
 * Worldsmith wrote after the snapshot (an edit made since is never thrown away).
 */
export async function restoreSnapshot(ws: WorldsmithContext, snap: NoteSnapshot, writtenText: string | null): Promise<boolean> {
	const s = ws.worlds.session;
	if (!s) return false;
	const file = ws.app.vault.getFileByPath(snap.path);
	let ok = true;
	if (file) {
		await ws.app.vault.process(file, (cur) => {
			// Without knowing what Worldsmith wrote, the note can't be shown to be unchanged
			// since: it is left as it is rather than replaced as a whole.
			if (writtenText === null || cur !== writtenText) {
				ok = false;
				return cur;
			}
			return snap.text;
		});
	}
	if (!ok) {
		new Notice('The note changed after that, so it was left as it is.');
		return false;
	}
	const cur = s.entities.get(snap.entityId);
	if (!cur) return false;
	const values: Record<string, unknown> = {};
	for (const k of new Set([...Object.keys(cur.values), ...Object.keys(snap.entity.values)])) values[k] = snap.entity.values[k];
	s.entityService.update(cur.id, { values, description: snap.entity.description, aliases: snap.entity.aliases, tags: snap.entity.tags, status: snap.entity.status, nativeNote: snap.entity.nativeNote ?? null });
	return true;
}

type Choice = 'note' | 'ws' | 'later';

/**
 * Values that changed in both places, and Worldsmith parts edited by hand. Nothing has been
 * overwritten; each row is decided here (or later). A copy of both versions is kept for Undo.
 */
export class NoteConflictModal extends WorldsmithModal {
	private choices = new Map<string, Choice>();

	constructor(
		private readonly ws: WorldsmithContext,
		private readonly entity: EntityRecord,
		private readonly conflicts: NoteConflict[],
	) {
		super(ws.app);
		this.modalEl.addClass('ws-note-conflicts');
		for (const c of conflicts) this.choices.set(c.key, c.key.startsWith('v:') ? 'ws' : 'note');
	}

	override onOpen(): void {
		this.setTitle(`${this.entity.name} changed in two places`);
		const c = this.contentEl;
		const eyebrow = c.createDiv({ cls: 'ws-nn-eyebrow is-warning' });
		icon(eyebrow, 'alert-triangle');
		eyebrow.createSpan({ text: 'Needs a decision · nothing has been overwritten' });
		c.createEl('p', { cls: 'ws-nn-muted', text: 'The note and the Worldsmith page were both changed before they were compared. Choose what to keep for each item. Both versions are kept, so you can undo.' });
		const table = c.createEl('table', { cls: 'ws-nn-table' });
		const head = table.createEl('thead').createEl('tr');
		for (const t of ['Item', 'In the note (Obsidian)', 'In Worldsmith']) head.createEl('th', { text: t });
		const body = table.createEl('tbody');
		const paint = () => {
			body.empty();
			for (const k of this.conflicts) {
				const view = k.key.startsWith('v:');
				const tr = body.createEl('tr');
				const what = tr.createEl('td');
				what.createEl('b', { text: k.label });
				what.createDiv({ cls: 'ws-nn-faint', text: view ? 'Worldsmith part, edited by hand' : k.key.startsWith('f:') ? 'Text section' : 'Property' });
				const pick = this.choices.get(k.key);
				const cell = (side: 'note' | 'ws', text: string) => {
					const td = tr.createEl('td');
					const card = td.createEl('button', { cls: `ws-nn-choice${pick === side ? ' is-picked' : ''}`, attr: { type: 'button', 'aria-pressed': String(pick === side) } });
					card.createDiv({ cls: 'ws-nn-choice__text', text: text || '(empty)' });
					const lab = view ? (side === 'note' ? 'Keep my edit (never rewritten)' : 'Restore Worldsmith’s version (your text copied below)') : side === 'note' ? 'Keep the note’s' : 'Keep Worldsmith’s';
					card.createDiv({ cls: 'ws-nn-choice__label', text: lab });
					card.addEventListener('click', () => {
						this.choices.set(k.key, side);
						paint();
					});
				};
				cell('note', k.note);
				cell('ws', k.ws);
			}
		};
		paint();
		const row = c.createDiv({ cls: 'ws-modal-actions ws-nn-actions' });
		const left = row.createDiv({ cls: 'ws-nn-actions__left' });
		button(left, {
			label: 'Keep all from the note',
			variant: 'ghost',
			onClick: () => {
				for (const k of this.conflicts) this.choices.set(k.key, 'note');
				paint();
			},
		});
		button(left, {
			label: 'Keep all from Worldsmith',
			variant: 'ghost',
			onClick: () => {
				for (const k of this.conflicts) this.choices.set(k.key, 'ws');
				paint();
			},
		});
		button(row, { label: 'Decide later', onClick: () => this.close() });
		button(row, { label: 'Apply my choices', variant: 'primary', onClick: () => void this.apply() });
	}

	private async apply(): Promise<void> {
		const resolve: Record<string, 'note' | 'ws'> = {};
		for (const [k, v] of this.choices) if (v !== 'later') resolve[k] = v;
		this.close();
		await resolveConflicts(this.ws, this.entity, resolve);
	}

	override onClose(): void {
		this.contentEl.empty();
	}
}

/** Apply decisions (with Undo). */
export async function resolveConflicts(ws: WorldsmithContext, entity: EntityRecord, resolve: Record<string, 'note' | 'ws'>): Promise<void> {
	const snap = await snapshot(ws, entity);
	await ws.nativeNotes.reconcile(entity.id, resolve);
	const cur = ws.worlds.session?.entities.get(entity.id);
	const file = cur ? ws.nativeNotes.file(cur) : null;
	const written = file ? await ws.app.vault.read(file) : null;
	if (!snap) return;
	actionNotice(cur?.nativeNote?.conflicts?.length ? 'Applied. Some items still need a decision.' : 'Applied your choices.', { label: 'Undo', run: () => void restoreSnapshot(ws, snap, written) }, 10000);
}
