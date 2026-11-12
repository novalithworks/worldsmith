import { Menu } from 'obsidian';
import type { EntityRecord, GraphDoc } from '../../../core/types';
import { plainText } from '../../../core/util/strings';
import { hydrateGraph } from '../../../data/migrations/records';
import { allTags } from '../../../services/entryQuery';
import { graphData, kindColor, type GraphData } from '../../../services/graph';
import type { WorldSession } from '../../../services/WorldSession';
import { ROUTES } from '../../../state/route';
import { entityMenu } from '../../actions';
import { avatar } from '../../components/avatar';
import { button, cx, emptyState, icon } from '../../components/dom';
import { EntityPicker } from '../../components/EntityPicker';
import { own } from '../../components/lifecycle';
import { confirmModal, promptModal } from '../../components/modals';
import { actionNotice } from '../../components/notice';
import { Popover } from '../../components/popover';
import { graphThumb, renderGraph, type GraphCanvas } from '../../graph/render';
import { aboutSection, BACKGROUND_OPTIONS, canvasHud, docCard, fullView, panelSection, segmentedRow, startCard, stepperRow, toggleRow, visualHeader, visualHome, type DocActions, type FullView } from '../../visual/common';
import { hoverPeek, type Peek } from '../../visual/peek';
import type { RouteContext, RouteDefinition } from './RouteRegistry';
import { mountToolBanner } from '../../media/pageBanner';

/**
 * The relationship graph (0.11): every entry as a dot, every connection as a line, laid
 * out so close-knit groups sit together. Filter by type, kind and tag, centre on one
 * entry, drag dots about (and pin them, if you like), and save as many views as you
 * like. The home page lists the views; a graph opens as the whole page (0.12).
 */
export const graphRoute: RouteDefinition = {
	id: 'graph',
	needsWorld: true,
	title: (p, s) => s?.graphs.get(p.id)?.name ?? 'Graph',
	icon: () => 'share-2',
	render(ctx) {
		new GraphPage(ctx).mount();
	},
};

const DRAFT_ID = '__draft';

const SPACING: Array<{ id: string; label: string; v: number }> = [
	{ id: 'snug', label: 'Snug', v: 0.6 },
	{ id: 'normal', label: 'Normal', v: 1 },
	{ id: 'roomy', label: 'Roomy', v: 1.4 },
	{ id: 'airy', label: 'Airy', v: 2 },
];

class GraphPage {
	private id: string | null;
	/** Until the first change there's nothing to save: a "Whole world" view on the fly. */
	private draft: GraphDoc;
	/** The home page (0.12): start cards and saved views, no graph. */
	private home: boolean;
	private pageEl!: HTMLElement;
	private headEl!: HTMLElement;
	private bodyEl!: HTMLElement;
	private frame: FullView | null = null;
	private peek: Peek | null = null;
	private canvas: GraphCanvas | null = null;
	private data: GraphData | null = null;
	private known = new Map<string, [number, number]>();
	private view: { k: number; x: number; y: number } | null = null;
	private viewOf = '';
	private selected: string | null = null;
	private queued = false;
	private panel: Popover | null = null;
	private typesPop: Popover | null = null;
	private typesBtn: HTMLButtonElement | null = null;
	private headSig = '';
	/** Counts opens, so each one gets a fresh frame. */
	private opened = 0;
	private unpinBtn: HTMLButtonElement | null = null;

	/** Set once the page is left: a late timer must not draw into the next page. */
	private dead = false;

	constructor(private readonly ctx: RouteContext) {
		own(ctx.component, { dispose: () => (this.dead = true) });
		const s = ctx.session!;
		this.id = s.graphs.get(ctx.params.id)?.id ?? null;
		this.draft = this.wholeWorld();
		this.home = !this.id;
		const focus = ctx.params.focus ? s.entities.get(ctx.params.focus) : undefined;
		if (focus && !focus.trashedAt) {
			// Opened from an entry ("See connections"): a look around it, not saved unless changed.
			this.id = null;
			this.home = false;
			this.draft = this.around(focus);
			this.selected = focus.id;
		}
	}

	private wholeWorld(): GraphDoc {
		return hydrateGraph({ id: DRAFT_ID, name: 'Whole world', icon: 'share-2' })!.record;
	}

	private around(e: EntityRecord): GraphDoc {
		return { ...this.wholeWorld(), name: `Around ${e.name}`, focusId: e.id, hideIsolated: false };
	}

	private get s(): WorldSession {
		return this.ctx.session!;
	}

	private get doc(): GraphDoc {
		return (this.id ? this.s.graphs.get(this.id) : undefined) ?? this.draft;
	}

	private get saved(): boolean {
		return !!this.id && this.s.graphs.has(this.id);
	}

