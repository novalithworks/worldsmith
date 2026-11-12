import { Component, Keymap, Menu, Notice, setIcon } from 'obsidian';
import type { BlockDefinition } from '../../../blocks/BlockRegistry';
import type { BlockInstance, EntityRecord, EntitySchema, LayoutPresetDoc } from '../../../core/types';
import { relativeTime } from '../../../core/util/strings';
import { adaptLayout, LAYOUT_PRESETS, matchingPreset, presetById, sameLayout } from '../../../layouts/presets';
import { LayoutRenderer } from '../../../layouts/renderer/LayoutRenderer';
import type { WorldSession } from '../../../services/WorldSession';
import { ROUTES } from '../../../state/route';
import { avatar } from '../../components/avatar';
import { button, cx, emptyState, icon, nameRegion } from '../../components/dom';
import { own } from '../../components/lifecycle';
import { confirmModal } from '../../components/modals';
import { actionNotice } from '../../components/notice';
import { PresetModal } from '../../components/PresetModal';
import { undoLayoutReset } from '../../layoutUndo';
import type { RouteContext, RouteDefinition } from './RouteRegistry';
import { NoteStudio } from '../../notes/noteStudio';
import { layoutMiniature } from './typeStudio/layoutTab';

/**
 * Studio → Layout Studio (Milestone 9): every type's page layout in one place. Try a preset
 * (Profile, Encyclopedia, Visual…) or another type's layout on one of your own entries — a
 * live preview, nothing saved — then use it, with Undo. Also lists the entries with a page of
 * their own, to put back on the type's layout.
 */
export const layoutStudioRoute: RouteDefinition = {
	id: 'layout-studio',
	needsWorld: true,
	title: (p, s) => {
		const t = p.typeId ? s?.schemas.get(p.typeId) : undefined;
		return t ? `${t.plural} · Layout Studio` : 'Layout Studio';
	},
	icon: () => 'layout-template',
	render(ctx) {
		new LayoutStudio(ctx).mount();
	},
};

type Candidate = { kind: 'current' } | { kind: 'preset'; id: string } | { kind: 'custom'; id: string } | { kind: 'copy'; typeId: string };

/** How much of an entry is filled in — the fullest entry makes the best preview. */
function richness(e: EntityRecord): number {
	const filled = Object.values(e.values).filter((v) => v !== null && v !== undefined && v !== '' && !(Array.isArray(v) && !v.length)).length;
	return filled + (e.description ? 2 : 0) + (e.media.portrait ? 2 : 0) + Math.min(4, e.media.gallery.length);
}

/** Desktop previews draw the page this wide, then scale it to fit. */
const DESKTOP_WIDTH = 1040;
const PHONE_WIDTH = 390;

class LayoutStudio {
	private typeId: string | null;
	private candidate: Candidate = { kind: 'current' };
	private sampleId: string | null = null;
	private device: 'desktop' | 'phone' = 'desktop';
	private listEl!: HTMLElement;
	private mainEl!: HTMLElement;
	private preview: Component | null = null;
	private previewSec: HTMLElement | null = null;
	private presetsSec: HTMLElement | null = null;
	private queued = false;
	/** Which look is being edited: the Worldsmith page, or the native note (0.17). */
	private target: 'page' | 'note';
	private noteStudio: NoteStudio | null = null;

	constructor(private readonly ctx: RouteContext) {
		const s = ctx.session!;
		this.target = ctx.params.target === 'note' ? 'note' : 'page';
		const wanted = ctx.params.typeId;
		this.typeId = wanted && s.schemas.get(wanted) ? wanted : (s.schemas.list()[0]?.id ?? null);
	}

	private get s(): WorldSession {
		return this.ctx.session!;
	}

	mount(): void {
		const s = this.s;
		const page = this.ctx.el.createDiv({ cls: 'ws-page ws-page--studio ws-page--layout-studio' });
		const head = page.createDiv({ cls: 'ws-studio-head' });
		icon(head.createDiv({ cls: 'ws-db-header__mark ws-tint--blue' }), 'layout-template');
		const ht = head.createDiv({ cls: 'ws-db-header__text' });
		ht.createEl('h1', { cls: 'ws-db-header__title', text: 'Layout Studio' });
		ht.createDiv({ cls: 'ws-db-header__desc', text: 'Choose how each type’s pages are arranged. Try a layout on one of your own entries before using it.' });

		const body = page.createDiv({ cls: 'ws-studio' });
		this.listEl = body.createDiv({ cls: 'ws-studio__list', attr: { role: 'navigation' } });
		nameRegion(this.listEl, 'Entity types');
		this.mainEl = body.createDiv({ cls: 'ws-studio__main ws-ls' });
		this.renderList();
		this.renderMain();

		const refresh = () => this.queueRender();
		for (const ev of ['schema:updated', 'schema:created', 'layout:saved', 'layout:deleted', 'preset:saved', 'preset:deleted', 'note-template:saved', 'note-template:deleted'] as const) own(this.ctx.component, s.events.on(ev, refresh));
		own(this.ctx.component, s.events.on('world:updated', ({ keys }) => this.target === 'note' && keys.includes('noteTemplates') && refresh()));
		own(
			this.ctx.component,
			s.events.on('schema:deleted', ({ schema }) => {
				if (schema.id === this.typeId) this.select(s.schemas.list()[0]?.id ?? null);
				else refresh();
			}),
		);
		const ofThisType = ({ entity }: { entity: EntityRecord }) => {
			if (entity.typeId === this.typeId) refresh();
		};
		own(this.ctx.component, s.events.on('entity:created', ofThisType));
		own(this.ctx.component, s.events.on('entity:deleted', ofThisType));
		// Renamed or trashed: the sample list changes.
		own(
			this.ctx.component,
			s.events.on('entity:updated', ({ entity, change }) => {
				if (entity.typeId === this.typeId && change.keys.some((k) => k === 'trashedAt' || k === 'name')) refresh();
			}),
		);
	}

