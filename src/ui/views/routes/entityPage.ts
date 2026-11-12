import { Keymap, Notice, type Component } from 'obsidian';
import type { BlockDefinition, BlockRenderContext } from '../../../blocks/BlockRegistry';
import type { BlockInstance, EntityRecord, EntitySchema } from '../../../core/types';
import { LayoutEditor, renderWidgetDrawer } from '../../../layouts/editor/LayoutEditor';
import { LayoutService, type EditableScope } from '../../../services/LayoutService';
import { ROUTES } from '../../../state/route';
import { deletePermanently } from '../../actions';
import { BlockSettingsModal } from '../../components/BlockSettingsModal';
import { button, cx, emptyState, icon, nameRegion } from '../../components/dom';
import { own } from '../../components/lifecycle';
import { confirmModal } from '../../components/modals';
import { actionNotice } from '../../components/notice';
import { undoLayoutReset } from '../../layoutUndo';
import { NotePane } from '../../notes/notePane';
import { renderAppearsIn } from '../../writing/appearsIn';
import type { RouteContext, RouteDefinition } from './RouteRegistry';

/** Dispatched on a page to enter Customize mode (from the hero, menus, commands). */
export const CUSTOMIZE_EVENT = 'worldsmith-customize';

type Scope = 'type' | 'entry';
const UNDO_LIMIT = 60;

/**
 * Entity page = the resolved layout (entry → type → default) rendered by the layout
 * editor. Customize mode edits either every page of the type or only this entry, in
 * place, with undo. Blocks patch themselves; the page only redraws for structural
 * changes (type change, trash, layout saved elsewhere).
 */
export const entityRoute: RouteDefinition = {
	id: 'entity',
	needsWorld: true,
	title: (p, s) => s?.entities.get(p.id ?? '')?.name ?? 'Entity',
	icon: (p, s) => {
		const e = s?.entities.get(p.id ?? '');
		return (e && (e.media.icon || s?.schemas.get(e.typeId)?.icon)) || 'file-question';
	},
	render(ctx) {
		new EntityPage(ctx).mount();
	},
};

class EntityPage {
	private readonly s: NonNullable<RouteContext['session']>;
	private readonly id: string;
	private page!: HTMLElement;
	private editor: LayoutEditor | null = null;
	/** null = viewing; otherwise the scope being customized. */
	private scope: Scope | null = null;
	/** Each step remembers which layout it belongs to, so it can never apply elsewhere. */
	private undoStack: Array<{ key: string; blocks: BlockInstance[]; existed: boolean }> = [];
	private selfSave = 0;
	private drawerHost: HTMLElement | null = null;
	private undoBtn: HTMLButtonElement | null = null;
	private resetBtn: HTMLButtonElement | null = null;
	private barEl: HTMLElement | null = null;
	/** Page (the layout) or Note (the entry's main note in Obsidian's editor), 0.18. */
	private view: 'page' | 'note' = 'page';
	private notePane: NotePane | null = null;
	private switchName: HTMLElement | null = null;
	/** The route's params as last set (RouteContext.params isn't updated by replaceParams). */
	private params: Record<string, string>;

	constructor(private readonly ctx: RouteContext) {
		this.s = ctx.session!;
		this.id = ctx.params.id ?? '';
		this.params = { ...ctx.params };
		if (ctx.params.view === 'note') this.view = 'note';
	}

	mount(): void {
		this.page = this.ctx.el.createDiv({ cls: 'ws-page ws-page--entity' });
		const wanted = this.ctx.params.edit;
		if (wanted === 'type' || wanted === 'entry') {
			this.scope = wanted;
			// The request is one-shot: reopening the page later shouldn't land in Customize.
			const { edit: _drop, ...rest } = this.params;
			void _drop;
			this.params = rest;
			this.ctx.replaceParams(rest);
		}
		this.draw();
		this.listen();
	}

	private get entity(): EntityRecord | undefined {
		return this.s.entities.get(this.id);
	}

	private scopeRef(entity: EntityRecord, scope: Scope): EditableScope {
		return scope === 'type' ? { kind: 'type', typeId: entity.typeId } : { kind: 'entity', entityId: entity.id };
	}