	mount(): void {
		this.pageEl = this.ctx.el.createDiv({ cls: 'ws-page ws-vis ws-graph-page' });
		this.headEl = this.pageEl.createDiv();
		this.bodyEl = this.pageEl.createDiv({ cls: 'ws-vis__body' });
		this.render();
		const later = () => this.queue();
		const ev = this.s.events;
		const c = this.ctx.component;
		own(c, ev.on('entity:created', later));
		own(c, ev.on('entity:deleted', later));
		own(c, ev.on('entity:updated', ({ change }) => change.keys.some((k) => ['name', 'trashedAt', 'archivedAt', 'parentId', 'status', 'media', 'tags', 'typeId'].includes(k)) && later()));
		for (const e of ['edge:created', 'edge:deleted', 'edge:updated', 'schema:updated', 'relationType:created', 'relationType:deleted', 'relationType:updated'] as const) own(c, ev.on(e, later));
		own(c, ev.on('doc:saved', ({ kind }) => kind === 'graph' && !this.saving && later()));
		own(c, ev.on('doc:deleted', ({ kind, id }) => {
			if (kind !== 'graph') return;
			if (id === this.id) {
				this.id = null;
				this.home = true;
			}
			later();
		}));
		own(c, { dispose: () => { this.canvas?.destroy(); this.panel?.close(); this.typesPop?.close(); this.peek?.destroy(); } });
	}

	/** Our own saves redraw directly (or not at all, after a drag). */
	private saving = false;

	private queue(): void {
		if (this.queued) return;
		this.queued = true;
		window.setTimeout(() => {
			this.queued = false;
			if (!this.dead && this.ctx.el.isConnected) this.render();
		}, 60);
	}

	/** Change the view; the first change of a draft saves it as a view of its own. */
	private update(patch: Partial<GraphDoc>, opts: { quiet?: boolean } = {}): void {
		this.saving = true;
		if (!this.saved) {
			const { id: _id, createdAt: _c, updatedAt: _u, rev: _r, ...rest } = this.draft;
			const around = patch.focusId ? this.s.entities.get(patch.focusId)?.name : undefined;
			const doc = this.s.graphs.create({ ...rest, ...patch, name: patch.name ?? (around ? `Around ${around}` : this.draft.name) });
			this.id = doc.id;
			this.ctx.replaceParams({ id: doc.id });
		} else this.s.graphs.update(this.id!, patch);
		this.saving = false;
		if (!opts.quiet) this.render();
		if (this.panel && !opts.quiet) this.fillPanel(this.panel.el);
		if (this.typesPop && !opts.quiet) this.fillTypes(this.typesPop.el);
	}

	/** Open a saved view, a fresh draft (`draft`), or the home page (null). */
	private open(id: string | null, draft?: GraphDoc): void {
		this.opened++;
		this.id = id;
		this.home = !id && !draft;
		if (draft) this.draft = draft;
		this.view = null;
		this.known.clear();
		this.selected = draft?.focusId ?? null;
		this.ctx.replaceParams(id ? { id } : {});
		this.render();
	}

	private render(): void {
		const home = this.home;
		const doc = this.doc;
		// The frame is rebuilt when another view is opened, not when a draft gets saved.
		const sig = JSON.stringify(home ? ['home'] : [this.opened, doc.icon]);
		this.pageEl.toggleClass('ws-page--full', !home);
		if (sig !== this.headSig) {
			this.headSig = sig;
			this.panel?.close();
			this.typesPop?.close();
			this.peek?.destroy();
			this.peek = null;
			this.headEl.empty();
			this.bodyEl.empty();
			this.frame = null;
			if (home) this.renderHead();
			else this.renderFrame(doc);
		} else if (!home) this.frame?.setName(doc.name);
		if (this.canvas) {
			this.known = this.canvas.positions();
			this.canvas.destroy();
			this.canvas = null;
		}
		if (home || !this.frame) {
			this.ctx.setTitle('Graph');
			this.bodyEl.empty();
			return this.renderHome();
		}
		this.ctx.setTitle(doc.name);
		this.data = graphData(this.s, doc);
		this.renderBar(doc, this.data);
		this.peek?.hide();
		this.frame.host.empty();
		this.renderCanvas(doc, this.data, this.frame.host);
	}

	// ── Home ─────────────────────────────────────────────────────────────────────

	private renderHead(): void {
		const { head, actions } = visualHeader(this.headEl, {
			icon: 'share-2',
			tint: 'purple',
			title: 'Graph',
			desc: 'Who knows whom, and how: every entry as a dot, every connection as a line.',
		});
		button(actions, { label: 'Relationships', icon: 'git-merge', variant: 'ghost', onClick: () => this.ctx.navigate(ROUTES.relationships()) });
		mountToolBanner(this.ctx, head, 'graph');
	}