	private select(typeId: string | null): void {
		this.typeId = typeId;
		this.candidate = { kind: 'current' };
		this.sampleId = null;
		this.noteStudio?.dispose();
		this.noteStudio = null;
		this.ctx.replaceParams(this.params());
		const t = typeId ? this.s.schemas.get(typeId) : undefined;
		this.ctx.setTitle(t ? `${t.plural} · Layout Studio` : 'Layout Studio');
		this.renderList();
		this.renderMain(true);
	}

	private params(): Record<string, string> {
		const p: Record<string, string> = {};
		if (this.typeId) p.typeId = this.typeId;
		if (this.target === 'note') p.target = 'note';
		return p;
	}

	private setTarget(t: 'page' | 'note'): void {
		if (this.target === t) return;
		this.target = t;
		this.ctx.replaceParams(this.params());
		this.renderMain(true);
	}

	private queueRender(): void {
		if (this.queued) return;
		this.queued = true;
		window.requestAnimationFrame(() => {
			this.queued = false;
			if (!this.mainEl.isConnected) return;
			this.renderList();
			// The Native note tab updates in place (no flash while switching templates).
			if (this.target === 'note' && this.noteStudio && this.noteStudio.typeId === this.typeId) this.noteStudio.refresh();
			else this.renderMain();
		});
	}

	// ── type list ───────────────────────────────────────────────────────────

	private renderList(): void {
		const s = this.s;
		const el = this.listEl;
		el.empty();
		const groups = new Map<string, EntitySchema[]>();
		const placed = new Set<string>();
		for (const g of s.world.sidebar.groups) {
			const types = g.items
				.filter((i): i is { kind: 'type'; typeId: string } => i.kind === 'type')
				.map((i) => s.schemas.get(i.typeId))
				.filter((t): t is EntitySchema => !!t && !t.archived && !placed.has(t.id));
			types.forEach((t) => placed.add(t.id));
			if (types.length) groups.set(g.label, [...(groups.get(g.label) ?? []), ...types]);
		}
		const rest = s.schemas.list().filter((t) => !placed.has(t.id) && !t.archived);
		if (rest.length) groups.set('Other', rest);

		const sel = el.createEl('select', { cls: 'ws-input dropdown ws-studio__select', attr: { 'aria-label': 'Type' } });
		for (const [label, types] of groups) {
			const og = sel.createEl('optgroup', { attr: { label } });
			for (const t of types) og.createEl('option', { text: t.plural, value: t.id });
		}
		if (this.typeId) sel.value = this.typeId;
		sel.addEventListener('change', () => this.select(sel.value));

		for (const [label, types] of groups) {
			const g = el.createDiv({ cls: 'ws-rlist__cat' });
			const h = g.createDiv({ cls: 'ws-rlist__cat-head is-static' });
			h.createSpan({ cls: 'ws-rlist__cat-label', text: label });
			h.createSpan({ cls: 'ws-rlist__cat-n', text: String(types.length) });
			for (const t of types) {
				const on = t.id === this.typeId;
				const item = g.createEl('button', {
					cls: cx('ws-rlist__item', `ws-tint--${t.color ?? 'gray'}`, on && 'is-active'),
					attr: { type: 'button', 'aria-current': on ? 'true' : 'false', 'data-type': t.id },
				});
				setIcon(item.createSpan({ cls: 'ws-rlist__glyph' }), t.icon);
				const tx = item.createSpan({ cls: 'ws-rlist__text' });
				tx.createSpan({ cls: 'ws-rlist__name', text: t.plural });
				const { blocks, custom } = s.layouts.typeLayout(t);
				const named = custom ? this.layoutName(t, blocks) : null;
				tx.createSpan({ cls: 'ws-rlist__reads', text: custom ? (named ? `${named} layout` : 'Custom layout') : 'Standard layout' });
				const own = s.layouts.overridesOf(t.id, (id) => s.entities.get(id)).length;
				if (own) item.createSpan({ cls: 'ws-rlist__badge', text: `${own} own` });
				item.addEventListener('click', () => this.select(t.id));
			}
		}
	}

	// ── main ────────────────────────────────────────────────────────────────

