import type { EntityRecord, ManuscriptItem } from '../../core/types';
import { ROUTES } from '../../state/route';
import { findMentions, withCast, withoutCast } from '../../services/writing/world';
import { avatar } from '../components/avatar';
import { button, cx, icon } from '../components/dom';
import { EntitySuggestModal } from '../components/EntitySuggestModal';
import { Popover } from '../components/popover';
import { undoNotice } from './actions';
import { caps, type Studio } from './kit';

/**
 * WS5 (0.22): scenes and the world in the studio. Point of view, cast and location are entry
 * ids; chips show the entry's own name and picture, and clicking one opens a preview with a
 * way to the page (in a new tab, so the writing stays open). A deleted entry shows as missing.
 */

/** Types that are places: a mention of one is suggested as where the scene happens. */
const PLACES = ['location', 'nation'];

function live(st: Studio, id: string | null | undefined): EntityRecord | null {
	if (!id) return null;
	const e = st.s.entities.get(id);
	return e && !e.trashedAt ? e : null;
}

/** A preview of an entry, anchored to a chip: its picture, type, summary and a way to the page. */
export function entityPreview(st: Studio, anchor: HTMLElement, e: EntityRecord): void {
	const schema = st.s.schemas.get(e.typeId);
	const pop = new Popover(anchor, { cls: 'ws-wr-epreview', width: 300, label: e.name });
	const head = pop.el.createDiv({ cls: 'ws-wr-epreview__head' });
	avatar(head, st.ws.app, e, schema, { shape: 'arch', size: 'lg' });
	const t = head.createDiv({ cls: 'ws-wr-epreview__who' });
	t.createDiv({ cls: 'ws-wr-epreview__name', text: e.name });
	if (schema) t.createDiv({ cls: 'ws-wr-epreview__type', text: schema.singular });
	if (e.description) pop.el.createDiv({ cls: 'ws-wr-epreview__desc', text: e.description.length > 280 ? `${e.description.slice(0, 280)}…` : e.description });
	const a = pop.el.createDiv({ cls: 'ws-wr-epreview__actions' });
	button(a, {
		label: 'Open page',
		icon: 'external-link',
		variant: 'primary',
		size: 'sm',
		cls: 'ws-wr-epreview__open',
		tooltip: 'Opens in a new tab; your writing stays here',
		onClick: () => {
			pop.close();
			void st.ws.open(ROUTES.entity(e.id), { newLeaf: 'tab' });
		},
	});
	const note = e.nativeNote?.path ?? e.linkedNote?.path;
	if (note && st.ws.app.vault.getFileByPath(note))
		button(a, {
			label: 'Open note',
			icon: 'file-text',
			variant: 'ghost',
			size: 'sm',
			onClick: () => {
				pop.close();
				const f = st.ws.app.vault.getFileByPath(note);
				if (f) void st.ws.app.workspace.getLeaf('tab').openFile(f);
			},
		});
}

/** One entry as a chip. `onRemove` adds a small ×. A missing entry says so. */
export function entityChip(parent: HTMLElement, st: Studio, id: string, o: { onRemove?: () => void; role?: string } = {}): HTMLElement {
	const e = live(st, id);
	const chip = parent.createDiv({ cls: cx('ws-wr-echip', !e && 'is-missing'), attr: { 'data-entity': id } });
	if (e) {
		const b = chip.createEl('button', { cls: 'ws-wr-echip__main', attr: { type: 'button', 'aria-label': `${e.name}${o.role ? ` (${o.role})` : ''}: show preview` } });
		avatar(b, st.ws.app, e, st.s.schemas.get(e.typeId), { size: 'xs' });
		b.createSpan({ cls: 'ws-wr-echip__name', text: e.name });
		b.addEventListener('click', () => entityPreview(st, chip, e));
	} else {
		const m = chip.createSpan({ cls: 'ws-wr-echip__main', attr: { title: 'This entry was deleted. Restore it from the trash to bring the link back, or remove it here.' } });
		icon(m, 'circle-alert');
		m.createSpan({ cls: 'ws-wr-echip__name', text: 'Missing entry' });
	}
	if (o.onRemove) {
		const x = chip.createEl('button', { cls: 'ws-wr-echip__x', attr: { type: 'button', 'aria-label': `Remove ${e?.name ?? 'missing entry'}` } });
		icon(x, 'x');
		x.addEventListener('click', o.onRemove);
	}
	return chip;
}

function pick(st: Studio, placeholder: string, exclude: Set<string>, onPick: (e: EntityRecord) => void): void {
	new EntitySuggestModal(st.ws.app, st.s, (e) => onPick(e), { placeholder, exclude }).open();
}

/**
 * The inspector's world fields (0.28: the design's order): point of view, location, and the
 * characters present with names found in the text suggested. Each is its own field.
 */