	private renderHome(): void {
		const views = this.s.graphs.list();
		const { starts, grid } = visualHome(this.bodyEl, { title: 'Saved views', count: views.length, noun: 'view', empty: 'Change a graph (a filter, a centre, a look) and it’s kept here as a view. Right-click one to rename, copy or delete it.' });
		const edges = this.s.relations.allEdges().length;
		startCard(starts, {
			icon: 'share-2',
			tint: 'purple',
			title: 'The whole world',
			body: `Every connected entry at once, settled so close-knit groups sit together. ${edges ? `${edges} ${edges === 1 ? 'connection' : 'connections'} so far.` : 'Add connections on entry pages and they appear here.'}`,
			cta: 'Open the graph',
			attr: { 'data-start': 'world' },
			onClick: () => this.open(null, this.wholeWorld()),
		});
		startCard(starts, {
			icon: 'crosshair',
			tint: 'blue',
			title: 'Around one entry',
			body: 'Pick someone, somewhere or something and see everything joined to it, one, two or more steps out.',
			cta: 'Choose an entry',
			attr: { 'data-start': 'around' },
			onClick: (e) =>
				new EntityPicker(e.currentTarget as HTMLElement, {
					session: this.s,
					app: this.ctx.ws.app,
					createTypes: [],
					placeholder: 'Centre on whom? Search…',
					onPick: (x) => this.open(null, this.around(x)),
				}),
		});
		if (!grid) return;
		for (const v of views) {
			const data = graphData(this.s, v);
			const focus = v.focusId ? this.s.entities.get(v.focusId) : undefined;
			const filters = v.types.length + v.kinds.length + v.tags.length;
			docCard(grid, {
				id: v.id,
				name: v.name,
				meta: [focus ? `Around ${focus.name}` : 'Whole world', `${data.nodes.length} entries`, `${data.edges.length} connections`, filters ? `${filters} ${filters === 1 ? 'filter' : 'filters'}` : null].filter(Boolean).join(' · '),
				icon: v.icon || 'share-2',
				tint: 'purple',
				cls: 'ws-graph-doc',
				picture: (frame) => graphThumb(frame, this.s, v, data),
				actions: this.actionsFor(v, false),
			});
		}
	}

	private actionsFor(g: GraphDoc, inside: boolean): DocActions {
		const saved = this.s.graphs.has(g.id);
		return {
			noun: 'view',
			onOpen: inside ? undefined : () => this.open(g.id),
			onRename: () => {
				if (inside) {
					const input = this.bodyEl.querySelector<HTMLInputElement>('.ws-vis-full__name');
					if (input) return void (input.focus(), input.select());
				}
				void promptModal(this.ctx.ws.app, { title: 'Rename view', label: 'Name', value: g.name, confirmLabel: 'Rename' }).then((v) => {
					const name = v?.trim();
					if (!name || name === g.name) return;
					if (this.id === g.id || (inside && !saved)) this.update({ name });
					else this.s.graphs.update(g.id, { name });
				});
			},
			onDuplicate: saved
				? () => {
						const copy = this.s.graphs.duplicate(g.id);
						if (copy && inside) this.open(copy.id);
					}
				: undefined,
			onDelete: saved ? () => void this.remove(g.id) : undefined,
			extra: inside
				? (menu) => {
						const others = this.s.graphs.list().filter((d) => d.id !== g.id);
						if (!others.length) return;
						menu.addSeparator();
						for (const d of others.slice(0, 12)) menu.addItem((i) => i.setTitle(`Open ${d.name}`).setIcon(d.icon || 'share-2').onClick(() => this.open(d.id)));
					}
				: undefined,
		};
	}

	private async remove(id = this.id): Promise<void> {
		const doc = id ? this.s.graphs.get(id) : undefined;
		if (!doc) return;
		const ok = await confirmModal(this.ctx.ws.app, { title: `Delete “${doc.name}”?`, body: 'Only this view goes: every entry and connection stays as it is. You can undo this.', confirmLabel: 'Delete view', danger: true });
		if (!ok) return;
		// Removing clears this.id (the deleted event runs first), so ask before.
		const wasOpen = doc.id === this.id;
		const gone = this.s.graphs.remove(doc.id);
		if (gone)
			actionNotice(`Deleted “${gone.name}”.`, {
				label: 'Undo',
				run: () => {
					this.s.graphs.restore(gone);
					if (!this.dead) this.open(gone.id);
				},
			});
		if (wasOpen) this.open(null);
		else this.render();
	}

	// ── Frame and filter bar ─────────────────────────────────────────────────────

	private renderFrame(doc: GraphDoc): void {
		this.frame = fullView(this.bodyEl, {
			icon: doc.icon || 'share-2',
			tint: 'purple',
			title: doc.name,
			home: 'Graph',
			label: (name) => `${name}, a relationship graph`,
			onHome: () => this.open(null),
			onRename: (name) => this.update({ name }),
			menu: () => this.actionsFor(this.doc, true),
		});
		const a = this.frame.actions;
		const cust = button(a, { label: 'Customize', icon: 'sliders-horizontal', variant: 'ghost', size: 'sm', cls: 'ws-vis-customize', onClick: () => this.togglePanel(cust) });
		this.typesBtn = null;
		this.peek = hoverPeek(this.frame.host, this.ctx.ws, this.s, '.ws-graph__node[data-entity]', (el) => {
			const e = this.s.entities.get(el.getAttribute('data-entity') ?? '');
			return e ? { entity: e } : null;
		});
	}