	private candidateBlocks(schema: EntitySchema): BlockInstance[] {
		const c = this.candidate;
		if (c.kind === 'preset') {
			const p = presetById(c.id);
			if (p) return p.build(schema);
		}
		if (c.kind === 'custom') {
			const p = this.s.presets.get(c.id);
			if (p) return adaptLayout(p.blocks, schema);
		}
		if (c.kind === 'copy') {
			const from = this.s.schemas.get(c.typeId);
			if (from) return adaptLayout(this.s.layouts.typeLayout(from).blocks, schema);
		}
		return this.s.layouts.typeLayout(schema).blocks;
	}

	/** The name of the preset (built-in or one of yours) a type's layout matches, if any. */
	private layoutName(schema: EntitySchema, blocks: BlockInstance[]): string | null {
		const builtIn = matchingPreset(schema, blocks);
		if (builtIn) return builtIn.label;
		return this.matchingCustom(schema, blocks)?.name ?? null;
	}

	private matchingCustom(schema: EntitySchema, blocks: BlockInstance[]): LayoutPresetDoc | undefined {
		return this.s.presets.list().find((p) => sameLayout(adaptLayout(p.blocks, schema), blocks));
	}

	private renderMain(resetScroll = false): void {
		const s = this.s;
		const el = this.mainEl;
		const scroller = el.closest('.ws-shell__page');
		const scroll = scroller?.scrollTop ?? 0;
		// Hold the page's height while it is rebuilt, so the scroll position can't be clamped
		// (that made the page jump up).
		if (!resetScroll && el.offsetHeight) el.style.minHeight = `${el.offsetHeight}px`;
		this.disposePreview();
		el.empty();
		this.previewSec = this.presetsSec = null;
		const schema = this.typeId ? s.schemas.get(this.typeId) : undefined;
		if (!schema) {
			emptyState(el, { icon: 'layout-template', title: 'No types yet', body: 'Create a type in Type Studio first.', actionLabel: 'Open Type Studio', onAction: () => this.ctx.navigate(ROUTES.typeStudio()) });
			return;
		}
		const current = s.layouts.typeLayout(schema);
		const currentPreset = current.custom ? matchingPreset(schema, current.blocks) : presetById('standard');
		const currentCustom = current.custom && !currentPreset ? this.matchingCustom(schema, current.blocks) : undefined;
		const currentName = currentPreset?.label ?? currentCustom?.name ?? null;
		const doc = s.layouts.get({ kind: 'type', typeId: schema.id });

		// Type header.
		const head = el.createDiv({ cls: cx('ws-studio__type', schema.color && `ws-tint--${schema.color}`) });
		setIcon(head.createDiv({ cls: 'ws-studio__type-mark' }), schema.icon);
		const t = head.createDiv({ cls: 'ws-studio__type-text' });
		t.createDiv({ cls: 'ws-studio__type-name', text: `${schema.singular} pages` });
		t.createDiv({
			cls: 'ws-studio__type-meta ws-ls__status',
			text: current.custom ? `${currentName ? `${currentName} layout` : 'Custom layout'} · changed ${relativeTime(doc?.updatedAt ?? Date.now())}` : 'Standard layout (Worldsmith’s default)',
		});
		if (current.custom) {
			button(head, {
				label: 'Reset',
				icon: 'rotate-ccw',
				variant: 'quiet',
				size: 'sm',
				cls: 'ws-ls__reset',
				tooltip: `Back to the standard ${schema.singular.toLowerCase()} layout`,
				onClick: () => void this.resetType(schema),
			});
		}
		button(head, {
			label: 'Fields',
			icon: 'shapes',
			variant: 'quiet',
			size: 'sm',
			tooltip: `${schema.plural} in Type Studio`,
			onClick: (evt) => this.ctx.navigate(ROUTES.typeStudio(schema.id), Keymap.isModEvent(evt)),
		});

		// Worldsmith page or native note.
		const sw = el.createDiv({ cls: 'ws-nn-target', attr: { role: 'tablist', 'aria-label': 'What to design' } });
		for (const [id, label, glyph] of [
			['page', 'Worldsmith page', 'layout-template'],
			['note', 'Native note', 'file-text'],
		] as const) {
			const on = this.target === id;
			const b = sw.createEl('button', { cls: cx('ws-nn-target__tab', on && 'is-active'), attr: { type: 'button', role: 'tab', 'aria-selected': String(on), 'data-target': id } });
			icon(b, glyph);
			b.createSpan({ text: label });
			b.addEventListener('click', () => this.setTarget(id));
		}
		if (this.target === 'note') {
			if (!this.noteStudio) {
				this.noteStudio = new NoteStudio(this.ctx.ws, s, this.ctx.component, () => this.renderMain());
				this.noteStudio.select(this.ctx.params.template ?? null, this.ctx.params.sample ?? null);
			}
			this.noteStudio.render(el.createDiv({ cls: 'ws-nns' }), schema);
			if (resetScroll && scroller) scroller.scrollTop = 0;
			else if (scroller) scroller.scrollTop = scroll;
			el.setCssStyles({ minHeight: '' });
			return;
		}

		// Starting points.
		const presets = el.createDiv({ cls: 'ws-ls__sec ws-ls__choices' });
		this.presetsSec = presets;
		const ph = presets.createDiv({ cls: 'ws-ls__h' });
		ph.createSpan({ text: 'Layouts' });
		ph.createSpan({ cls: 'ws-ls__h-hint', text: 'Choose one to preview it below' });
		const grid = presets.createDiv({ cls: 'ws-ls__presets', attr: { role: 'listbox' } });
		nameRegion(grid, 'Layouts to preview');
		const isPicked = (c: Candidate) => JSON.stringify(c) === JSON.stringify(this.candidate);
		const card = (host: HTMLElement, c: Candidate, label: string, desc: string, glyph: string, blocks: BlockInstance[], badge?: string): HTMLElement => {
			const on = isPicked(c);
			const b = host.createEl('button', {
				cls: cx('ws-ls__preset', on && 'is-active'),
				attr: { type: 'button', role: 'option', 'aria-selected': String(on), 'data-preset': c.kind === 'preset' || c.kind === 'custom' ? c.id : c.kind },
			});
			layoutMiniature(b, this.ctx.ws, schema, blocks, { small: true });
			const tx = b.createDiv({ cls: 'ws-ls__preset-text' });
			const nm = tx.createDiv({ cls: 'ws-ls__preset-name' });
			icon(nm, glyph);
			nm.createSpan({ cls: 'ws-ls__preset-label', text: label });
			if (badge) nm.createSpan({ cls: 'ws-ls__badge', text: badge });
			tx.createDiv({ cls: 'ws-ls__preset-desc', text: desc });
			b.dataset.candidate = JSON.stringify(c);
			b.addEventListener('click', () => this.pick(c));
			return b;
		};
		// What pages use now — unless that's exactly one of the presets (it's marked there).
		if (current.custom && !currentPreset && !currentCustom) card(grid, { kind: 'current' }, 'Your layout', 'How every page looks now, as you arranged it.', 'layout-dashboard', current.blocks, 'In use');
		for (const p of LAYOUT_PRESETS) {
			const inUse = currentPreset?.id === p.id;
			card(grid, inUse ? { kind: 'current' } : { kind: 'preset', id: p.id }, p.label, p.description, p.icon, p.build(schema), inUse ? 'In use' : undefined);
		}
		const others = s.schemas.list().filter((x) => x.id !== schema.id && !x.archived);
		if (others.length) {
			const copyFrom = this.candidate.kind === 'copy' ? s.schemas.get(this.candidate.typeId) : undefined;
			const c = grid.createDiv({ cls: cx('ws-ls__preset ws-ls__preset--copy', copyFrom && 'is-active'), attr: { 'data-preset': 'copy' } });
			const glyph = c.createDiv({ cls: 'ws-ls__copy-mark' });
			setIcon(glyph, 'copy');
			const tx = c.createDiv({ cls: 'ws-ls__preset-text' });
			const nm = tx.createDiv({ cls: 'ws-ls__preset-name' });
			nm.createSpan({ text: 'Copy from another type' });
			tx.createDiv({ cls: 'ws-ls__preset-desc', text: 'Use another type’s layout; widgets that name its fields switch to this type’s.' });
			const sel = tx.createEl('select', { cls: 'dropdown ws-ls__copy', attr: { 'aria-label': 'Copy the layout of' } });
			sel.createEl('option', { value: '', text: 'Choose a type…' });
			for (const o of others) sel.createEl('option', { value: o.id, text: `${o.plural}${s.layouts.typeLayout(o).custom ? '' : ' (standard)'}` });
			sel.value = copyFrom?.id ?? '';
			sel.addEventListener('change', () => this.pick(sel.value ? { kind: 'copy', typeId: sel.value } : { kind: 'current' }));
		}

		// Presets people made.
		const mine = s.presets.list();
		const yh = presets.createDiv({ cls: 'ws-ls__h ws-ls__h--mine' });
		yh.createSpan({ text: 'Your presets' });
		if (mine.length) yh.createSpan({ cls: 'ws-ls__h-n', text: String(mine.length) });
		yh.createSpan({ cls: 'ws-ls__h-hint', text: 'Layouts you saved — any type can use them' });
		const mineGrid = presets.createDiv({ cls: 'ws-ls__presets ws-ls__presets--mine', attr: { role: 'listbox' } });
		nameRegion(mineGrid, 'Your presets');
		for (const p of mine) {
			const wrap = mineGrid.createDiv({ cls: 'ws-ls__preset-wrap', attr: { 'data-custom': p.id } });
			const inUse = currentCustom?.id === p.id;
			const from = p.fromType ? s.schemas.get(p.fromType) : undefined;
			const desc = p.description || (from ? `Made from the ${from.plural} layout.` : 'A layout you saved.');
			card(wrap, inUse ? { kind: 'current' } : { kind: 'custom', id: p.id }, p.name, desc, p.icon, adaptLayout(p.blocks, schema), inUse ? 'In use' : undefined);
			button(wrap, {
				icon: 'more-horizontal',
				variant: 'quiet',
				size: 'sm',
				cls: 'ws-ls__preset-menu',
				tooltip: `${p.name}: rename, update, duplicate or delete`,
				onClick: (evt) => this.presetMenu(evt, p, schema),
			});
		}
		const add = mineGrid.createEl('button', { cls: 'ws-ls__preset ws-ls__preset--add', attr: { type: 'button', 'data-preset': 'add' } });
		const addMark = add.createDiv({ cls: 'ws-ls__copy-mark ws-ls__add-mark' });
		setIcon(addMark, 'plus');
		const atx = add.createDiv({ cls: 'ws-ls__preset-text' });
		atx.createDiv({ cls: 'ws-ls__preset-name', text: 'Save as a preset' });
		atx.createDiv({ cls: 'ws-ls__preset-desc', text: 'Keep the layout you’re previewing under a name of your own, to use on any type.' });
		add.addEventListener('click', () => this.savePreset(schema));

		// Preview.
		this.previewSec = el.createDiv({ cls: 'ws-ls__sec ws-ls__preview' });
		this.renderPreview(schema);

		// Entries with their own page.
		this.renderOwn(el, schema);

		if (resetScroll) scroller?.scrollTo({ top: 0 });
		else if (scroller) scroller.scrollTop = scroll;
		window.requestAnimationFrame(() => {
			el.style.removeProperty('min-height');
		});
	}