	private draw(): void {
		const s = this.s;
		const ctx = this.ctx;
		if (this.editor) {
			ctx.component.removeChild(this.editor);
			this.editor = null;
		}
		if (this.notePane) {
			ctx.component.removeChild(this.notePane);
			this.notePane = null;
		}
		this.switchName = null;
		this.page.empty();
		this.page.removeClass('is-note-view');
		this.drawerHost = null;
		this.undoBtn = null;
		this.resetBtn = null;
		this.barEl = null;
		const entity = this.entity;
		if (!entity) {
			this.scope = null;
			emptyState(this.page, {
				icon: 'file-question',
				title: 'This entry no longer exists',
				body: 'It may have been deleted permanently. Backups in settings can restore it.',
				actionLabel: 'Back to dashboard',
				actionIcon: 'home',
				onAction: () => ctx.navigate(ROUTES.dashboard()),
			});
			return;
		}
		const schema = s.schemas.get(entity.typeId);
		ctx.setTitle(entity.name);
		if (!schema) this.scope = null;
		this.page.toggleClass('is-editing', !!this.scope);

		if (entity.trashedAt) {
			const bar = this.page.createDiv({ cls: 'ws-banner-notice ws-tint--red' });
			icon(bar, 'trash-2');
			bar.createSpan({ text: 'This entry is in the trash.' });
			const actions = bar.createDiv({ cls: 'ws-banner-notice__actions' });
			button(actions, { label: 'Restore', variant: 'ghost', size: 'sm', onClick: () => s.entityService.restore(entity.id) });
			button(actions, { label: 'Delete permanently', variant: 'danger', size: 'sm', onClick: () => void deletePermanently(ctx.ws, entity) });
		}
		if (!schema) {
			const bar = this.page.createDiv({ cls: 'ws-banner-notice ws-tint--orange' });
			icon(bar, 'alert-triangle');
			bar.createSpan({ text: `The type “${entity.typeId}” is missing. Data is preserved; restore the type to edit its fields.` });
		}

		const notePath = entity.linkedNote?.path ?? null;
		if (!notePath && this.view === 'note') {
			// The note was unlinked: back to the page, and don't reopen on Note later.
			this.view = 'page';
			const { view: _old, ...rest } = this.params;
			void _old;
			this.params = rest;
			this.ctx.replaceParams(rest);
		}
		if (!this.scope && notePath) {
			this.drawSwitch(notePath);
			if (this.view === 'note') {
				this.page.addClass('is-note-view');
				const host = this.page.createDiv({ cls: 'ws-entity-note' });
				const pane = new NotePane(ctx.ws, host, { entityId: entity.id, height: 'fill' });
				this.notePane = pane;
				ctx.component.addChild(pane);
				void pane.show(notePath);
				return;
			}
		}

		const makeContext = (instance: BlockInstance, def: BlockDefinition, el: HTMLElement, component: Component, setTitle: (t: string) => void): BlockRenderContext => ({
			ws: ctx.ws,
			app: ctx.ws.app,
			session: s,
			el,
			instance,
			config: { ...def.defaultConfig, ...instance.config },
			component,
			surface: 'entity',
			entity,
			schema,
			navigate: (r, nl) => ctx.navigate(r, nl),
			setTitle,
		});

		const scope = this.scope;
		let blocks: BlockInstance[];
		let host: HTMLElement;
		if (scope && schema) {
			blocks = scope === 'type' ? s.layouts.typeLayout(schema).blocks : s.layouts.forEntity(entity, schema).blocks;
			this.drawEditBar(entity, schema, scope);
			const body = this.page.createDiv({ cls: 'ws-tasks-body ws-entity-edit' });
			host = body.createDiv({ cls: 'ws-entity-edit__layout' });
			this.drawerHost = body.createDiv({ cls: 'ws-tasks-drawer' });
		} else {
			blocks = s.layouts.forEntity(entity, schema).blocks;
			host = this.page.createDiv({ cls: 'ws-entity-view' });
		}

		const editor = new LayoutEditor({
			registry: ctx.ws.blocks,
			surface: 'entity',
			makeContext,
			onChange: (next) => this.saveEdit(next),
			// A settings dialog can outlive this editor (the page redrew while it was open):
			// its save then goes to whichever editor is showing the page now.
			openSettings: (instance, def, save) =>
				new BlockSettingsModal(
					ctx.ws,
					s,
					instance,
					def,
					(next) => {
						if (this.editor === editor) save(next);
						else if (this.editor?.current.find((b) => b.id === instance.id)?.type === instance.type) {
							// Only what the dialog edits — never its stale copy of position or size.
							this.editor.patchBlock(instance.id, { config: next.config, title: next.title });
						}
					},
					schema,
				).open(),
		});
		this.editor = editor;
		ctx.component.addChild(editor);
		editor.mount(host, blocks, !!scope);
		if (scope) {
			this.paintDrawer();
			this.paintButtons();
		} else if (ctx.ws.features.isOn('writing')) renderAppearsIn(this.page, ctx.ws, this.s, entity);
	}