	private renderBar(doc: GraphDoc, data: GraphData): void {
		const bar = this.frame?.sub;
		if (!bar) return;
		// The Types button stays put (its list may be open); everything else is redrawn.
		for (const el of [...bar.children]) if (el !== this.typesBtn) el.remove();
		bar.addClass('ws-graph-bar');
		const S = this.s;
		const focus = doc.focusId ? S.entities.get(doc.focusId) : undefined;
		const lead = bar.createDiv({ cls: 'ws-graph-bar__lead' });
		bar.prepend(lead);
		// Centre on someone.
		if (focus && !focus.trashedAt) {
			const chip = lead.createDiv({ cls: 'ws-graph-bar__focus' });
			avatar(chip, this.ctx.ws.app, focus, S.schemas.get(focus.typeId), { size: 'xs' });
			chip.createSpan({ cls: 'ws-graph-bar__focus-name', text: `Around ${focus.name}` });
			const x = chip.createEl('button', { cls: 'ws-graph-bar__focus-x', attr: { type: 'button', 'aria-label': 'Show everything' } });
			icon(x, 'x');
			x.addEventListener('click', () => this.update({ focusId: null }));
			const steps = lead.createDiv({ cls: 'ws-graph-bar__depth' });
			steps.createSpan({ cls: 'ws-graph-bar__label', text: 'Steps' });
			const box = steps.createDiv({ cls: 'ws-stepper', attr: { role: 'group', 'aria-label': 'Steps away' } });
			button(box, { icon: 'minus', variant: 'quiet', size: 'sm', tooltip: 'Closer', disabled: doc.depth <= 1, cls: 'ws-stepper__down', onClick: () => this.update({ depth: Math.max(1, doc.depth - 1) }) });
			box.createSpan({ cls: 'ws-stepper__value', text: String(doc.depth) });
			button(box, { icon: 'plus', variant: 'quiet', size: 'sm', tooltip: 'Further out', disabled: doc.depth >= 4, cls: 'ws-stepper__up', onClick: () => this.update({ depth: Math.min(4, doc.depth + 1) }) });
		} else {
			button(lead, {
				label: 'Centre on…',
				icon: 'crosshair',
				variant: 'ghost',
				size: 'sm',
				cls: 'ws-graph-bar__centre',
				onClick: (evt) => this.pickFocus(evt.currentTarget as HTMLElement),
			});
		}

		// Types: one dropdown with a tick per type, so the bar never fills up.
		const present = this.presentTypes();
		const hidden = doc.types.length ? present.filter((t) => !doc.types.includes(t.id)).length : 0;
		const label = hidden ? `Types: ${present.length - hidden} of ${present.length}` : 'All types';
		if (!this.typesBtn || !this.typesBtn.isConnected) {
			this.typesBtn = button(bar, { label, icon: 'shapes', variant: 'ghost', size: 'sm', cls: 'ws-graph-bar__types', onClick: () => this.toggleTypes() });
			this.typesBtn.setAttr('aria-haspopup', 'dialog');
		} else this.typesBtn.querySelector('.ws-btn__label')?.setText(label);
		lead.after(this.typesBtn);
		this.typesBtn.toggleClass('ws-btn--default', !!hidden);
		this.typesBtn.toggleClass('ws-btn--ghost', !hidden);

		button(bar, {
			label: doc.kinds.length ? `Kinds (${doc.kinds.length})` : 'All kinds',
			icon: 'git-merge',
			variant: doc.kinds.length ? 'default' : 'ghost',
			size: 'sm',
			cls: 'ws-graph-bar__kinds',
			onClick: (evt) => this.kindsMenu(evt),
		});
		const tags = allTags(S);
		if (tags.length) {
			button(bar, {
				label: doc.tags.length ? `Tags (${doc.tags.length})` : 'Any tag',
				icon: 'tag',
				variant: doc.tags.length ? 'default' : 'ghost',
				size: 'sm',
				cls: 'ws-graph-bar__tags',
				onClick: (evt) => {
					const m = new Menu();
					if (doc.tags.length) m.addItem((i) => i.setTitle('Any tag').setIcon('rotate-ccw').onClick(() => this.update({ tags: [] })));
					for (const tag of tags.slice(0, 60)) {
						const on = doc.tags.some((x) => x.toLowerCase() === tag.toLowerCase());
						m.addItem((i) => i.setTitle(`#${tag}`).setChecked(on).onClick(() => this.update({ tags: on ? doc.tags.filter((x) => x.toLowerCase() !== tag.toLowerCase()) : [...doc.tags, tag] })));
					}
					m.showAtMouseEvent(evt);
				},
			});
		}
		if (doc.types.length || doc.kinds.length || doc.tags.length) {
			button(bar, { label: 'Clear', icon: 'filter-x', variant: 'quiet', size: 'sm', cls: 'ws-graph-bar__clear', onClick: () => this.update({ types: [], kinds: [], tags: [] }) });
		}
	}

	private presentTypes() {
		const S = this.s;
		return S.schemas.list().filter((t) => [...S.entities.values()].some((e) => e.typeId === t.id && !e.trashedAt));
	}