	/**
	 * Choose what to preview. Only the selection marks and the preview change — the cards
	 * themselves stay, so nothing under the pointer is rebuilt (that flickered) and the page
	 * keeps its place.
	 */
	private pick(c: Candidate): void {
		this.candidate = c;
		const schema = this.typeId ? this.s.schemas.get(this.typeId) : undefined;
		if (!schema || !this.presetsSec || !this.previewSec) {
			this.renderMain();
			return;
		}
		const key = JSON.stringify(c);
		for (const card of Array.from(this.presetsSec.querySelectorAll<HTMLElement>('.ws-ls__preset'))) {
			if (card.dataset.preset === 'add') continue;
			const on = card.dataset.preset === 'copy' ? c.kind === 'copy' : card.dataset.candidate === key;
			card.toggleClass('is-active', on);
			if (card.dataset.preset !== 'copy') card.setAttribute('aria-selected', String(on));
		}
		const copySel = this.presetsSec.querySelector<HTMLSelectElement>('.ws-ls__copy');
		if (copySel && c.kind !== 'copy') copySel.value = '';
		this.renderPreview(schema);
	}

	/** (Re)draw the preview section in place, keeping its height until the new page is laid out. */
	private renderPreview(schema: EntitySchema): void {
		const s = this.s;
		const sec = this.previewSec;
		if (!sec) return;
		const blocks = this.candidateBlocks(schema);
		const changed = !sameLayout(blocks, s.layouts.typeLayout(schema).blocks);
		const oldViewport = sec.querySelector<HTMLElement>('.ws-ls__viewport');
		const keepHeight = oldViewport?.offsetHeight ?? 0;
		// The page keeps its place while the preview is redrawn (the browser's scroll
		// anchoring would otherwise follow the old preview and jump).
		const scroller = sec.closest<HTMLElement>('.ws-shell__page');
		const top = scroller?.scrollTop ?? null;
		const keepPlace = () => {
			if (scroller && top != null && scroller.scrollTop !== top) scroller.scrollTop = top;
		};
		if (sec.offsetHeight) sec.style.minHeight = `${sec.offsetHeight}px`;
		this.disposePreview();
		sec.empty();
		const bar = sec.createDiv({ cls: 'ws-ls__bar' });
		const label = bar.createDiv({ cls: 'ws-ls__bar-label' });
		const name = this.candidateName(schema);
		label.createSpan({ cls: 'ws-ls__h', text: changed ? `Preview: ${name}` : `Preview: ${name} (in use)` });

		const entries = s.entities
			.all()
			.filter((e) => e.typeId === schema.id && !e.trashedAt)
			.sort((a, b) => richness(b) - richness(a) || b.updatedAt - a.updatedAt);
		if (!entries.some((e) => e.id === this.sampleId)) this.sampleId = entries[0]?.id ?? null;
		const sample = this.sampleId ? s.entities.get(this.sampleId) : undefined;

		const tools = bar.createDiv({ cls: 'ws-ls__tools' });
		if (entries.length) {
			const pick = tools.createEl('select', { cls: 'dropdown ws-ls__sample', attr: { 'aria-label': `Preview on which ${schema.singular.toLowerCase()}` } });
			for (const e of entries.slice(0, 80)) pick.createEl('option', { value: e.id, text: e.name });
			pick.value = this.sampleId ?? '';
			pick.addEventListener('change', () => {
				this.sampleId = pick.value;
				this.renderPreview(schema);
			});
		}
		const seg = tools.createDiv({ cls: 'ws-segmented ws-segmented--sm ws-ls__device', attr: { role: 'radiogroup' } });
		nameRegion(seg, 'Preview size');
		for (const [id, ic, tip] of [
			['desktop', 'monitor', 'Wide window'],
			['phone', 'smartphone', 'Phone'],
		] as const) {
			const on = this.device === id;
			const b = seg.createEl('button', { cls: cx('ws-segmented__item', on && 'is-active'), attr: { type: 'button', role: 'radio', 'aria-checked': String(on), 'aria-label': tip, 'data-device': id } });
			setIcon(b, ic);
			b.addEventListener('click', () => {
				if (this.device === id) return;
				this.device = id;
				this.renderPreview(schema);
			});
		}

		const actions = bar.createDiv({ cls: 'ws-ls__actions' });
		button(actions, {
			label: changed ? 'Use this layout' : 'In use',
			icon: changed ? 'check' : undefined,
			variant: 'primary',
			size: 'sm',
			cls: 'ws-ls__use',
			disabled: !changed,
			onClick: () => void this.useCandidate(schema, blocks, name),
		});
		button(actions, {
			label: 'Save as preset',
			icon: 'bookmark-plus',
			variant: 'ghost',
			size: 'sm',
			cls: 'ws-ls__save-preset',
			tooltip: 'Keep this layout under a name of your own',
			onClick: () => this.savePreset(schema),
		});
		if (sample)
			button(actions, {
				label: 'Fine-tune on this page',
				icon: 'layout-grid',
				variant: 'ghost',
				size: 'sm',
				cls: 'ws-ls__edit',
				tooltip: changed ? 'Opens the layout in use now — use this one first to fine-tune it' : 'Drag, resize and set up widgets on the real page',
				onClick: () => this.ctx.navigate({ name: 'entity', params: { id: sample.id, edit: 'type' } }),
			});

		const frame = sec.createDiv({ cls: cx('ws-ls__frame', `is-${this.device}`) });
		if (!sample) {
			const empty = frame.createDiv({ cls: 'ws-ls__nosample' });
			layoutMiniature(empty, this.ctx.ws, schema, blocks);
			emptyState(empty, {
				icon: schema.icon,
				title: `No ${schema.plural.toLowerCase()} to preview on yet`,
				body: 'The preview shows a layout with a real entry’s content.',
				actionLabel: `Create a ${schema.singular.toLowerCase()}`,
				actionIcon: 'plus',
				compact: true,
				onAction: () => {
					const e = s.entityService.create(schema.id, { name: `New ${schema.singular.toLowerCase()}` });
					this.sampleId = e.id;
				},
			});
			sec.style.removeProperty('min-height');
			keepPlace();
			return;
		}
		const viewport = frame.createDiv({ cls: 'ws-ls__viewport' });
		// Start at the old preview's height so switching doesn't collapse and regrow the page.
		if (keepHeight) viewport.style.height = `${keepHeight}px`;
		const phone = this.device === 'phone';
		// The page is drawn in its own size context: a phone preview gets the same narrow
		// rules a phone does, even on a wide screen.
		const canvas = viewport.createDiv({
			cls: 'worldsmith ws-ls__canvas ws-entity-view',
			attr: { inert: '', 'aria-hidden': 'true', 'data-ws-size': phone ? 'narrow' : 'wide' },
		});
		const root = sec.closest<HTMLElement>('.worldsmith');
		for (const k of ['wsDensity', 'wsMotion'] as const) if (root?.dataset[k]) canvas.dataset[k] = root.dataset[k];
		const comp = new Component();
		this.preview = comp;
		this.ctx.component.addChild(comp);
		const renderer = new LayoutRenderer(this.ctx.ws.blocks, (instance: BlockInstance, def: BlockDefinition, bel: HTMLElement, component: Component, setTitle: (t: string) => void) => ({
			ws: this.ctx.ws,
			app: this.ctx.ws.app,
			session: s,
			el: bel,
			instance,
			config: { ...def.defaultConfig, ...instance.config },
			component,
			surface: 'entity',
			entity: sample,
			schema,
			navigate: () => {},
			setTitle,
		}));
		comp.addChild(renderer);
		const a = this.ctx.ws.settings.appearance;
		/** How wide the real page would be in a window this wide. */
		const pageWidth = (avail: number): number => {
			if (phone) return PHONE_WIDTH;
			const real = a.fullWidth ? avail : Math.min(avail, a.maxWidth);
			return Math.max(DESKTOP_WIDTH, Math.round(real));
		};
		let width = pageWidth(viewport.clientWidth || DESKTOP_WIDTH);
		canvas.style.width = `${width}px`;
		renderer.render(canvas, blocks);
		// Draw the page as wide as it would really be (filling the frame with Full width on),
		// scaled down only when the frame is narrower than a desktop page.
		const fit = () => {
			const avail = viewport.clientWidth;
			if (!avail) return;
			const w = pageWidth(avail);
			if (w !== width) {
				width = w;
				canvas.style.width = `${w}px`;
			}
			const scale = Math.min(1, avail / width);
			canvas.style.transform = scale < 1 ? `scale(${scale})` : '';
			canvas.style.marginLeft = scale < 1 ? '' : `${Math.max(0, Math.floor((avail - width) / 2))}px`;
			viewport.style.height = `${Math.ceil(canvas.offsetHeight * scale)}px`;
			viewport.style.setProperty('--ws-ls-scale', String(scale));
			sec.style.removeProperty('min-height');
		};
		const ro = new ResizeObserver(() => fit());
		ro.observe(viewport);
		ro.observe(canvas);
		comp.register(() => ro.disconnect());
		fit();
		keepPlace();
	}