export function worldFields(st: Studio, it: ManuscriptItem): { pov: (b: HTMLElement) => void; location: (b: HTMLElement) => void; cast: (b: HTMLElement) => void } {
	const cur = () => st.w.item(it.id) ?? it;
	const set = (patch: Partial<Pick<ManuscriptItem, 'pov' | 'cast' | 'location'>>, msg: string) => {
		const res = st.w.update(it.id, patch);
		undoNotice(st, msg, res.undo);
	};
	const name = (id: string) => st.s.entities.get(id)?.name ?? 'the entry';
	const field = (b: HTMLElement, label: string, cls: string) => {
		const f = b.createDiv({ cls: cx('ws-wr-insp__field ws-wr-world', cls) });
		caps(f, label, 'ws-wr-sheet__label');
		return f.createDiv({ cls: 'ws-wr-world__chips' });
	};
	return {
		pov: (b) => {
			const pov = field(b, 'Point of view', 'ws-wr-world__pov');
			if (it.pov) entityChip(pov, st, it.pov, { role: 'point of view', onRemove: () => set({ pov: null }, `“${it.title}” has no point of view now.`) });
			else
				pov.createEl('button', { cls: 'ws-wr-world__add', text: 'Choose…', attr: { type: 'button' } }).addEventListener('click', () =>
					pick(st, 'Whose point of view?', new Set(), (e) => set({ pov: e.id, cast: withCast(cur().cast, e.id) }, `“${it.title}” is told by ${e.name}.`)),
				);
		},
		location: (b) => {
			const loc = field(b, 'Location', 'ws-wr-world__loc');
			if (it.location) entityChip(loc, st, it.location, { role: 'where', onRemove: () => set({ location: null }, `“${it.title}” has no place now.`) });
			else
				loc.createEl('button', { cls: 'ws-wr-world__add', text: 'Choose a place…', attr: { type: 'button' } }).addEventListener('click', () =>
					pick(st, 'Where does it happen?', new Set(), (e) => set({ location: e.id }, `“${it.title}” happens in ${e.name}.`)),
				);
		},
		cast: (b) => {
			const cast = field(b, 'Characters present', 'ws-wr-world__cast');
			for (const id of it.cast) entityChip(cast, st, id, { role: 'in the scene', onRemove: () => set({ cast: withoutCast(cur().cast, id) }, `${name(id)} is no longer in “${it.title}”.`) });
			cast.createEl('button', { cls: 'ws-wr-world__add', text: it.cast.length ? '+ Add' : 'Add who’s in it…', attr: { type: 'button' } }).addEventListener('click', () =>
				pick(st, 'Who is in this scene?', new Set(it.cast), (e) => set({ cast: withCast(cur().cast, e.id) }, `${e.name} is in “${it.title}”.`)),
			);
			mentions(cast.parentElement!, st, it, cur, set);
		},
	};
}

/** The old single section (kept for anything that still draws it): all three fields in a row. */
export function renderWorldSection(b: HTMLElement, st: Studio, it: ManuscriptItem): void {
	const f = worldFields(st, it);
	f.pov(b);
	f.cast(b);
	f.location(b);
}

/** Names found in the scene's text: suggestions only, one click to add. */
function mentions(sec: HTMLElement, st: Studio, it: ManuscriptItem, cur: () => ManuscriptItem, set: (patch: Partial<Pick<ManuscriptItem, 'pov' | 'cast' | 'location'>>, msg: string) => void): void {
	const sugg = sec.createDiv({ cls: 'ws-wr-world__mentions' });
	const path = it.notePath;
	const file = path ? st.ws.app.vault.getFileByPath(path) : null;
	if (!file) return;
	void st.ws.app.vault.cachedRead(file).then((text) => {
		if (!sugg.isConnected) return;
		const c = cur();
		const known = new Set([...c.cast, ...(c.pov ? [c.pov] : []), ...(c.location ? [c.location] : [])]);
		const ids = findMentions(text, st.s.entities.values(), { exclude: known, limit: 8 });
		if (!ids.length) return;
		sugg.createDiv({ cls: 'ws-wr-world__mentions-head', text: 'Mentioned in this scene' });
		const list = sugg.createDiv({ cls: 'ws-wr-world__chips' });
		for (const id of ids) {
			const e = st.s.entities.get(id);
			if (!e) continue;
			const isPlace = PLACES.includes(e.typeId);
			const add = list.createEl('button', { cls: 'ws-wr-world__suggest', attr: { type: 'button', 'data-entity': id, title: isPlace && !c.location ? `Set ${e.name} as where it happens` : `Add ${e.name} to who’s in it` } });
			icon(add, 'plus');
			add.createSpan({ text: e.name });
			add.addEventListener('click', () => {
				if (isPlace && !cur().location) set({ location: e.id }, `“${it.title}” happens in ${e.name}.`);
				else set({ cast: withCast(cur().cast, e.id) }, `${e.name} is in “${it.title}”.`);
			});
		}
	});
}