	private toggleTypes(): void {
		if (this.typesPop) return this.typesPop.close();
		if (!this.typesBtn) return;
		const pop = new Popover(this.typesBtn, { cls: 'ws-vis-panel ws-graph-types', width: 280, label: 'Types to show', onClose: () => { if (this.typesPop === pop) this.typesPop = null; } });
		if (!pop.isOpen) return;
		this.typesPop = pop;
		this.fillTypes(pop.el);
	}

	/** The Types list: a tick per type (Alt/⌥-click or "Only" for just that one). */
	private fillTypes(el: HTMLElement): void {
		el.querySelectorAll(':scope > :not(.ws-sr-only)').forEach((x) => x.remove());
		const doc = this.doc;
		const present = this.presentTypes();
		const all = present.map((x) => x.id);
		const counts = new Map<string, number>();
		for (const e of this.s.entities.values()) if (!e.trashedAt) counts.set(e.typeId, (counts.get(e.typeId) ?? 0) + 1);
		const sec = panelSection(el, 'Show these types', 'shapes');
		const list = sec.createDiv({ cls: 'ws-graph-types__list', attr: { role: 'group', 'aria-label': 'Types' } });
		const set = (types: string[]) => this.update({ types: types.length === all.length || !types.length ? [] : types });
		for (const t of present) {
			const on = !doc.types.length || doc.types.includes(t.id);
			const row = list.createDiv({ cls: cx('ws-graph-type', `ws-tint--${t.color ?? 'gray'}`, on && 'is-on'), attr: { 'data-type': t.id } });
			const b = row.createEl('button', { cls: 'ws-graph-type__toggle', attr: { type: 'button', role: 'checkbox', 'aria-checked': String(on), title: on ? `Hide ${t.plural.toLowerCase()}` : `Show ${t.plural.toLowerCase()}` } });
			icon(b.createSpan({ cls: 'ws-graph-type__check' }), on ? 'check' : 'minus');
			icon(b.createSpan({ cls: 'ws-graph-type__icon' }), t.icon);
			b.createSpan({ cls: 'ws-graph-type__name', text: t.plural });
			b.createSpan({ cls: 'ws-graph-type__n', text: String(counts.get(t.id) ?? 0) });
			b.addEventListener('click', (evt) => {
				if (evt.altKey) return set([t.id]);
				const cur = doc.types.length ? doc.types : all;
				set(on ? cur.filter((x) => x !== t.id) : [...cur, t.id]);
			});
			const only = row.createEl('button', { cls: 'ws-graph-type__only', text: 'Only', attr: { type: 'button', 'aria-label': `Only ${t.plural.toLowerCase()}` } });
			only.addEventListener('click', () => set([t.id]));
		}
		const line = sec.createDiv({ cls: 'ws-vis-panel__line' });
		button(line, { label: 'Show all', icon: 'eye', variant: 'ghost', size: 'sm', disabled: !doc.types.length, cls: 'ws-graph-types__all', onClick: () => set([]) });
	}
	private pickFocus(anchor: HTMLElement): void {
		new EntityPicker(anchor, {
			session: this.s,
			app: this.ctx.ws.app,
			createTypes: [],
			placeholder: 'Centre on whom? Search…',
			onPick: (e) => {
				this.selected = e.id;
				this.update({ focusId: e.id });
			},
		});
	}

	private kindsMenu(evt: MouseEvent): void {
		const doc = this.doc;
		const m = new Menu();
		const used = new Map<string, number>();
		for (const e of this.s.relations.allEdges()) used.set(e.type, (used.get(e.type) ?? 0) + 1);
		if (doc.kinds.length) m.addItem((i) => i.setTitle('Every kind').setIcon('rotate-ccw').onClick(() => this.update({ kinds: [] })));
		const groups = new Map<string, typeof kinds>();
		const kinds = this.s.relations.types().filter((k) => used.has(k.id));
		for (const k of kinds) groups.set(k.category, [...(groups.get(k.category) ?? []), k]);
		for (const [cat, list] of groups) {
			m.addSeparator();
			m.addItem((i) => i.setTitle(cat).setIsLabel(true));
			for (const k of list) {
				const on = !doc.kinds.length || doc.kinds.includes(k.id);
				m.addItem((i) =>
					i
						.setTitle(`${k.label} (${used.get(k.id)})`)
						.setIcon(k.icon ?? 'link')
						.setChecked(on)
						.onClick(() => {
							const all = kinds.map((x) => x.id);
							const cur = doc.kinds.length ? doc.kinds : all;
							const next = on ? cur.filter((x) => x !== k.id) : [...cur, k.id];
							this.update({ kinds: next.length === all.length || !next.length ? [] : next });
						}),
				);
			}
		}
		if (!kinds.length) m.addItem((i) => i.setTitle('No connections yet').setDisabled(true));
		m.showAtMouseEvent(evt);
	}

	// ── The graph ────────────────────────────────────────────────────────────────