	// ── Customize mode ───────────────────────────────────────────────────────

	/** Page | Note: shown when the entry has a main note (0.18). */
	private drawSwitch(path: string): void {
		const bar = this.page.createDiv({ cls: 'ws-entity-switch' });
		const seg = bar.createDiv({ cls: 'ws-segmented ws-entity-switch__seg', attr: { role: 'tablist' } });
		nameRegion(seg, 'Show the page or the note');
		const tab = (id: 'page' | 'note', label: string, ic: string) => {
			const b = button(seg, { label, icon: ic, variant: 'quiet', size: 'sm', cls: cx('ws-entity-switch__tab', this.view === id && 'is-active').join(' '), onClick: () => this.setView(id) });
			b.setAttr('role', 'tab');
			b.setAttr('aria-selected', String(this.view === id));
			b.dataset.view = id;
		};
		tab('page', 'Page', 'layout-template');
		tab('note', 'Note', 'file-text');
		this.switchName = bar.createDiv({ cls: 'ws-entity-switch__name' });
		this.paintSwitchName(path);
		if (this.view === 'note') {
			button(bar, {
				icon: 'external-link',
				variant: 'quiet',
				size: 'sm',
				tooltip: 'Open the note in a tab',
				cls: 'ws-entity-switch__open',
				onClick: () => {
					const e = this.entity;
					if (e) void this.ctx.ws.linkedNotes.open(e, 'tab');
				},
			});
		}
	}

	private paintSwitchName(path: string): void {
		if (!this.switchName) return;
		this.switchName.empty();
		const missing = this.ctx.ws.linkedNotes.isMissing(path);
		this.switchName.toggleClass('is-missing', missing);
		this.switchName.setText(missing ? `${(path.split('/').pop() ?? path).replace(/\.md$/i, '')} · missing` : path.replace(/\.md$/i, ''));
	}

	private setView(view: 'page' | 'note'): void {
		if (this.view === view) return;
		this.view = view;
		const { view: _old, ...rest } = this.params;
		void _old;
		this.params = view === 'note' ? { ...rest, view: 'note' } : rest;
		this.ctx.replaceParams(this.params);
		this.draw();
	}