	private candidateName(schema: EntitySchema): string {
		const c = this.candidate;
		if (c.kind === 'preset') return presetById(c.id)?.label ?? 'Layout';
		if (c.kind === 'custom') return this.s.presets.get(c.id)?.name ?? 'Preset';
		if (c.kind === 'copy') return `${this.s.schemas.get(c.typeId)?.plural ?? 'Other'} layout`;
		const cur = this.s.layouts.typeLayout(schema);
		return cur.custom ? (this.layoutName(schema, cur.blocks) ?? 'Your layout') : 'Standard';
	}

	// ── presets people made ─────────────────────────────────────────────────

	/** Save what's being previewed as a preset. */
	private savePreset(schema: EntitySchema): void {
		const s = this.s;
		const blocks = this.candidateBlocks(schema);
		const c = this.candidate;
		const suggested = c.kind === 'current' ? `${schema.singular} page` : `${this.candidateName(schema)} for ${schema.plural}`;
		new PresetModal(this.ctx.ws.app, {
			title: 'Save as a preset',
			submitLabel: 'Save preset',
			hint: `Saves the layout shown in the preview (${this.candidateName(schema)}). Any type can use it; widgets that name fields switch to that type’s own.`,
			initial: { name: s.presets.uniqueName(suggested), icon: c.kind === 'preset' ? (presetById(c.id)?.icon ?? 'layout-template') : 'layout-template' },
			onSubmit: (d) => {
				const p = s.presets.create({ ...d, blocks, fromType: schema.id });
				// Keep showing the same layout — now as the preset.
				this.candidate = sameLayout(blocks, s.layouts.typeLayout(schema).blocks) ? { kind: 'current' } : { kind: 'custom', id: p.id };
				actionNotice(`Saved “${p.name}” as a preset.`, {
					label: 'Undo',
					run: () => {
						const now = s.presets.get(p.id);
						if (now && now.rev !== p.rev) {
							new Notice('The preset was changed since, so it was kept.');
							return;
						}
						s.presets.remove(p.id);
					},
				});
			},
		}).open();
	}

