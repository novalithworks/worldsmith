import { Notice, TFile } from 'obsidian';
import type { WorldsmithContext } from '../../app/context';
import type { BlockInstance, EntitySchema } from '../../core/types';
import { uuid } from '../../core/util/ids';
import type { Route } from '../../state/route';
import { applyAdoption, noteClaims, planAdoption, skipText, type AdoptCandidate, type AdoptRow } from '../../services/notes/adoption';
import { button, cx, icon } from '../components/dom';
import { WorldsmithModal } from '../components/modals';
import { actionNotice } from '../components/notice';

/**
 * "Add existing notes" (0.18): each note becomes a new entry of the type, with the note
 * linked exactly where it is. Nothing is moved, copied, renamed or written into a note.
 * Optionally the type's page gets an editable note widget, so every entry shows its note.
 */

/** Whether a page layout already shows the entry's own note in place. */
export function hasEditableNote(blocks: BlockInstance[]): boolean {
	return blocks.some((b) => b.type === 'embedded-note' && !b.hidden && b.config?.editable === true && (b.config?.source ?? 'linked') === 'linked');
}

/** The note widget added to a type's page: full width, at the end, editing the entry's note. */
export function editableNoteBlock(blocks: BlockInstance[]): BlockInstance {
	const y = blocks.reduce((m, b) => Math.max(m, b.y + b.h), 0);
	return { id: `note-${uuid().slice(0, 8)}`, type: 'embedded-note', x: 0, y, w: 12, h: 1, config: { source: 'linked', height: 'tall', editable: true }, title: null };
}

function candidateOf(ws: WorldsmithContext, f: TFile): AdoptCandidate {
	const fm = ws.app.metadataCache.getFileCache(f)?.frontmatter;
	const id = fm?.['worldsmith-id'] ?? fm?.['worldsmith'];
	const world = fm?.['worldsmith-world'];
	return { path: f.path, basename: f.basename, extension: f.extension, wsId: typeof id === 'string' ? id : null, wsWorld: typeof world === 'string' ? world : null };
}

export class AdoptNotesModal extends WorldsmithModal {
	private rows: AdoptRow[];
	private addWidget: boolean;
	private readonly widgetAlready: boolean;

	constructor(
		private readonly ws: WorldsmithContext,
		private readonly schema: EntitySchema,
		files: TFile[],
		private readonly navigate?: (route: Route) => void,
	) {
		super(ws.app);
		this.modalEl.addClass('ws-adopt-modal');
		const s = ws.worlds.session!;
		this.rows = planAdoption(
			files.map((f) => candidateOf(ws, f)),
			noteClaims(s.entities.values()),
			{ worldId: s.worldId, dataFolder: ws.db.root },
		);
		this.widgetAlready = hasEditableNote(s.layouts.typeLayout(schema).blocks);
		this.addWidget = !this.widgetAlready;
	}

	override onOpen(): void {
		this.setTitle(`Add notes as ${this.schema.plural.toLowerCase()}`);
		this.paint();
	}

	private paint(): void {
		const c = this.contentEl;
		c.empty();
		const wrap = c.createDiv({ cls: 'ws-adopt' });
		const n = this.rows.filter((r) => r.action === 'create').length;
		wrap.createEl('p', {
			cls: 'ws-adopt__lead',
			text: 'Each note becomes a new entry and stays exactly as it is, where it is. Worldsmith links to it and never writes into it.',
		});
		const list = wrap.createDiv({ cls: 'ws-adopt__list', attr: { role: 'list' } });
		for (const r of this.rows) {
			const row = list.createDiv({ cls: cx('ws-adopt__row', r.action === 'skip' && 'is-skip'), attr: { role: 'listitem' } });
			icon(row, r.action === 'skip' ? 'ban' : 'file-text', 'ws-adopt__icon');
			const main = row.createDiv({ cls: 'ws-adopt__main' });
			if (r.action === 'create') {
				const input = main.createEl('input', { cls: 'ws-adopt__name', attr: { type: 'text', value: r.name, 'aria-label': `Entry name for ${r.path}` } });
				input.addEventListener('input', () => (r.name = input.value));
			} else main.createDiv({ cls: 'ws-adopt__name-text', text: r.name });
			main.createDiv({ cls: 'ws-adopt__path', text: r.path });
			if (r.action === 'skip') row.createDiv({ cls: 'ws-adopt__why', text: skipText(r) });
		}
		const opts = wrap.createDiv({ cls: 'ws-adopt__opts' });
		if (this.widgetAlready) {
			opts.createDiv({ cls: 'ws-adopt__note', text: `${this.schema.singular} pages already show their note. Every entry also has a Note tab.` });
		} else {
			const lab = opts.createEl('label', { cls: 'ws-adopt__check' });
			const box = lab.createEl('input', { attr: { type: 'checkbox' } });
			box.checked = this.addWidget;
			box.addEventListener('change', () => (this.addWidget = box.checked));
			const t = lab.createDiv();
			t.createDiv({ cls: 'ws-adopt__check-title', text: `Also show the note inside every ${this.schema.singular.toLowerCase()} page` });
			t.createDiv({ cls: 'ws-adopt__check-sub', text: 'Adds an editable note widget at the end of the page layout. Every entry also has a Note tab either way.' });
		}
		const actions = wrap.createDiv({ cls: 'ws-modal-actions' });
		button(actions, { label: 'Cancel', variant: 'ghost', onClick: () => this.close() });
		const add = button(actions, {
			label: n === 1 ? `Add 1 ${this.schema.singular.toLowerCase()}` : `Add ${n} ${this.schema.plural.toLowerCase()}`,
			variant: 'primary',
			cls: 'ws-adopt__add',
			onClick: () => this.run(),
		});
		add.disabled = n === 0;
	}

	private run(): void {
		const s = this.ws.worlds.session;
		if (!s) return;
		const typeId = this.schema.id;
		const { created, undo } = applyAdoption(
			{
				create: (t, init) => s.entityService.create(t, init),
				linkMain: (id, path) => s.entityService.update(id, { linkedNote: { path } }),
				// Undo takes the new entry away completely, unless it was used meanwhile
				// (then it goes to the trash, where nothing is lost).
				trash: (id) => {
					const e = s.entities.get(id);
					if (!e) return;
					const impact = s.entityService.deleteImpact(id);
					if (e.rev <= 1 && !impact.children && !impact.relations) s.entityService.deletePermanently(id);
					else s.entityService.trash(id);
				},
			},
			typeId,
			this.rows,
		);
		let undoLayout: (() => void) | null = null;
		if (this.addWidget && created.length) {
			const scope = { kind: 'type' as const, typeId };
			const before = s.layouts.typeLayout(this.schema);
			s.layouts.save(scope, [...before.blocks, editableNoteBlock(before.blocks)]);
			undoLayout = () => {
				if (before.custom) s.layouts.save(scope, before.blocks);
				else s.layouts.reset(scope);
			};
		}
		this.close();
		if (!created.length) {
			new Notice('No notes were added.');
			return;
		}
		const what = created.length === 1 ? `“${created[0]!.name}”` : `${created.length} ${this.schema.plural.toLowerCase()}`;
		actionNotice(`Added ${what} from your notes. The notes weren’t changed.`, {
			label: 'Undo',
			run: () => {
				undo();
				undoLayout?.();
			},
		});
		if (created.length === 1 && this.navigate) this.navigate({ name: 'entity', params: { id: created[0]!.id, view: 'note' } });
	}
}