	private drawEditBar(entity: EntityRecord, schema: EntitySchema, scope: Scope): void {
		const s = this.s;
		const old = this.barEl;
		const active = this.page.ownerDocument.activeElement;
		const refocus = old && active instanceof HTMLElement && old.contains(active) ? [...active.classList].find((c) => c.startsWith('ws-editbar__')) : undefined;
		const bar = this.page.createDiv({ cls: 'ws-editbar ws-editbar--entity' });
		this.barEl = bar;
		// Refreshing in place keeps the bar where it was (above the layout)…
		if (old?.isConnected) old.replaceWith(bar);
		// …and keyboard focus on the same button.
		if (refocus) window.setTimeout(() => bar.querySelector<HTMLElement>(`.${refocus}:not(:disabled)`)?.focus(), 0);
		icon(bar, 'layout-grid', 'ws-editbar__icon');
		const t = bar.createDiv({ cls: 'ws-editbar__text' });
		const ownLayout = s.layouts.hasOwn(entity.id);
		if (scope === 'type') {
			t.createEl('b', { text: `Customizing every ${schema.singular.toLowerCase()} page. ` });
			t.createSpan({
				text: ownLayout
					? `${entity.name} has a layout of their own, so this page won’t change — switch to “Only ${entity.name}” to edit theirs.`
					: 'Drag to rearrange, drag the right edge to resize, or open a widget’s settings.',
			});
		} else {
			t.createEl('b', { text: `Customizing only ${entity.name}’s page. ` });
			t.createSpan({ text: ownLayout ? `Other ${schema.plural.toLowerCase()} keep the ${schema.plural} layout.` : `${entity.name} uses the ${schema.plural} layout until you change something here.` });
		}

		const seg = bar.createDiv({ cls: 'ws-segmented ws-segmented--labels ws-editbar__scope', attr: { role: 'radiogroup'} });
		nameRegion(seg, 'Apply changes to' );
		for (const [which, label] of [
			['type', `All ${schema.plural}`],
			['entry', `Only ${entity.name}`],
		] as const) {
			const b = seg.createEl('button', {
				cls: cx('ws-segmented__item', scope === which && 'is-active'),
				attr: { type: 'button', role: 'radio', 'aria-checked': String(scope === which), 'data-scope': which },
			});
			b.createSpan({ text: label });
			b.addEventListener('click', () => {
				if (this.scope === which) return;
				this.scope = which;
				this.undoStack = [];
				this.draw();
			});
		}
		this.undoBtn = button(bar, { label: 'Undo', icon: 'undo-2', variant: 'ghost', size: 'sm', cls: 'ws-editbar__undo', onClick: () => this.undo() });
		this.resetBtn = button(bar, {
			label: scope === 'type' ? 'Reset' : `Use ${schema.plural} layout`,
			icon: 'rotate-ccw',
			variant: 'ghost',
			size: 'sm',
			cls: 'ws-editbar__reset',
			onClick: () => void this.resetScope(),
		});
		button(bar, { label: 'Done', icon: 'check', variant: 'primary', size: 'sm', cls: 'ws-editbar__done', onClick: () => this.exitEditing() });
	}

	/** Rebuild only the edit bar (its wording depends on whether the entry has its own layout). */
	private refreshEditBar(): void {
		const e = this.entity;
		const schema = e ? this.s.schemas.get(e.typeId) : undefined;
		if (!e || !schema || !this.scope || !this.barEl) return;
		this.drawEditBar(e, schema, this.scope);
		this.paintButtons();
	}

	private refKey(ref: EditableScope): string {
		return LayoutService.idFor(ref);
	}

	private paintButtons(): void {
		const e = this.entity;
		if (!e || !this.scope) return;
		if (this.undoBtn) this.undoBtn.disabled = this.undoStack.length === 0;
		if (this.resetBtn) this.resetBtn.disabled = !this.s.layouts.get(this.scopeRef(e, this.scope));
	}

	private paintDrawer(): void {
		if (!this.drawerHost || !this.editor) return;
		// Keep the visitor's place: list scroll and whatever they typed in the search box.
		const oldList = this.drawerHost.querySelector('.ws-widget-drawer__list');
		const listScroll = oldList?.scrollTop ?? 0;
		const drawerScroll = this.drawerHost.querySelector('.ws-widget-drawer')?.scrollTop ?? 0;
		const oldSearch = this.drawerHost.querySelector<HTMLInputElement>('.ws-widget-drawer__search');
		const query = oldSearch?.value ?? '';
		const hadFocus = !!oldSearch && oldSearch === this.drawerHost.ownerDocument.activeElement;
		this.drawerHost.empty();
		const drawer = renderWidgetDrawer(this.drawerHost, this.ctx.ws.blocks, 'entity', this.editor.current, (type) => this.editor?.add(type), query);
		drawer.scrollTop = drawerScroll;
		const list = drawer.querySelector('.ws-widget-drawer__list');
		if (list) list.scrollTop = listScroll;
		if (hadFocus) drawer.querySelector<HTMLInputElement>('.ws-widget-drawer__search')?.focus();
	}

