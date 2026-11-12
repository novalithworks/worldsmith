import type { WorldsmithContext } from '../../app/context';
import { button, cx, icon } from '../components/dom';
import { openPluginSettings } from '../obsidianInternals';
import { StatusesModal } from './planDialogs';
import { head, type Studio } from './kit';
import { renderWritingControls } from './settingsPanel';

/**
 * Writing Studio settings (0.28): a page of its own, with sections on the left. The writing
 * surface (the same controls as the quick popover), the open book's statuses, saving and
 * safety (backups), and folders (Worldsmith's settings).
 */

type Section = 'surface' | 'statuses' | 'safety' | 'folders';
const SECTIONS: Array<{ id: Section; label: string; icon: string }> = [
	{ id: 'surface', label: 'Writing surface', icon: 'feather' },
	{ id: 'statuses', label: 'Statuses', icon: 'tag' },
	{ id: 'safety', label: 'Saving & safety', icon: 'shield-check' },
	{ id: 'folders', label: 'Folders', icon: 'folder' },
];

export class SettingsScreen {
	private readonly el: HTMLElement;
	private section: Section = 'surface';

	constructor(
		private readonly st: Studio,
		parent: HTMLElement,
	) {
		this.el = parent.createDiv({ cls: 'ws-wr-setpage' });
	}

	mount(): void {
		this.refresh();
	}

	refresh(): void {
		if (this.el.contains(activeDocument.activeElement) && ['INPUT', 'SELECT'].includes(activeDocument.activeElement?.tagName ?? '')) return;
		const ws: WorldsmithContext = this.st.ws;
		this.el.empty();
		head(this.el, { eyebrow: 'Settings', title: 'Writing Studio settings', sub: 'Also in Settings › Worldsmith.' });
		const grid = this.el.createDiv({ cls: 'ws-wr-setgrid' });
		const nav = grid.createDiv({ cls: 'ws-wr-setnav', attr: { role: 'tablist', 'aria-label': 'Settings sections' } });
		for (const s of SECTIONS) {
			const on = s.id === this.section;
			const b = nav.createEl('button', { cls: cx('ws-wr-setnav__item', on && 'is-active'), attr: { type: 'button', role: 'tab', 'aria-selected': String(on), 'data-section': s.id } });
			icon(b, s.icon);
			b.createSpan({ text: s.label });
			b.addEventListener('click', () => {
				this.section = s.id;
				this.refresh();
			});
		}
		const body = grid.createDiv({ cls: 'ws-wr-setbody' });
		if (this.section === 'surface') {
			const box = body.createDiv({ cls: 'ws-wr-setrows' });
			renderWritingControls(box, ws, () => this.refresh());
		} else if (this.section === 'statuses') {
			const p = this.st.project ?? this.st.w.projects()[0] ?? null;
			if (!p) body.createDiv({ cls: 'ws-wr-muted', text: 'Statuses belong to a project. Create one first.' });
			else {
				const card = body.createDiv({ cls: 'ws-wr-setcard' });
				card.createDiv({ cls: 'ws-wr-setcard__title', text: `Scene statuses in ${p.name}` });
				const chips = card.createDiv({ cls: 'ws-wr-setchips' });
				for (const s of p.statuses) {
					const c = chips.createSpan({ cls: cx('ws-wr-setchip', `ws-tint--${s.color}`) });
					c.createSpan({ cls: 'ws-wr-dot' });
					c.createSpan({ text: s.label });
				}
				button(card, { label: 'Edit statuses…', icon: 'pencil', variant: 'ghost', size: 'sm', cls: 'ws-wr-set-statuses', onClick: () => new StatusesModal(this.st, p).open() });
			}
		} else if (this.section === 'safety') {
			const card = body.createDiv({ cls: 'ws-wr-setcard' });
			card.createDiv({ cls: 'ws-wr-setcard__title', text: 'Your writing is saved as you type' });
			card.createDiv({ cls: 'ws-wr-muted', text: 'Each scene is an ordinary note in your vault. Worldsmith backs up your world every hour (skipped when nothing changed), takes a snapshot of each scene the first time you open it each day, and keeps snapshots you take until you delete them.' });
			button(card, { label: 'Backups & recovery', icon: 'life-buoy', variant: 'ghost', size: 'sm', onClick: () => void ws.open({ name: 'backups', params: {} }) });
		} else {
			const card = body.createDiv({ cls: 'ws-wr-setcard' });
			card.createDiv({ cls: 'ws-wr-setcard__title', text: 'Where things are kept' });
			card.createDiv({ cls: 'ws-wr-muted', text: 'Each project keeps its notes in its own folder (in its details). The folders for images, exports and native notes are in Worldsmith’s settings.' });
			button(card, { label: 'Open Worldsmith settings', icon: 'settings', variant: 'ghost', size: 'sm', onClick: () => openPluginSettings(ws.app, ws.plugin.manifest.id) });
		}
	}
}