	private presetMenu(evt: MouseEvent, p: LayoutPresetDoc, schema: EntitySchema): void {
		const s = this.s;
		const m = new Menu();
		m.addItem((i) =>
			i
				.setTitle('Rename and describe…')
				.setIcon('pencil')
				.onClick(() =>
					new PresetModal(this.ctx.ws.app, {
						title: 'Preset details',
						submitLabel: 'Save',
						initial: p,
						onSubmit: (d) => {
							const r = s.presets.update(p.id, d);
							if (r) actionNotice(`Preset “${r.after.name}” updated.`, { label: 'Undo', run: () => s.presets.restore(r.before) });
						},
					}).open(),
				),
		);
		const cur = s.layouts.typeLayout(schema);
		m.addItem((i) =>
			i
				.setTitle(`Update from the ${schema.plural} layout in use`)
				.setIcon('refresh-cw')
				.setDisabled(sameLayout(adaptLayout(p.blocks, schema), cur.blocks))
				.onClick(async () => {
					const ok = await confirmModal(this.ctx.ws.app, {
						title: `Update “${p.name}”?`,
						body: `The preset takes the arrangement every ${schema.singular.toLowerCase()} page uses now. Types already using it keep their current pages.`,
						confirmLabel: 'Update preset',
					});
					if (!ok) return;
					const r = s.presets.update(p.id, { blocks: cur.blocks, fromType: schema.id });
					if (r) actionNotice(`“${p.name}” now has the ${schema.plural} layout.`, { label: 'Undo', run: () => s.presets.restore(r.before) });
				}),
		);
		m.addItem((i) =>
			i
				.setTitle('Duplicate')
				.setIcon('copy')
				.onClick(() => {
					const d = s.presets.duplicate(p.id);
					if (d) actionNotice(`Made “${d.name}”.`, { label: 'Undo', run: () => s.presets.remove(d.id) });
				}),
		);
		m.addSeparator();
		m.addItem((i) =>
			i
				.setTitle('Delete preset')
				.setIcon('trash-2')
				.setWarning(true)
				.onClick(() => {
					const removed = s.presets.remove(p.id);
					if (this.candidate.kind === 'custom' && this.candidate.id === p.id) this.candidate = { kind: 'current' };
					if (removed) actionNotice(`Deleted the preset “${removed.name}”. Pages using its layout keep it.`, { label: 'Undo', run: () => s.presets.restore(removed) });
				}),
		);
		m.showAtMouseEvent(evt);
	}