	private saveEdit(next: BlockInstance[]): void {
		const e = this.entity;
		if (!e || !this.scope) return;
		const ref = this.scopeRef(e, this.scope);
		const prev = this.s.layouts.get(ref);
		const before = prev?.blocks ?? (this.scope === 'type' ? this.s.layouts.typeLayout(this.s.schemas.get(e.typeId)!).blocks : this.s.layouts.forEntity(e, this.s.schemas.get(e.typeId)).blocks);
		this.undoStack.push({ key: this.refKey(ref), blocks: JSON.parse(JSON.stringify(before)) as BlockInstance[], existed: !!prev });
		if (this.undoStack.length > UNDO_LIMIT) this.undoStack.shift();
		this.selfSave++;
		try {
			this.s.layouts.save(ref, next);
		} finally {
			this.selfSave--;
		}
		// Never redraw the page here — the editor that called us is still mid-commit.
		if (!next.length) {
			// An empty layout isn't kept; the page falls back a level. Show that right away
			// (after the editor finishes this commit), with Undo one click away.
			const schema = this.s.schemas.get(e.typeId);
			const scope = this.scope;
			window.setTimeout(() => {
				const cur = this.entity;
				if (!cur || !schema || this.scope !== scope) return;
				this.editor?.replace(scope === 'type' ? this.s.layouts.typeLayout(schema).blocks : this.s.layouts.forEntity(cur, schema).blocks);
				this.refreshEditBar();
				this.paintDrawer();
			}, 0);
			new Notice(scope === 'type' ? `An empty page isn’t kept — ${schema?.plural ?? 'these'} pages go back to the default layout. Undo brings your widgets back.` : `An empty page isn’t kept — ${e.name} goes back to the ${schema?.plural ?? 'type'} layout. Undo brings your widgets back.`);
		} else if (this.scope === 'entry' && !prev) this.refreshEditBar(); // first own-layout change: the bar says so
		this.paintDrawer();
		this.paintButtons();
	}

	private undo(): void {
		const e = this.entity;
		const step = this.undoStack.pop();
		if (!e || !this.scope || !step) return;
		const ref = this.scopeRef(e, this.scope);
		const ownBefore = this.s.layouts.hasOwn(e.id);
		if (step.key !== this.refKey(ref)) {
			// The page now shows a different layout (type changed, etc.): old steps don't apply.
			this.undoStack = [];
			this.paintButtons();
			return;
		}
		this.selfSave++;
		try {
			if (step.existed) this.s.layouts.save(ref, step.blocks);
			else this.s.layouts.reset(ref);
		} finally {
			this.selfSave--;
		}
		this.editor?.replace(step.blocks);
		// The bar's wording depends on whether the entry has its own layout.
		if (this.s.layouts.hasOwn(e.id) !== ownBefore) this.refreshEditBar();
		this.paintDrawer();
		this.paintButtons();
	}

	private async resetScope(): Promise<void> {
		const e = this.entity;
		const schema = e ? this.s.schemas.get(e.typeId) : undefined;
		if (!e || !schema || !this.scope) return;
		const ref = this.scopeRef(e, this.scope);
		if (!this.s.layouts.get(ref)) return;
		if (this.scope === 'type') {
			const ok = await confirmModal(this.ctx.ws.app, {
				title: `Reset the ${schema.singular} layout?`,
				body: `Every ${schema.singular.toLowerCase()} page goes back to Worldsmith’s default layout. Entries with a layout of their own keep it. Your entries’ content isn’t affected.`,
				confirmLabel: 'Reset layout',
			});
			if (!ok) return;
		}
		const what = this.scope === 'type' ? `The ${schema.singular} layout` : `${e.name}’s page`;
		const removed = this.s.layouts.reset(ref);
		this.undoStack = [];
		this.draw();
		if (removed) {
			actionNotice(this.scope === 'type' ? `The ${schema.singular} layout is back to the default.` : `${e.name} now uses the ${schema.plural} layout.`, {
				label: 'Undo',
				run: () => undoLayoutReset(this.s, removed, what),
			});
		}
	}

	private exitEditing(): void {
		this.scope = null;
		this.undoStack = [];
		this.draw();
	}

	/** Enter Customize: "only this entry" if it already has its own layout. */
	private enterEditing(scope?: Scope): void {
		const e = this.entity;
		if (!e || !this.s.schemas.get(e.typeId)) {
			new Notice('This entry’s type is missing, so its page can’t be customized.');
			return;
		}
		this.scope = scope ?? (this.s.layouts.hasOwn(e.id) ? 'entry' : 'type');
		this.undoStack = [];
		if (this.view === 'note') this.setView('page');
		else this.draw();
	}

