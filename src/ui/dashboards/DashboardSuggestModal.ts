import { FuzzySuggestModal, setIcon, type App, type FuzzyMatch } from 'obsidian';
import type { WorldSession } from '../../services/WorldSession';

interface Item {
	id: string;
	name: string;
	icon: string;
}

/** Jump to Home or any dashboard (command palette). */
export class DashboardSuggestModal extends FuzzySuggestModal<Item> {
	constructor(
		app: App,
		private readonly ws_session: WorldSession,
		private readonly ws_onPick: (id: string) => void,
		opts: { placeholder?: string } = {},
	) {
		super(app);
		this.modalEl.addClass('worldsmith-modal');
		this.setPlaceholder(opts.placeholder ?? 'Open a dashboard…');
	}

	getItems(): Item[] {
		return [{ id: 'home', name: 'Home', icon: 'home' }, ...this.ws_session.dashboards.list().map((d) => ({ id: d.id, name: d.name, icon: d.icon }))];
	}

	getItemText(item: Item): string {
		return item.name;
	}

	override renderSuggestion(item: FuzzyMatch<Item>, el: HTMLElement): void {
		el.addClass('ws-icon-picker__item');
		setIcon(el.createSpan({ cls: 'ws-icon-picker__glyph' }), item.item.icon);
		el.createSpan({ text: item.item.name });
	}

	onChooseItem(item: Item): void {
		this.ws_onPick(item.id);
	}
}
