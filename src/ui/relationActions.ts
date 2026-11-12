import { FuzzySuggestModal, Notice, type App, type FuzzyMatch } from 'obsidian';
import type { WorldsmithContext } from '../app/context';
import type { EntityRecord, RelationEdge, RelationType } from '../core/types';
import type { WorldSession } from '../services/WorldSession';
import { EntitySuggestModal } from './components/EntitySuggestModal';
import { icon } from './components/dom';
import { actionNotice } from './components/notice';

/**
 * Connection-level actions shared by the Connections block, the relationship page and
 * menus. Everything that removes data offers Undo.
 */

interface Side {
	type: RelationType;
	/** true: the entry is the connection's `from`. */
	outgoing: boolean;
	label: string;
	relevant: boolean;
}

class RelationSideModal extends FuzzySuggestModal<Side> {
	constructor(
		app: App,
		private readonly ws_items: Side[],
		private readonly ws_entity: EntityRecord,
		private readonly ws_onPick: (s: Side) => void,
	) {
		super(app);
		this.modalEl.addClass('worldsmith-modal', 'ws-entity-suggest');
		this.setPlaceholder(`How is ${ws_entity.name} connected? (e.g. friends, member of…)`);
		this.emptyStateText = 'No relationship matches. Create one under Studio → Relationships.';
		this.limit = 60;
	}
	getItems(): Side[] {
		return this.ws_items;
	}
	getItemText(s: Side): string {
		return `${s.label} ${s.type.label} ${s.type.category}`;
	}
	override renderSuggestion(m: FuzzyMatch<Side>, el: HTMLElement): void {
		const s = m.item;
		el.addClass('ws-suggest');
		const mark = el.createDiv({ cls: 'ws-suggest__icon' });
		icon(mark, s.type.icon ?? 'link-2');
		const t = el.createDiv({ cls: 'ws-suggest__text' });
		t.createDiv({ cls: 'ws-suggest__name', text: s.label });
		t.createDiv({ cls: 'ws-suggest__meta', text: s.type.symmetric ? `${s.type.label} · both ways` : `${s.type.label} · ${s.type.category}` });
	}
	onChooseItem(s: Side): void {
		this.ws_onPick(s);
	}
}

/** Pick a kind of connection (from `entity`'s point of view), then the other entry. */
export function openAddConnection(ws: WorldsmithContext, s: WorldSession, entity: EntityRecord, onDone?: (edge: RelationEdge) => void): void {
	const R = s.relations;
	const items: Side[] = [];
	for (const type of R.types()) {
		const fits = (list: string[]) => !list.length || list.includes(entity.typeId);
		if (type.symmetric) {
			items.push({ type, outgoing: true, label: type.forwardLabel, relevant: fits(type.sourceTypes) || fits(type.targetTypes) });
			continue;
		}
		// Outgoing: the entry is `from`, the other end appears under forwardLabel.
		items.push({ type, outgoing: true, label: type.forwardLabel, relevant: fits(type.sourceTypes) });
		items.push({ type, outgoing: false, label: type.reverseLabel, relevant: fits(type.targetTypes) });
	}
	items.sort((a, b) => Number(b.relevant) - Number(a.relevant) || a.label.localeCompare(b.label));
	new RelationSideModal(ws.app, items, entity, (side) => {
		const otherTypes = side.type.symmetric ? side.type.targetTypes : side.outgoing ? side.type.targetTypes : side.type.sourceTypes;
		new EntitySuggestModal(
			ws.app,
			s,
			(other) => {
				const [from, to] = side.outgoing ? [entity.id, other.id] : [other.id, entity.id];
				const existing = R.findEdge(side.type.id, from, to);
				if (existing) {
					new Notice(`${other.name} is already listed under ${side.label}.`);
					return;
				}
				try {
					const edge = R.connect(from, side.type.id, to);
					new Notice(`${other.name} added to ${side.label}.`);
					onDone?.(edge);
				} catch (e) {
					new Notice(e instanceof Error ? e.message : String(e));
				}
			},
			{ placeholder: `${side.label} of ${entity.name}…`, typeIds: otherTypes, exclude: new Set([entity.id]) },
		).open();
	}).open();
}

/** Remove a connection with an Undo notice. */
export function removeConnection(s: WorldSession, edge: RelationEdge, otherName?: string): void {
	const removed = s.relations.unlink(edge.id);
	if (!removed) return;
	actionNotice(otherName ? `Removed the connection with ${otherName}.` : 'Connection removed.', { label: 'Undo', run: () => s.relations.restore([removed]) });
}
