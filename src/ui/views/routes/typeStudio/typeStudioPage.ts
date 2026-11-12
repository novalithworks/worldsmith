import { Keymap, Notice, setIcon } from 'obsidian';
import type { EntitySchema } from '../../../../core/types';
import { ROUTES } from '../../../../state/route';
import { openNewType } from '../../../actions';
import { button, cx, emptyState, icon, nameRegion } from '../../../components/dom';
import { own } from '../../../components/lifecycle';
import type { RouteContext, RouteDefinition } from '../RouteRegistry';
import { renderFieldsTab } from './fieldsTab';
import { renderLayoutTab } from './layoutTab';
import { renderChecklistTab, renderDisplayTab, renderTypeSettingsTab } from './otherTabs';

type Tab = 'fields' | 'display' | 'layout' | 'checklist' | 'settings';
const TABS: Array<{ id: Tab; label: string; icon: string }> = [
	{ id: 'fields', label: 'Fields', icon: 'list' },
	{ id: 'display', label: 'Display', icon: 'layout-grid' },
	{ id: 'layout', label: 'Page layout', icon: 'layout-dashboard' },
	{ id: 'checklist', label: 'Checklist', icon: 'list-checks' },
	{ id: 'settings', label: 'Settings', icon: 'settings-2' },
];

/**
 * Type Studio: reshape any entity type without code. Left: every type. Right: the
 * selected type's fields & sections, display, default checklist and settings.
 */
export const typeStudioRoute: RouteDefinition = {
	id: 'type-studio',
	needsWorld: true,
	title: (p, s) => {
		const t = p.typeId ? s?.schemas.get(p.typeId) : undefined;
		return t ? `${t.plural} · Type Studio` : 'Type Studio';
	},
	icon: () => 'shapes',
	render(ctx) {
		new TypeStudio(ctx).mount();
	},
};

class TypeStudio {
	private typeId: string | null;
	private tab: Tab;
	private focusSection: string | undefined;
	private listEl!: HTMLElement;
	private mainEl!: HTMLElement;
	private undoBtn!: HTMLButtonElement;
	private queued = false;

	constructor(private readonly ctx: RouteContext) {
		const s = ctx.session!;
		const wanted = ctx.params.typeId;
		this.typeId = wanted && s.schemas.get(wanted) ? wanted : (s.schemas.list()[0]?.id ?? null);
		this.tab = (TABS.some((t) => t.id === ctx.params.tab) ? ctx.params.tab : 'fields') as Tab;
		this.focusSection = ctx.params.section;
	}

	mount(): void {
		const s = this.ctx.session!;
		const page = this.ctx.el.createDiv({ cls: 'ws-page ws-page--studio' });
		const head = page.createDiv({ cls: 'ws-studio-head' });
		const mark = head.createDiv({ cls: 'ws-db-header__mark ws-tint--purple' });
		icon(mark, 'shapes');
		const ht = head.createDiv({ cls: 'ws-db-header__text' });
		ht.createEl('h1', { cls: 'ws-db-header__title', text: 'Type Studio' });
		ht.createDiv({ cls: 'ws-db-header__desc', text: 'Shape every kind of entry in your world: its fields, sections, cards, page layout and checklist.' });
		const actions = head.createDiv({ cls: 'ws-db-header__actions' });
		this.undoBtn = button(actions, { label: 'Undo', icon: 'undo-2', variant: 'ghost', size: 'sm', onClick: () => this.undo() });
		button(actions, { label: 'New type', icon: 'plus', variant: 'primary', onClick: () => openNewType(this.ctx.ws, (id) => this.select(id)) });

		const body = page.createDiv({ cls: 'ws-studio' });
		this.listEl = body.createDiv({ cls: 'ws-studio__list', attr: { role: 'navigation'} });
		nameRegion(this.listEl, 'Entity types' );
		this.mainEl = body.createDiv({ cls: 'ws-studio__main' });
		this.renderList();
		this.renderMain();
		this.paintUndo();

		const refresh = () => this.queueRender();
		own(this.ctx.component, s.events.on('schema:updated', refresh));
		own(this.ctx.component, s.events.on('schema:created', refresh));
		own(this.ctx.component, s.events.on('schema:deleted', ({ schema }) => {
			if (schema.id === this.typeId) this.typeId = s.schemas.list()[0]?.id ?? null;
			refresh();
		}));
		own(this.ctx.component, s.events.on('world:updated', ({ keys }) => keys.includes('sidebar') && refresh()));
		for (const ev of ['relationType:created', 'relationType:updated', 'relationType:deleted'] as const) own(this.ctx.component, s.events.on(ev, refresh));
		for (const ev of ['layout:saved', 'layout:deleted'] as const) own(this.ctx.component, s.events.on(ev, () => this.tab === 'layout' && refresh()));
		this.ctx.component.register(s.schemaEdits.onUndoChange(() => this.paintUndo()));

		// Cmd/Ctrl+Z undoes schema edits when focus isn't in a text box.
		const onKey = (e: KeyboardEvent) => {
			if (!(e.key === 'z' || e.key === 'Z') || !Keymap.isModEvent(e) || e.shiftKey) return;
			const t = e.target as HTMLElement;
			if (t.closest('input, textarea, [contenteditable="true"]')) return;
			if (!page.isConnected) return;
			e.preventDefault();
			this.undo();
		};
		page.ownerDocument.addEventListener('keydown', onKey);
		this.ctx.component.register(() => page.ownerDocument.removeEventListener('keydown', onKey));
	}