	// ── events ───────────────────────────────────────────────────────────────

	private listen(): void {
		const s = this.s;
		const c = this.ctx.component;
		own(
			c,
			s.events.on('entity:updated', ({ entity, change }) => {
				if (entity.id !== this.id) return;
				if (change.keys.includes('typeId')) {
					this.undoStack = [];
					this.draw();
				} else if (change.keys.includes('trashedAt')) this.draw();
				else if (change.keys.includes('linkedNote')) {
					// A rename or relink: the open editor follows; gaining or losing a note redraws.
					const p = entity.linkedNote?.path ?? null;
					if (p && this.switchName && !this.scope) {
						this.paintSwitchName(p);
						void this.notePane?.show(p);
					} else if (!this.scope) this.draw();
				}
				if (change.keys.includes('name') && !change.keys.includes('typeId') && !change.keys.includes('trashedAt')) {
					this.ctx.setTitle(entity.name);
					if (this.scope) this.draw();
				}
			}),
		);
		own(c, s.events.on('entity:deleted', ({ entity }) => entity.id === this.id && this.draw()));
		// The main note disappearing or coming back (deleted, restored, synced).
		const noteCame = (path: string) => {
			const p = this.entity?.linkedNote?.path;
			if (!p || p !== path || this.scope) return;
			this.paintSwitchName(p);
			void this.notePane?.show(p);
		};
		const vault = this.ctx.ws.app.vault;
		c.registerEvent(vault.on('create', (f) => noteCame(f.path)));
		c.registerEvent(vault.on('delete', (f) => noteCame(f.path)));
		own(
			c,
			s.events.on('schema:updated', ({ schema }) => {
				if (schema.id === this.entity?.typeId) this.draw();
			}),
		);
		// A layout changed elsewhere (another pane, Type Studio, sync): show it.
		const touches = (scope: { kind: string; typeId?: string; entityId?: string }) => {
			const e = this.entity;
			return !!e && ((scope.kind === 'type' && scope.typeId === e.typeId) || (scope.kind === 'entity' && scope.entityId === e.id));
		};
		for (const ev of ['layout:saved', 'layout:deleted'] as const) {
			own(
				c,
				s.events.on(ev, ({ layout }) => {
					if (this.selfSave || !touches(layout.scope)) return;
					// Someone else changed this layout: our undo history no longer describes it.
					this.undoStack = [];
					this.draw();
				}),
			);
		}
		const onCustomize = (evt: Event) => this.enterEditing((evt as CustomEvent<{ scope?: Scope }>).detail?.scope);
		this.page.addEventListener(CUSTOMIZE_EVENT, onCustomize);
		c.register(() => this.page.removeEventListener(CUSTOMIZE_EVENT, onCustomize));

		// While customizing: Cmd/Ctrl+Z undoes, Escape finishes (when not typing or in a dialog).
		const onKey = (e: KeyboardEvent) => {
			if (!this.scope || !this.page.isConnected) return;
			// Only the page you're looking at: not a background tab, not another pane.
			if (!this.page.getClientRects().length) return;
			const leaf = this.page.closest('.workspace-leaf');
			if (leaf && !leaf.classList.contains('mod-active')) return;
			const t = e.target as HTMLElement;
			const view = leaf ?? this.page;
			if (t !== t.ownerDocument.body && !view.contains(t)) return;
			if (t.closest('input, textarea, select, [contenteditable="true"], .modal-container')) return;
			if (this.page.ownerDocument.querySelector('.modal-container, .menu')) return;
			if ((e.key === 'z' || e.key === 'Z') && Keymap.isModEvent(e) && !e.shiftKey) {
				e.preventDefault();
				this.undo();
			} else if (e.key === 'Escape') {
				e.preventDefault();
				this.exitEditing();
			}
		};
		this.page.ownerDocument.addEventListener('keydown', onKey);
		c.register(() => this.page.ownerDocument.removeEventListener('keydown', onKey));
	}
}

/** Ask the entity page containing `el` to enter Customize mode. */
export function customizePage(el: HTMLElement, scope?: Scope): void {
	el.closest('.ws-page--entity')?.dispatchEvent(new CustomEvent(CUSTOMIZE_EVENT, { detail: { scope } }));
}