	private disposePreview(): void {
		if (this.preview) this.ctx.component.removeChild(this.preview);
		this.preview = null;
		this.noteStudio?.dispose();
	}

	private async useCandidate(schema: EntitySchema, blocks: BlockInstance[], name: string): Promise<void> {
		const s = this.s;
		const scope = { kind: 'type' as const, typeId: schema.id };
		// A layout arranged by hand (not one of the presets) can't be chosen again afterwards:
		// make sure first.
		const cur = s.layouts.typeLayout(schema);
		if (cur.custom && !this.layoutName(schema, cur.blocks)) {
			const ok = await confirmModal(this.ctx.ws.app, {
				title: `Replace your ${schema.singular.toLowerCase()} layout?`,
				body: `Every ${schema.singular.toLowerCase()} page will use the ${name} layout. The layout you arranged yourself can only be brought back with Undo right after.`,
				confirmLabel: 'Replace layout',
			});
			if (!ok) return;
		}
		const prev = s.layouts.get(scope);
		const prevCopy = prev ? (JSON.parse(JSON.stringify(prev)) as typeof prev) : null;
		// The standard layout is “no layout of your own” — so later improvements reach it.
		const standard = this.candidate.kind === 'preset' && this.candidate.id === 'standard';
		if (standard) s.layouts.reset(scope);
		else s.layouts.save(scope, blocks);
		const saved = s.layouts.get(scope);
		this.candidate = { kind: 'current' };
		actionNotice(`Every ${schema.singular.toLowerCase()} page now uses the ${name} layout.`, {
			label: 'Undo',
			run: () => {
				// Only if nothing changed it since.
				const now = s.layouts.get(scope);
				if ((now?.rev ?? null) !== (saved?.rev ?? null) || (now?.updatedAt ?? null) !== (saved?.updatedAt ?? null)) {
					new Notice('The layout was changed again since, so it was left as it is.');
					return;
				}
				if (prevCopy) s.layouts.restore(prevCopy);
				else s.layouts.reset(scope);
			},
		});
		this.renderList();
		this.renderMain();
	}