	private undo(): void {
		const label = this.ctx.session!.schemaEdits.undo();
		new Notice(label ? `Undid: ${label}` : 'Nothing to undo.');
	}

	private paintUndo(): void {
		const E = this.ctx.session!.schemaEdits;
		this.undoBtn.disabled = !E.canUndo();
		this.undoBtn.setAttr('title', E.canUndo() ? `Undo: ${E.lastUndoLabel()}` : 'Nothing to undo');
	}

	private select(typeId: string, tab: Tab = this.tab): void {
		this.typeId = typeId;
		this.tab = tab;
		this.focusSection = undefined;
		this.ctx.replaceParams({ typeId, tab });
		this.ctx.setTitle(`${this.ctx.session!.schemas.get(typeId)?.plural ?? ''} · Type Studio`);
		this.renderList();
		this.renderMain(true);
	}

	private queueRender(): void {
		if (this.queued) return;
		this.queued = true;
		window.requestAnimationFrame(() => {
			this.queued = false;
			this.renderList();
			this.renderMain();
		});
	}

	// ── type list ───────────────────────────────────────────────────────────

	private renderList(): void {
		const s = this.ctx.session!;
		const el = this.listEl;
		el.empty();
		const all = s.schemaRepo.all();
		const byGroup = new Map<string, EntitySchema[]>();
		const placed = new Set<string>();
		for (const g of s.world.sidebar.groups) {
			const types = g.items
				.filter((i): i is { kind: 'type'; typeId: string } => i.kind === 'type')
				.map((i) => s.schemas.get(i.typeId))
				.filter((t): t is EntitySchema => !!t && !t.archived);
			types.forEach((t) => placed.add(t.id));
			if (types.length) byGroup.set(g.label, types);
		}
		const rest = all.filter((t) => !placed.has(t.id) && !t.archived);
		if (rest.length) byGroup.set('Other', rest);
		const archived = all.filter((t) => t.archived);
		if (archived.length) byGroup.set('Archived', archived);

		// Narrow panes: a select instead of the list.
		const sel = el.createEl('select', { cls: 'ws-input dropdown ws-studio__select', attr: { 'aria-label': 'Type' } });
		for (const [label, types] of byGroup) {
			const og = sel.createEl('optgroup', { attr: { label } });
			for (const t of types) og.createEl('option', { text: t.plural, value: t.id });
		}
		if (this.typeId) sel.value = this.typeId;
		sel.addEventListener('change', () => this.select(sel.value));

		// Same look as Studio → Relationships: tinted glyph, name, and what's in it.
		for (const [label, types] of byGroup) {
			const g = el.createDiv({ cls: 'ws-rlist__cat' });
			const h = g.createDiv({ cls: 'ws-rlist__cat-head is-static' });
			h.createSpan({ cls: 'ws-rlist__cat-label', text: label });
			h.createSpan({ cls: 'ws-rlist__cat-n', text: String(types.length) });
			for (const t of types) {
				const on = t.id === this.typeId;
				const item = g.createEl('button', {
					cls: cx('ws-rlist__item', `ws-tint--${t.color ?? 'gray'}`, on && 'is-active', t.archived && 'is-archived'),
					attr: { type: 'button', 'aria-current': on ? 'true' : 'false' },
				});
				const glyph = item.createSpan({ cls: 'ws-rlist__glyph' });
				setIcon(glyph, t.icon);
				const tx = item.createSpan({ cls: 'ws-rlist__text' });
				tx.createSpan({ cls: 'ws-rlist__name', text: t.plural });
				const nFields = t.fields.filter((f) => !f.hidden).length;
				tx.createSpan({ cls: 'ws-rlist__reads', text: `${nFields} field${nFields === 1 ? '' : 's'} · ${t.sections.length} section${t.sections.length === 1 ? '' : 's'}` });
				const n = s.index.countOfType(t.id);
				if (n) item.createSpan({ cls: 'ws-rlist__n', text: String(n) });
				else if (!t.origin) item.createSpan({ cls: 'ws-rlist__badge', text: 'Custom' });
				item.addEventListener('click', () => this.select(t.id));
			}
		}
	}

