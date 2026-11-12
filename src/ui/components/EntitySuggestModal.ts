import { SuggestModal, type App } from 'obsidian';
import type { EntityRecord } from '../../core/types';
import type { WorldSession } from '../../services/WorldSession';
import { avatar } from './avatar';

/**
 * Quick switcher over Worldsmith entities, backed by SearchService. Used by the
 * "Search Worldsmith" command, "Move under…", and (Milestone 3) relation pickers.
 */
export class EntitySuggestModal extends SuggestModal<EntityRecord> {
	constructor(
		app: App,
		private readonly ws_session: WorldSession,
		private readonly ws_onPick: (e: EntityRecord, evt: MouseEvent | KeyboardEvent) => void,
		private readonly ws_opts: { placeholder?: string; typeIds?: string[]; exclude?: Set<string> } = {},
	) {
		super(app);
		this.modalEl.addClass('worldsmith-modal', 'ws-entity-suggest');
		this.setPlaceholder(ws_opts.placeholder ?? 'Search your world…');
		this.emptyStateText = 'Nothing matches. Try another name, alias or tag.';
		this.limit = 40;
		this.setInstructions([
			{ command: '↵', purpose: 'open' },
			{ command: 'mod ↵', purpose: 'open in new tab' },
			{ command: 'esc', purpose: 'dismiss' },
		]);
	}

	getSuggestions(query: string): EntityRecord[] {
		const hits = this.ws_session.search.search(query, { limit: 80 });
		return hits
			.map((h) => h.entity)
			.filter((e) => (!this.ws_opts.typeIds?.length || this.ws_opts.typeIds.includes(e.typeId)) && !this.ws_opts.exclude?.has(e.id))
			.slice(0, this.limit);
	}

	renderSuggestion(e: EntityRecord, el: HTMLElement): void {
		const schema = this.ws_session.schemas.get(e.typeId);
		el.addClass('ws-suggest');
		avatar(el, this.app, e, schema, { size: 'xs' });
		const text = el.createDiv({ cls: 'ws-suggest__text' });
		text.createDiv({ cls: 'ws-suggest__name', text: e.name });
		const sub = this.ws_session.entityService.subtitle(e);
		text.createDiv({ cls: 'ws-suggest__meta', text: [schema?.singular, sub].filter(Boolean).join(' • ') });
	}

	onChooseSuggestion(e: EntityRecord, evt: MouseEvent | KeyboardEvent): void {
		this.ws_onPick(e, evt);
	}
}