	private renderCanvas(doc: GraphDoc, data: GraphData, host: HTMLElement): void {

		host.setAttr('data-count', String(data.nodes.length));
		host.setAttr('data-edges', String(data.edges.length));
		if (!data.nodes.length) {
			const anyEdges = this.s.relations.allEdges().length > 0;
			const filtered = doc.types.length || doc.kinds.length || doc.tags.length;
			if (filtered) {
				emptyState(host, { icon: 'filter-x', title: 'Nothing matches these filters', body: 'Try showing more types or kinds of connection.', actionLabel: 'Clear filters', actionIcon: 'filter-x', onAction: () => this.update({ types: [], kinds: [], tags: [] }) });
			} else if (!anyEdges) {
				emptyState(host, {
					icon: 'share-2',
					title: 'No connections yet',
					body: 'Link entries to each other (a mentor, a rival, a sworn oath) and they appear here as a web you can explore.',
					actionLabel: 'Open Relationships',
					actionIcon: 'git-merge',
					onAction: () => this.ctx.navigate(ROUTES.relationships()),
				});
			} else {
				emptyState(host, { icon: 'eye-off', title: 'Everything is hidden', body: 'Entries without connections are hidden. Show them in Customize.', actionLabel: 'Show unconnected entries', actionIcon: 'eye', onAction: () => this.update({ hideIsolated: false }) });
			}
			return;
		}
		const key = `${doc.id}:${doc.focusId}:${doc.depth}:${doc.types.join()}:${doc.kinds.join()}:${doc.tags.join()}:${doc.hideIsolated}:${doc.showParents}:${doc.spacing}`;
		if (key !== this.viewOf) this.view = null;
		this.viewOf = key;
		if (this.selected && !data.nodes.some((n) => n.id === this.selected)) this.selected = null;
		this.canvas = renderGraph(host, this.ctx.ws.app, this.s, doc, data, {
			known: this.known,
			selected: this.selected,
			focusId: doc.focusId,
			keep: this.view,
			onView: (v) => (this.view = v),
			onSelect: (id) => {
				this.selected = id;
				this.renderSpot(host);
			},
			onOpen: (id, evt) => this.ctx.navigate(ROUTES.entity(id), evt.metaKey || evt.ctrlKey ? 'tab' : false),
			onPin: (id, x, y) => {
				this.known = this.canvas?.positions() ?? this.known;
				this.update({ pinned: { ...this.doc.pinned, [id]: [x, y] } }, { quiet: true });
				this.unpinBtn?.removeClass('is-hidden');
				this.renderSpot(host);
			},
			onMenu: (id, evt) => this.nodeMenu(id, evt),
		});
		const pinnedHere = Object.keys(doc.pinned).filter((id) => data.nodes.some((n) => n.id === id)).length;
		canvasHud(host, () => this.canvas?.pz ?? null, () => this.canvas?.fit(true), (hud) => {
			button(hud, { icon: 'shuffle', variant: 'quiet', size: 'sm', tooltip: 'Let everything settle again', cls: 'ws-graph__reheat', onClick: () => this.canvas?.reheat() });
			this.unpinBtn = button(hud, { icon: 'pin-off', variant: 'quiet', size: 'sm', tooltip: 'Unpin all', cls: pinnedHere ? 'ws-graph__unpin-all' : 'ws-graph__unpin-all is-hidden', onClick: () => this.unpinAll() });
		});
		this.renderLegend(host, doc, data);
		this.renderSpot(host);
		if (data.capped) {
			const hint = host.createDiv({ cls: 'ws-vis-hint' });
			icon(hint, 'info');
			hint.createSpan({ text: `Showing the ${data.nodes.length} best-connected entries; ${data.capped} more are left out. Filter by type or centre on someone to see them.` });
		} else if (!data.edges.length) {
			const hint = host.createDiv({ cls: 'ws-vis-hint' });
			icon(hint, 'sparkles');
			hint.createSpan({ text: 'No connections between these yet. Open an entry and add one in its Connections section.' });
		}
	}

	private unpinAll(): void {
		const before = this.doc.pinned;
		const id = this.saved ? this.id : null;
		this.update({ pinned: {} }, { quiet: true });
		this.canvas?.reheat();
		this.known.clear();
		this.render();
		this.canvas?.reheat();
		actionNotice('Unpinned everything.', {
			label: 'Undo',
			run: () => {
				// Put the pins back on the view they came from, whatever is on screen now.
				if (id) this.s.graphs.update(id, { pinned: before });
				if (!this.dead && this.id === id && id) this.render();
			},
		});
	}

