import { Notice, setIcon } from 'obsidian';
import type { WorldsmithContext } from '../../app/context';
import type { WorldBackup } from '../../data/backup/BackupService';
import { importTypePack, previewTypePack, type PackChoice, type TypePack } from '../../services/transfer/typePack';
import type { WorldSession } from '../../services/WorldSession';
import { button, cx, icon } from '../components/dom';
import { WorldsmithModal } from '../components/modals';
import { actionNotice } from '../components/notice';

/** Importing types: see each one, decide what happens to names that clash, import. */
export class TypePackModal extends WorldsmithModal {
	private choices: Record<string, PackChoice> = {};

	constructor(
		private readonly ws: WorldsmithContext,
		private readonly s: WorldSession,
		private readonly pack: TypePack,
		private readonly onDone?: (typeIds: string[]) => void,
	) {
		super(ws.app);
		this.modalEl.addClass('ws-pack-modal');
	}

	override onOpen(): void {
		this.setTitle('Import types');
		const c = this.contentEl;
		c.addClass('ws-pack');
		const preview = previewTypePack(this.s, this.pack);
		for (const t of preview.types) this.choices[t.id] = t.choice;
		c.createEl('p', { cls: 'ws-confirm__body', text: `From “${this.pack.from}”. Types bring their fields, sections, cards, checklist and page layout — no entries.` });
		const list = c.createDiv({ cls: 'ws-pack__list' });
		const paint = () => {
			list.empty();
			for (const t of preview.types) {
				const row = list.createDiv({ cls: cx('ws-pack__row', t.color && `ws-tint--${t.color}`, this.choices[t.id] === 'skip' && 'is-skip'), attr: { 'data-type': t.id } });
				const g = row.createSpan({ cls: 'ws-rlist__glyph' });
				setIcon(g, t.icon);
				const tx = row.createDiv({ cls: 'ws-pack__text' });
				tx.createDiv({ cls: 'ws-pack__name', text: t.plural });
				tx.createDiv({ cls: 'ws-pack__meta', text: t.exists ? `You already have a type called this — add it as a copy, or skip it` : `${t.fields} fields` });
				const seg = row.createDiv({ cls: 'ws-segmented ws-segmented--labels ws-segmented--sm' });
				const opts: Array<[PackChoice, string]> = t.exists ? [['copy', 'Add as copy'], ['skip', 'Skip']] : [['add', 'Add'], ['skip', 'Skip']];
				for (const [id, label] of opts) {
					const on = this.choices[t.id] === id;
					const b = seg.createEl('button', { cls: cx('ws-segmented__item', on && 'is-active'), text: label, attr: { type: 'button', 'aria-pressed': String(on), 'data-choice': id } });
					b.addEventListener('click', () => {
						this.choices[t.id] = id;
						paint();
					});
				}
			}
		};
		paint();
		if (preview.newRelations.length) {
			const note = c.createDiv({ cls: 'ws-pack__note' });
			icon(note, 'waypoints');
			note.createSpan({ text: `Also adds ${preview.newRelations.length} kind${preview.newRelations.length === 1 ? '' : 's'} of relationship their link fields use: ${preview.newRelations.join(', ')}.` });
		}
		const foot = c.createDiv({ cls: 'ws-modal-actions' });
		button(foot, { label: 'Cancel', variant: 'ghost', onClick: () => this.close() });
		button(foot, {
			label: 'Import',
			icon: 'download',
			variant: 'primary',
			cls: 'ws-pack__go',
			onClick: () => {
				try {
					const res = importTypePack(this.s, this.ws.fieldTypes, this.pack, this.choices);
					this.close();
					if (!res.added.length) {
						new Notice('Nothing imported — every type was skipped.');
						return;
					}
					const ids = res.added.map((x) => x.id);
					actionNotice(`Imported ${res.added.map((x) => x.plural).join(', ')}.`, {
						label: 'Undo',
						run: () => {
							const u = res.undo();
							new Notice(u.kept ? `Import undone, except ${u.kept} type${u.kept === 1 ? ' that has' : 's that have'} entries now.` : 'Import undone.');
						},
					});
					this.onDone?.(ids);
				} catch (e) {
					new Notice(`Import failed: ${e instanceof Error ? e.message : String(e)}`);
				}
			},
		});
	}

	override onClose(): void {
		this.contentEl.empty();
	}
}

/** Importing a world file: what's in it, and — if this world is already here — add it as a copy. */
export class WorldImportModal extends WorldsmithModal {
	constructor(
		private readonly ws: WorldsmithContext,
		private readonly bundle: WorldBackup,
		private readonly onDone?: () => void,
	) {
		super(ws.app);
		this.modalEl.addClass('ws-pack-modal');
	}

	override onOpen(): void {
		const info = this.ws.worlds.inspectBundle(this.bundle);
		const c = this.contentEl;
		c.addClass('ws-pack');
		if (!info.ok) {
			this.setTitle('Can’t import this file');
			c.createEl('p', { cls: 'ws-confirm__body', text: info.error });
			button(c.createDiv({ cls: 'ws-modal-actions' }), { label: 'Close', variant: 'primary', onClick: () => this.close() });
			return;
		}
		this.setTitle(`Import “${info.name}”`);
		const card = c.createDiv({ cls: 'ws-pack__world' });
		const g = card.createSpan({ cls: 'ws-rlist__glyph ws-tint--purple' });
		setIcon(g, 'globe-2');
		const tx = card.createDiv();
		tx.createDiv({ cls: 'ws-pack__name', text: info.name });
		tx.createDiv({ cls: 'ws-pack__meta', text: `${info.entries} entr${info.entries === 1 ? 'y' : 'ies'} · ${info.types} type${info.types === 1 ? '' : 's'}` });
		c.createEl('p', {
			cls: 'ws-confirm__body',
			text: info.exists
				? 'This world is already in your vault. Importing adds a separate copy (called “… (copy)”) — your world isn’t touched. To roll your world back instead, restore a backup in Settings.'
				: 'It’s added as a world of its own and opened. Images and linked notes aren’t inside world files — copy those folders across too if they live elsewhere.',
		});
		const foot = c.createDiv({ cls: 'ws-modal-actions' });
		button(foot, { label: 'Cancel', variant: 'ghost', onClick: () => this.close() });
		button(foot, {
			label: info.exists ? 'Import as a copy' : 'Import world',
			icon: 'download',
			variant: 'primary',
			cls: 'ws-pack__go',
			onClick: () => void (async () => {
				this.close();
				try {
					await this.ws.worlds.importBundle(this.bundle, { asCopy: info.exists });
					new Notice(`Imported “${this.ws.worlds.session?.world.name ?? info.name}”.`);
					this.onDone?.();
				} catch (e) {
					new Notice(`Import failed: ${e instanceof Error ? e.message : String(e)}`);
				}
			})(),
		});
	}

	override onClose(): void {
		this.contentEl.empty();
	}
}