	private async resetType(schema: EntitySchema): Promise<void> {
		const ok = await confirmModal(this.ctx.ws.app, {
			title: `Reset the ${schema.singular} layout?`,
			body: `Every ${schema.singular.toLowerCase()} page goes back to the standard layout. Entries with a layout of their own keep it.`,
			confirmLabel: 'Reset layout',
		});
		if (!ok) return;
		const removed = this.s.layouts.reset({ kind: 'type', typeId: schema.id });
		this.candidate = { kind: 'current' };
		if (removed) actionNotice(`The ${schema.singular} layout is back to the standard one.`, { label: 'Undo', run: () => undoLayoutReset(this.s, removed, `The ${schema.singular} layout`) });
	}

	private renderOwn(el: HTMLElement, schema: EntitySchema): void {
		const s = this.s;
		const own = s.layouts.overridesOf(schema.id, (id) => s.entities.get(id));
		const sec = el.createDiv({ cls: 'ws-ls__sec ws-ls__own' });
		const h = sec.createDiv({ cls: 'ws-ls__h' });
		h.createSpan({ text: 'Pages with a layout of their own' });
		if (own.length) h.createSpan({ cls: 'ws-ls__h-n', text: String(own.length) });
		if (!own.length) {
			sec.createDiv({ cls: 'ws-fm__hint', text: `None — every ${schema.singular.toLowerCase()} uses the layout above. To give one a different page, open Customize on it and choose “Only …”.` });
			return;
		}
		sec.createDiv({ cls: 'ws-fm__hint', text: `These ${own.length === 1 ? 'page keeps its' : 'pages keep their'} own arrangement whatever you choose above.` });
		const list = sec.createDiv({ cls: 'ws-ls__own-list' });
		for (const e of own) {
			const row = list.createDiv({ cls: 'ws-lt__own', attr: { 'data-entity': e.id } });
			const who = row.createDiv({ cls: 'ws-lt__own-who' });
			avatar(who, this.ctx.ws.app, e, schema, { size: 'xs' });
			who.createSpan({ cls: 'ws-lt__own-name', text: e.name });
			const changedAt = s.layouts.get({ kind: 'entity', entityId: e.id })?.updatedAt;
			if (changedAt) who.createSpan({ cls: 'ws-ls__own-when', text: relativeTime(changedAt) });
			const acts = row.createDiv({ cls: 'ws-lt__own-acts' });
			button(acts, { label: 'Open', icon: 'arrow-up-right', variant: 'ghost', size: 'sm', onClick: (evt) => this.ctx.navigate(ROUTES.entity(e.id), Keymap.isModEvent(evt)) });
			button(acts, {
				label: `Use the ${schema.plural} layout`,
				variant: 'ghost',
				size: 'sm',
				cls: 'ws-lt__use-type',
				onClick: () => {
					const removed = s.layouts.reset({ kind: 'entity', entityId: e.id });
					if (removed) actionNotice(`${e.name} now uses the ${schema.plural} layout.`, { label: 'Undo', run: () => undoLayoutReset(s, removed, `${e.name}’s page`) });
				},
			});
		}
		if (own.length > 1) {
			button(sec, {
				label: `Put all ${own.length} on the ${schema.plural} layout`,
				icon: 'rotate-ccw',
				variant: 'ghost',
				size: 'sm',
				cls: 'ws-ls__reset-all',
				onClick: () => void (async () => {
					const ok = await confirmModal(this.ctx.ws.app, {
						title: `Reset ${own.length} pages?`,
						body: `${own.map((x) => x.name).join(', ')} will use the ${schema.plural} layout. You can undo this.`,
						confirmLabel: 'Reset pages',
					});
					if (!ok) return;
					const removed = own.map((x) => s.layouts.reset({ kind: 'entity', entityId: x.id })).filter((d): d is NonNullable<typeof d> => !!d);
					actionNotice(`${removed.length} page${removed.length === 1 ? '' : 's'} now use the ${schema.plural} layout.`, {
						label: 'Undo',
						run: () => {
							for (const d of removed) undoLayoutReset(s, d, 'A page');
						},
					});
				})(),
			});
		}
	}
}