	private renderLegend(host: HTMLElement, doc: GraphDoc, data: GraphData): void {
		const kinds = [...data.kinds.entries()].sort((a, b) => b[1] - a[1]);
		if (!kinds.length) return;
		const lg = host.createDiv({ cls: 'ws-graph__legend' });
		const det = lg.createEl('details');
		if (this.ctx.el.closest('.worldsmith')?.getAttribute('data-ws-size') !== 'narrow') det.setAttr('open', '');
		const sum = det.createEl('summary', { cls: 'ws-graph__legend-title' });
		icon(sum, 'list');
		sum.createSpan({ text: `${data.nodes.length} entries · ${data.edges.length} connections` });
		const list = det.createDiv({ cls: 'ws-graph__legend-list' });
		for (const [id, n] of kinds.slice(0, 12)) {
			const t = id === '__parent' ? null : this.s.relations.type(id);
			const row = list.createEl('button', { cls: cx('ws-graph__legend-item', `ws-tint--${id === '__parent' ? 'gray' : kindColor(id, t)}`, id === '__parent' && 'is-parent'), attr: { type: 'button', 'data-kind': id, title: id === '__parent' ? 'Inside of' : `Show only ${t?.label ?? id}` } });
			row.createSpan({ cls: 'ws-graph__swatch' });
			row.createSpan({ cls: 'ws-graph__legend-name', text: id === '__parent' ? 'Inside of' : (t?.label ?? id) });
			row.createSpan({ cls: 'ws-graph__legend-n', text: String(n) });
			if (id !== '__parent') row.addEventListener('click', () => this.update({ kinds: doc.kinds.length === 1 && doc.kinds[0] === id ? [] : [id] }));
		}
		if (kinds.length > 12) list.createDiv({ cls: 'ws-graph__legend-more', text: `and ${kinds.length - 12} more` });
	}

	/** The selected entry: who they are and everyone they're joined to. */
	private renderSpot(host: HTMLElement): void {
		host.querySelector(':scope > .ws-vis-spot')?.remove();
		const id = this.selected;
		const e = id ? this.s.entities.get(id) : undefined;
		if (!e || e.trashedAt || !this.data) return;
		const S = this.s;
		const doc = this.doc;
		const schema = S.schemas.get(e.typeId);
		const spot = host.createDiv({ cls: cx('ws-vis-spot', 'ws-graph-spot', schema?.color && `ws-tint--${schema.color}`) });
		const top = spot.createDiv({ cls: 'ws-vis-spot__top' });
		avatar(top, this.ctx.ws.app, e, schema, { size: 'md' });
		const t = top.createDiv({ cls: 'ws-vis-spot__text' });
		t.createDiv({ cls: 'ws-vis-spot__name', text: e.name });
		if (schema) t.createDiv({ cls: 'ws-vis-spot__meta', text: schema.singular });
		button(top, {
			icon: 'x',
			variant: 'quiet',
			size: 'sm',
			tooltip: 'Close',
			cls: 'ws-vis-spot__close',
			onClick: () => this.canvas?.select(null),
		});
		const desc = plainText(e.description);
		if (desc) spot.createDiv({ cls: 'ws-vis-spot__desc', text: desc.length > 160 ? `${desc.slice(0, 157)}…` : desc });

		// Connections, grouped by how they read from this entry ("Mentor of", "Rival of").
		const groups = new Map<string, Array<{ other: EntityRecord; secret: boolean }>>();
		for (const edge of this.data.edges) {
			if (edge.from !== e.id && edge.to !== e.id) continue;
			const other = S.entities.get(edge.from === e.id ? edge.to : edge.from);
			if (!other) continue;
			let label: string;
			if (edge.kind === '__parent') label = edge.from === e.id ? 'Inside' : 'Contains';
			else label = (edge.from === e.id || edge.type?.symmetric ? edge.type?.forwardLabel : edge.type?.reverseLabel) || edge.type?.label || edge.kind;
			groups.set(label, [...(groups.get(label) ?? []), { other, secret: edge.secret }]);
		}
		if (groups.size) {
			const list = spot.createDiv({ cls: 'ws-graph-spot__links' });
			for (const [label, items] of groups) {
				const g = list.createDiv({ cls: 'ws-graph-spot__group' });
				g.createDiv({ cls: 'ws-graph-spot__label', text: label });
				const row = g.createDiv({ cls: 'ws-graph-spot__people' });
				for (const { other, secret } of items.slice(0, 8)) {
					const b = row.createEl('button', { cls: cx('ws-graph-spot__person', secret && 'is-secret'), attr: { type: 'button', 'data-entity': other.id, title: secret ? `${other.name} (secret)` : other.name } });
					avatar(b, this.ctx.ws.app, other, S.schemas.get(other.typeId), { size: 'xs' });
					b.createSpan({ text: other.name });
					if (secret) icon(b, 'eye-off');
					b.addEventListener('click', () => {
						this.canvas?.select(other.id);
						this.canvas?.reveal(other.id);
					});
				}
				if (items.length > 8) row.createSpan({ cls: 'ws-graph-spot__more', text: `+${items.length - 8}` });
			}
		} else spot.createDiv({ cls: 'ws-vis-spot__meta', text: 'No connections shown.' });

		const acts = spot.createDiv({ cls: 'ws-vis-spot__actions' });
		button(acts, { label: 'Open', icon: 'arrow-up-right', variant: 'default', size: 'sm', onClick: (evt) => this.ctx.navigate(ROUTES.entity(e.id), evt.metaKey || evt.ctrlKey ? 'tab' : false) });
		if (doc.focusId !== e.id) button(acts, { label: 'Centre here', icon: 'crosshair', variant: 'ghost', size: 'sm', cls: 'ws-graph-spot__centre', onClick: () => this.update({ focusId: e.id }) });
		if (doc.pinned[e.id]) {
			button(acts, {
				label: 'Unpin',
				icon: 'pin-off',
				variant: 'ghost',
				size: 'sm',
				cls: 'ws-graph-spot__unpin',
				onClick: () => {
					const { [e.id]: _gone, ...rest } = this.doc.pinned;
					this.update({ pinned: rest });
					this.canvas?.reheat();
				},
			});
		}
	}

