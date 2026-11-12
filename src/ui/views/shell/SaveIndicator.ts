import { Component, Notice, setTooltip } from 'obsidian';
import type { WorldsmithContext } from '../../../app/context';
import type { SaveState } from '../../../core/events/events';
import { icon } from '../../components/dom';
import { own } from '../../components/lifecycle';

const LABELS: Record<SaveState, { text: string; icon: string }> = {
	idle: { text: '', icon: 'check' },
	pending: { text: 'Editing', icon: 'pencil' },
	saving: { text: 'Saving…', icon: 'loader' },
	saved: { text: 'Saved', icon: 'check' },
	error: { text: 'Not saved — retrying', icon: 'alert-triangle' },
};

/** Quiet autosave status. Errors are loud and actionable; success is a brief whisper. */
export class SaveIndicator extends Component {
	private el: HTMLElement;

	constructor(
		parent: HTMLElement,
		private readonly ws: WorldsmithContext,
	) {
		super();
		this.el = parent.createDiv({ cls: 'ws-save', attr: { role: 'status', 'aria-live': 'polite' } });
	}

	override onload(): void {
		this.paint(this.ws.db.saveTracker.state);
		own(this, this.ws.events.on('save:state', ({ state, error }) => this.paint(state, error)));
	}

	private paint(state: SaveState, error?: unknown): void {
		const l = LABELS[state];
		this.el.empty();
		this.el.className = `ws-save ws-save--${state}`;
		if (state === 'idle') return;
		icon(this.el, l.icon, 'ws-save__icon');
		this.el.createSpan({ text: l.text });
		if (state === 'error') {
			const msg = error instanceof Error ? error.message : String(error ?? 'Unknown error');
			setTooltip(this.el, `Your changes are kept in memory and will be retried. ${msg}`);
			this.el.onclick = () => {
				void this.ws.db.flushAll().then(
					() => new Notice('Saved.'),
					(e) => new Notice(`Still can’t save: ${e instanceof Error ? e.message : String(e)}`),
				);
			};
		} else {
			this.el.onclick = null;
		}
	}
}