	// ── editor ──────────────────────────────────────────────────────────────

	private renderMain(resetScroll = false): void {
		const s = this.ctx.session!;
		const el = this.mainEl;
		const scroller = el.closest('.ws-shell__page');
		const scroll = scroller?.scrollTop ?? 0;
		const activeField = (el.ownerDocument.activeElement as HTMLElement | null)?.closest('.ws-frow-item')?.getAttribute('data-field');
		el.empty();
		const schema = this.typeId ? s.schemas.get(this.typeId) : undefined;
		if (!schema) {
			emptyState(el, { icon: 'shapes', title: 'No types yet', actionLabel: 'Create a type', onAction: () => openNewType(this.ctx.ws, (id) => this.select(id)) });
			return;
		}

		const head = el.createDiv({ cls: cx('ws-studio__type', schema.color && `ws-tint--${schema.color}`) });
		const m = head.createDiv({ cls: 'ws-studio__type-mark' });
		setIcon(m, schema.icon);
		const t = head.createDiv({ cls: 'ws-studio__type-text' });
		t.createDiv({ cls: 'ws-studio__type-name', text: schema.plural });
		const count = s.schemaEdits.countEntities(schema.id);
		t.createDiv({
			cls: 'ws-studio__type-meta',
			text: `${schema.fields.length} fields · ${schema.sections.length} sections · ${count} entr${count === 1 ? 'y' : 'ies'}${schema.origin ? '' : ' · custom type'}${schema.archived ? ' · archived' : ''}`,
		});
		button(head, {
			label: `Open ${schema.plural}`,
			icon: 'arrow-up-right',
			variant: 'quiet',
			size: 'sm',
			onClick: (evt) => this.ctx.navigate(ROUTES.database(schema.id), Keymap.isModEvent(evt)),
		});

		const tabs = el.createDiv({ cls: 'ws-tabs', attr: { role: 'tablist' } });
		for (const tb of TABS) {
			const b = tabs.createEl('button', { cls: cx('ws-tab', tb.id === this.tab && 'is-active'), attr: { type: 'button', role: 'tab', 'aria-selected': String(tb.id === this.tab) } });
			icon(b, tb.icon);
			b.createSpan({ text: tb.label });
			if (tb.id === 'checklist' && schema.defaultTasks.length) b.createSpan({ cls: 'ws-tab__count', text: String(schema.defaultTasks.length) });
			b.addEventListener('click', () => this.select(schema.id, tb.id));
		}
		const panel = el.createDiv({ cls: 'ws-tab-panel', attr: { role: 'tabpanel' } });
		const ws = this.ctx.ws;
		switch (this.tab) {
			case 'fields':
				renderFieldsTab(panel, ws, s, schema, this.focusSection);
				this.focusSection = undefined;
				break;
			case 'display':
				renderDisplayTab(panel, ws, s, schema);
				break;
			case 'checklist':
				renderChecklistTab(panel, s, schema);
				break;
			case 'layout':
				renderLayoutTab(panel, ws, s, schema, (r) => this.ctx.navigate(r));
				break;
			case 'settings':
				renderTypeSettingsTab(panel, ws, s, schema, (r) => {
					if (r.name === 'type-studio') {
						const id = r.params?.typeId ?? s.schemas.list()[0]?.id;
						if (id) this.select(id, r.params?.typeId ? 'fields' : this.tab);
						else this.queueRender();
					} else this.ctx.navigate(r);
				});
				break;
		}
		if (scroller) scroller.scrollTop = resetScroll ? 0 : scroll;
		if (activeField) (el.querySelector(`.ws-frow-item[data-field="${activeField}"]`))?.focus({ preventScroll: true });
	}
}