	private nodeMenu(id: string, evt: MouseEvent): void {
		const e = this.s.entities.get(id);
		if (!e) return;
		const menu = entityMenu(this.ctx.ws, e);
		menu.addSeparator();
		const doc = this.doc;
		if (doc.focusId !== id) menu.addItem((i) => i.setTitle('Centre the graph here').setIcon('crosshair').onClick(() => this.update({ focusId: id })));
		if (doc.pinned[id]) {
			menu.addItem((i) =>
				i.setTitle('Unpin').setIcon('pin-off').onClick(() => {
					const { [id]: _gone, ...rest } = this.doc.pinned;
					this.update({ pinned: rest });
					this.canvas?.reheat();
				}),
			);
		}
		menu.addItem((i) => i.setTitle(`Hide ${this.s.schemas.get(e.typeId)?.plural.toLowerCase() ?? 'this type'}`).setIcon('eye-off').onClick(() => {
			const all = this.s.schemas.list().map((t) => t.id);
			const cur = doc.types.length ? doc.types : all;
			this.update({ types: cur.filter((x) => x !== e.typeId) });
		}));
		menu.showAtMouseEvent(evt);
	}

	// ── Customize ────────────────────────────────────────────────────────────────

	private togglePanel(anchor: HTMLElement): void {
		if (this.panel) {
			this.panel.close();
			return;
		}
		this.panel = new Popover(anchor, { cls: 'ws-vis-panel', width: 360, label: 'Customize the graph', onClose: () => (this.panel = null) });
		this.fillPanel(this.panel.el);
	}

	private fillPanel(el: HTMLElement): void {
		const doc = this.doc;
		const keepScroll = el.scrollTop;
		el.querySelectorAll(':scope > :not(.ws-sr-only)').forEach((x) => x.remove());
		aboutSection(el, doc.description, 'What this view is for…', (description) => this.update({ description }));
		const look = panelSection(el, 'Look', 'palette');
		segmentedRow(look, 'Names', [
			{ id: 'always', label: 'Always' },
			{ id: 'hover', label: 'On hover' },
			{ id: 'never', label: 'Never' },
		], doc.labels, (labels) => this.update({ labels }));
		segmentedRow(look, 'Color by', [
			{ id: 'type', label: 'Type' },
			{ id: 'status', label: 'Status' },
			{ id: 'none', label: 'None' },
		], doc.colorBy, (colorBy) => this.update({ colorBy }));
		const sp = SPACING.reduce((a, b) => (Math.abs(b.v - doc.spacing) < Math.abs(a.v - doc.spacing) ? b : a));
		segmentedRow(look, 'Spacing', SPACING.map(({ id, label }) => ({ id, label })), sp.id, (id) => this.update({ spacing: SPACING.find((x) => x.id === id)!.v }));
		segmentedRow(look, 'Background', BACKGROUND_OPTIONS, doc.background, (background) => this.update({ background }));
		toggleRow(look, 'Pictures', doc.photos, (photos) => this.update({ photos }), 'Portraits inside the dots');
		toggleRow(look, 'Size by connections', doc.sizeByLinks, (sizeByLinks) => this.update({ sizeByLinks }), 'Busier entries get bigger dots');
		toggleRow(look, 'Connection names', doc.edgeLabels, (edgeLabels) => this.update({ edgeLabels }), 'Write the kind on each line');

		const what = panelSection(el, 'What to show', 'filter');
		toggleRow(what, 'Unconnected entries', !doc.hideIsolated, (v) => this.update({ hideIsolated: !v }), 'Entries with no connections at all');
		toggleRow(what, 'Secret connections', doc.showSecret, (showSecret) => this.update({ showSecret }), 'Drawn dashed');
		toggleRow(what, 'Inside of', doc.showParents, (showParents) => this.update({ showParents }), 'Join each entry to what it sits inside');
		if (doc.focusId) stepperRow(what, 'Steps away', doc.depth, 1, 4, (depth) => this.update({ depth }), `How far out from ${this.s.entities.get(doc.focusId)?.name ?? 'the centre'}`);

		const pins = Object.keys(doc.pinned).length;
		const p = panelSection(el, 'Placement', 'pin');
		toggleRow(p, 'Pin entries you move', doc.pinOnDrag, (pinOnDrag) => this.update({ pinOnDrag }), 'Off: a dot you drag settles back in with the rest');
		if (pins) {
			p.createDiv({ cls: 'ws-vis-panel__hint', text: `${pins} ${pins === 1 ? 'entry is' : 'entries are'} pinned where you dropped ${pins === 1 ? 'it' : 'them'}.` });
			const r = p.createDiv({ cls: 'ws-vis-panel__line' });
			button(r, { label: 'Unpin all', icon: 'pin-off', variant: 'ghost', size: 'sm', onClick: () => this.unpinAll() });
		}
		el.scrollTop = keepScroll;
	}
}
