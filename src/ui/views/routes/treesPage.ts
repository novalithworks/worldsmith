import { Menu, Notice } from 'obsidian';
import type { EntityRecord, EntitySchema, RelationType, TreeDoc } from '../../../core/types';
import { plainText } from '../../../core/util/strings';
import type { WorldSession } from '../../../services/WorldSession';
import { familyLinks, hierarchyChildren, layoutFamily, layoutHierarchy, lifeDates, type TreeNode } from '../../../services/trees';
import { ROUTES } from '../../../state/route';
import { entityMenu } from '../../actions';
import { avatar } from '../../components/avatar';
import { button, cx, emptyState, icon } from '../../components/dom';
import { EntityPicker } from '../../components/EntityPicker';
import { own } from '../../components/lifecycle';
import { confirmModal, promptModal } from '../../components/modals';
import { actionNotice } from '../../components/notice';
import { Popover } from '../../components/popover';
import { renderTree, treeMetrics, treeThumb, type TreeCanvas } from '../../trees/render';
import { aboutSection, BACKGROUND_OPTIONS, canvasHud, docCard, fullView, panelSection, segmentedRow, startCard, stepperRow, toggleRow, visualHeader, visualHome, type DocActions, type FullView } from '../../visual/common';
import { hoverPeek, type Peek } from '../../visual/peek';
import type { RouteContext, RouteDefinition } from './RouteRegistry';
import { mountToolBanner } from '../../media/pageBanner';

/**
 * Trees (0.11; "Family trees" until 0.12): family trees and hierarchies. A family tree is
 * drawn around one person from "Parent & child" and partner connections; a hierarchy
 * follows "inside of" (an entry's parent). Relatives can be added straight from a card,
 * and every look can be changed. The home page lists them; a tree opens as the whole page.
 */
export const treesRoute: RouteDefinition = {
	id: 'trees',
	needsWorld: true,
	title: (p, s) => s?.trees.get(p.id)?.name ?? 'Trees',
	icon: () => 'network',
	render(ctx) {
		new TreesPage(ctx).mount();
	},
};

const FAMILY_KINDS = ['parent-of', 'marriage'];

class TreesPage {
	private id: string | null;
	private headEl!: HTMLElement;
	private bodyEl!: HTMLElement;
	private canvas: TreeCanvas | null = null;
	private view: { k: number; x: number; y: number } | null = null;
	/** What the kept view belongs to (a new root re-centres). */
	private viewOf = '';
	private selected: string | null = null;
	private queued = false;
	private panel: Popover | null = null;

	/** Set once the page is left: a late timer must not draw into the next page. */
	private dead = false;

	constructor(private readonly ctx: RouteContext) {
		own(ctx.component, { dispose: () => (this.dead = true) });
		const s = ctx.session!;
		// No tree asked for: the home page (0.12), not the first tree.
		this.id = s.trees.get(ctx.params.id)?.id ?? null;
	}

	private get s(): WorldSession {
		return this.ctx.session!;
	}

	private get doc(): TreeDoc | undefined {
		return this.s.trees.get(this.id);
	}

	mount(): void {
		this.pageEl = this.ctx.el.createDiv({ cls: 'ws-page ws-vis ws-trees' });
		this.headEl = this.pageEl.createDiv();
		this.bodyEl = this.pageEl.createDiv({ cls: 'ws-vis__body' });
		this.render();
		const later = () => this.queue();
		const ev = this.s.events;
		const c = this.ctx.component;
		own(c, ev.on('entity:created', later));
		own(c, ev.on('entity:deleted', later));
		own(c, ev.on('entity:updated', ({ change }) => change.keys.some((k) => ['name', 'trashedAt', 'archivedAt', 'parentId', 'status', 'media', 'sortOrder', 'typeId'].includes(k) || k.startsWith('values')) && later()));
		for (const e of ['edge:created', 'edge:deleted', 'edge:updated', 'schema:updated', 'relationType:created', 'relationType:deleted'] as const) own(c, ev.on(e, later));
		own(c, ev.on('doc:saved', ({ kind }) => kind === 'tree' && later()));
		own(c, ev.on('doc:deleted', ({ kind, id }) => {
			if (kind !== 'tree') return;
			if (id === this.id) this.id = null;
			later();
		}));
		own(c, { dispose: () => { this.canvas?.destroy(); this.panel?.close(); this.peek?.destroy(); } });
	}

	private queue(): void {
		if (this.queued) return;
		this.queued = true;
		window.setTimeout(() => {
			this.queued = false;
			if (!this.dead && this.ctx.el.isConnected) this.render();
		}, 60);
	}

	private update(patch: Partial<TreeDoc>): void {
		if (!this.id) return;
		this.s.trees.update(this.id, patch);
		this.render();
		if (this.panel) this.fillPanel(this.panel.el);
	}

	private open(id: string | null): void {
		this.id = id;
		this.view = null;
		this.selected = null;
		this.ctx.replaceParams(id ? { id } : {});
		this.render();
	}

	private headSig = '';
	private pageEl!: HTMLElement;
	private frame: FullView | null = null;
	private peek: Peek | null = null;

	private render(): void {
		const doc = this.doc;
		// The frame (and the Customize panel anchored to it) stays put unless it changed.
		const sig = JSON.stringify(doc ? [doc.id, doc.kind, doc.icon] : ['home']);
		this.pageEl.toggleClass('ws-page--full', !!doc);
		if (sig !== this.headSig) {
			this.headSig = sig;
			this.panel?.close();
			this.peek?.destroy();
			this.peek = null;
			this.headEl.empty();
			this.bodyEl.empty();
			this.frame = null;
			if (doc) this.renderFrame(doc);
			else this.renderHead();
		} else if (doc) this.frame?.setName(doc.name);
		this.canvas?.destroy();
		this.canvas = null;
		if (!doc || !this.frame) {
			this.bodyEl.empty();
			return this.renderStart();
		}
		this.ctx.setTitle(doc.name);
		this.peek?.hide();
		this.frame.host.empty();
		this.renderCanvas(doc, this.frame.host);
	}

	// ── Header and frame ──────────────────────────────────────────────────────────

	private renderHead(): void {
		const { head, actions } = visualHeader(this.headEl, {
			icon: 'network',
			tint: 'green',
			title: 'Trees',
			desc: 'Family trees, and everything that sits inside something else.',
		});
		button(actions, { label: 'Relationships', icon: 'git-merge', variant: 'ghost', onClick: () => this.ctx.navigate(ROUTES.relationships()) });
		button(actions, { label: 'New tree', icon: 'plus', variant: 'default', cls: 'ws-tree-new', onClick: (e) => this.newMenu(e) });
		mountToolBanner(this.ctx, head, 'trees');
	}

	private renderFrame(doc: TreeDoc): void {
		this.frame = fullView(this.bodyEl, {
			icon: doc.icon || (doc.kind === 'hierarchy' ? 'list-tree' : 'network'),
			tint: 'green',
			title: doc.name,
			home: 'Trees',
			label: (name) => `${name}, a ${doc.kind === 'family' ? 'family tree' : 'hierarchy'}`,
			onHome: () => this.open(null),
			onRename: (name) => this.update({ name }),
			menu: () => this.actionsFor(this.doc ?? doc, true),
		});
		const a = this.frame.actions;
		button(a, { label: doc.kind === 'family' ? 'Start from…' : 'Show…', icon: 'crosshair', variant: 'ghost', size: 'sm', cls: 'ws-tree__reroot', tooltip: doc.kind === 'family' ? 'Start from someone else' : 'Start from something else', onClick: (e) => this.changeRoot(e.currentTarget as HTMLElement) });
		const cust = button(a, { label: 'Customize', icon: 'sliders-horizontal', variant: 'ghost', size: 'sm', cls: 'ws-vis-customize', onClick: () => this.togglePanel(cust) });
		this.peek = hoverPeek(this.frame.host, this.ctx.ws, this.s, '.ws-tree-card[data-entity]', (el) => {
			const e = this.s.entities.get(el.getAttribute('data-entity') ?? '');
			return e ? { entity: e } : null;
		});
	}

	private actionsFor(t: TreeDoc, inside: boolean): DocActions {
		return {
			noun: 'tree',
			onOpen: inside ? undefined : () => this.open(t.id),
			onRename: () => {
				if (inside) {
					const input = this.bodyEl.querySelector<HTMLInputElement>('.ws-vis-full__name');
					if (input) return void (input.focus(), input.select());
				}
				void promptModal(this.ctx.ws.app, { title: 'Rename tree', label: 'Name', value: t.name, confirmLabel: 'Rename' }).then((v) => {
					const name = v?.trim();
					if (name && name !== t.name) this.s.trees.update(t.id, { name });
					if (name && this.id === t.id) this.render();
				});
			},
			onDuplicate: () => {
				const copy = this.s.trees.duplicate(t.id);
				if (copy && inside) this.open(copy.id);
			},
			onDelete: () => void this.remove(t.id),
			extra: inside
				? (menu) => {
						const others = this.s.trees.list().filter((d) => d.id !== t.id);
						if (!others.length) return;
						menu.addSeparator();
						for (const d of others.slice(0, 12)) menu.addItem((i) => i.setTitle(`Open ${d.name}`).setIcon(d.kind === 'family' ? 'network' : 'list-tree').onClick(() => this.open(d.id)));
					}
				: undefined,
		};
	}

	private async remove(id = this.id): Promise<void> {
		const doc = this.s.trees.get(id);
		if (!doc) return;
		const ok = await confirmModal(this.ctx.ws.app, { title: `Delete “${doc.name}”?`, body: 'Only the drawing goes: every entry and connection stays as it is. You can undo this.', confirmLabel: 'Delete tree', danger: true });
		if (!ok) return;
		// Removing clears this.id (the deleted event runs first), so ask before.
		const wasOpen = doc.id === this.id;
		const gone = this.s.trees.remove(doc.id);
		if (wasOpen) this.open(null);
		if (gone)
			actionNotice(`Deleted “${gone.name}”.`, {
				label: 'Undo',
				run: () => {
					this.s.trees.restore(gone);
					if (!this.dead) this.open(gone.id);
				},
			});
	}
	// ── Starting a tree ─────────────────────────────────────────────────────────────

	/** Types people use in family trees: characters, and anything with a parent/child link. */
	private familyTypes(): EntitySchema[] {
		const kinds = new Set(FAMILY_KINDS);
		const used = new Set<string>();
		for (const e of this.s.relations.allEdges()) {
			if (!kinds.has(e.type)) continue;
			const a = this.s.entities.get(e.from);
			const b = this.s.entities.get(e.to);
			if (a) used.add(a.typeId);
			if (b) used.add(b.typeId);
		}
		return this.s.schemas.list().filter((t) => t.id === 'character' || used.has(t.id));
	}

	/** Types whose entries sit inside each other (places, groups…), with how many do. */
	private nestedTypes(): Array<{ schema: EntitySchema; nested: number }> {
		const nested = new Map<string, number>();
		for (const e of this.s.entities.values()) if (e.parentId && !e.trashedAt) nested.set(e.typeId, (nested.get(e.typeId) ?? 0) + 1);
		return this.s.schemas
			.list()
			.filter((t) => nested.get(t.id) || t.hierarchy.parentTypes.includes(t.id))
			.map((schema) => ({ schema, nested: nested.get(schema.id) ?? 0 }))
			.sort((a, b) => b.nested - a.nested);
	}

	private newMenu(evt: MouseEvent): void {
		const m = new Menu();
		m.addItem((i) => i.setTitle('Family tree…').setIcon('network').onClick(() => this.pickFamilyRoot(evt.target as HTMLElement)));
		m.addSeparator();
		for (const { schema } of this.nestedTypes().slice(0, 8)) m.addItem((i) => i.setTitle(`Hierarchy of ${schema.plural.toLowerCase()}`).setIcon(schema.icon).onClick(() => this.createHierarchy(schema)));
		m.addItem((i) => i.setTitle('Hierarchy from one entry…').setIcon('list-tree').onClick(() => this.pickHierarchyRoot(evt.target as HTMLElement)));
		m.showAtMouseEvent(evt);
	}

	private pickFamilyRoot(anchor: HTMLElement, onPick?: (e: EntityRecord) => void): void {
		const types = this.familyTypes().map((t) => t.id);
		new EntityPicker(anchor, {
			session: this.s,
			app: this.ctx.ws.app,
			typeIds: types,
			createTypes: [],
			placeholder: 'Whose family? Search…',
			onPick: (e) => (onPick ? onPick(e) : this.createFamily(e)),
		});
	}

	private pickHierarchyRoot(anchor: HTMLElement, onPick?: (e: EntityRecord) => void): void {
		new EntityPicker(anchor, {
			session: this.s,
			app: this.ctx.ws.app,
			createTypes: [],
			placeholder: 'Start from which entry?',
			onPick: (e) => (onPick ? onPick(e) : this.createHierarchy(null, e)),
		});
	}

	private createFamily(e: EntityRecord): void {
		const added = this.s.ensureRelationKinds(FAMILY_KINDS);
		const doc = this.s.trees.create({ name: `${e.name}’s family`, kind: 'family', rootId: e.id });
		if (added.length) new Notice('Added the “Parent & child” and “Marriage” relationship kinds so families can be drawn.');
		this.open(doc.id);
	}

	private createHierarchy(schema: EntitySchema | null, e?: EntityRecord): void {
		const doc = this.s.trees.create(schema ? { name: schema.plural, kind: 'hierarchy', typeId: schema.id, icon: 'list-tree' } : { name: `Inside ${e!.name}`, kind: 'hierarchy', rootId: e!.id, icon: 'list-tree' });
		this.open(doc.id);
	}

	/** The home page: the two kinds of tree on top, then every tree made so far. */
	private renderStart(): void {
		this.ctx.setTitle('Trees');
		const trees = this.s.trees.list();
		const { starts, grid } = visualHome(this.bodyEl, { title: 'Your trees', count: trees.length, noun: 'tree', empty: 'Trees you make appear here. Right-click one later to rename, copy or delete it.' });
		startCard(starts, {
			icon: 'network',
			tint: 'green',
			title: 'A family tree',
			body: 'Pick someone and see their parents, partners, brothers and sisters, children and grandchildren. Add relatives right on the tree.',
			cta: 'Choose a person',
			attr: { 'data-start': 'family' },
			onClick: (e) => this.pickFamilyRoot(e.currentTarget as HTMLElement),
		});
		startCard(starts, {
			icon: 'list-tree',
			tint: 'blue',
			title: 'A hierarchy',
			body: 'Continents, kingdoms and cities; orders, chapters and cells. Everything that sits inside something else, as one tree.',
			cta: 'Choose what to show',
			attr: { 'data-start': 'hierarchy' },
			onClick: (e) => {
				const m = new Menu();
				for (const { schema, nested } of this.nestedTypes()) m.addItem((i) => i.setTitle(nested ? `${schema.plural} (${nested} inside others)` : schema.plural).setIcon(schema.icon).onClick(() => this.createHierarchy(schema)));
				m.addSeparator();
				m.addItem((i) => i.setTitle('From one entry…').setIcon('search').onClick(() => this.pickHierarchyRoot(e.currentTarget as HTMLElement)));
				m.showAtMouseEvent(e);
			},
		});
		if (!grid) return;
		for (const t of trees) {
			const root = t.rootId ? this.s.entities.get(t.rootId) : undefined;
			const type = t.typeId ? this.s.schemas.get(t.typeId) : undefined;
			const m = treeMetrics(t);
			const layout = t.kind === 'family' ? layoutFamily(this.s, t, m) : layoutHierarchy(this.s, t, m);
			const people = layout ? layout.nodes.filter((n) => n.entityId && !n.repeat).length : 0;
			const what = t.kind === 'family' ? (root ? `Around ${root.name}` : 'Family tree') : root ? `Inside ${root.name}` : type ? `All ${type.plural.toLowerCase()}` : 'Hierarchy';
			docCard(grid, {
				id: t.id,
				name: t.name,
				meta: `${what} · ${people} ${t.kind === 'family' ? (people === 1 ? 'person' : 'people') : people === 1 ? 'entry' : 'entries'}`,
				icon: t.kind === 'family' ? 'network' : 'list-tree',
				tint: t.kind === 'family' ? 'green' : 'blue',
				cls: 'ws-tree-doc',
				picture: (frame) => treeThumb(frame, t, layout),
				actions: this.actionsFor(t, false),
			});
		}
	}

	// ── The tree ────────────────────────────────────────────────────────────────

	private renderCanvas(doc: TreeDoc, host: HTMLElement): void {
		const m = treeMetrics(doc);
		const links = doc.kind === 'family' ? familyLinks(this.s, doc) : null;
		const layout = doc.kind === 'family' ? layoutFamily(this.s, doc, m, links!) : layoutHierarchy(this.s, doc, m);
		if (!layout) {
			const root = doc.rootId ? this.s.entities.get(doc.rootId) : undefined;
			emptyState(host, {
				icon: 'user-x',
				title: root?.trashedAt ? `${root.name} is in the trash` : 'This tree has lost its starting point',
				body: 'Pick who (or what) it starts from and it draws again.',
				actionLabel: 'Choose a starting point',
				actionIcon: 'crosshair',
				onAction: () => this.changeRoot(host),
			});
			return;
		}
		const key = `${doc.id}:${doc.rootId}:${doc.typeId}:${doc.direction}:${doc.card}`;
		if (key !== this.viewOf) this.view = null;
		this.viewOf = key;
		const tools = this.toolsFor(doc);
		const selectedKey = this.selected ? (layout.nodes.find((n) => n.entityId === this.selected && !n.repeat)?.key ?? null) : null;
		this.canvas = renderTree(host, this.ctx.ws.app, this.s, doc, layout, {
			open: (id, evt) => this.ctx.navigate(ROUTES.entity(id), evt.metaKey || evt.ctrlKey ? 'tab' : false),
			tools,
			keep: this.view,
			onView: (v) => (this.view = v),
			selected: selectedKey,
			onSelect: (k) => {
				this.selected = k ? (layout.nodes.find((n) => n.key === k)?.entityId ?? null) : null;
				this.renderSpot(host, doc);
			},
		});
		canvasHud(host, () => this.canvas?.pz ?? null, () => this.canvas?.fit(true));
		this.renderSpot(host, doc);
		// A gentle hint when a family tree is just one person.
		if (doc.kind === 'family' && layout.nodes.length === 1) {
			const hint = host.createDiv({ cls: 'ws-vis-hint' });
			icon(hint, 'sparkles');
			hint.createSpan({ text: 'Just one person so far. Hover their card (or tap it) and use the buttons to add parents, a partner or children.' });
		}
		const total = layout.nodes.filter((n) => n.entityId && !n.repeat).length;
		host.setAttr('data-count', String(total));
	}

	private changeRoot(anchor: HTMLElement): void {
		const doc = this.doc;
		if (!doc) return;
		if (doc.kind === 'family') this.pickFamilyRoot(anchor, (e) => this.update({ rootId: e.id }));
		else {
			const m = new Menu();
			for (const { schema } of this.nestedTypes()) m.addItem((i) => i.setTitle(`All ${schema.plural.toLowerCase()}`).setIcon(schema.icon).setChecked(!doc.rootId && doc.typeId === schema.id).onClick(() => this.update({ rootId: null, typeId: schema.id })));
			m.addSeparator();
			m.addItem((i) => i.setTitle('One entry…').setIcon('search').onClick(() => this.pickHierarchyRoot(anchor, (e) => this.update({ rootId: e.id }))));
			const r = anchor.getBoundingClientRect();
			m.showAtPosition({ x: r.left, y: r.bottom });
		}
	}

	/** A card for the selected person: who they are and what's around them. */
	private renderSpot(host: HTMLElement, doc: TreeDoc): void {
		host.querySelector(':scope > .ws-vis-spot')?.remove();
		const e = this.selected ? this.s.entities.get(this.selected) : undefined;
		if (!e || e.trashedAt) return;
		const schema = this.s.schemas.get(e.typeId);
		const spot = host.createDiv({ cls: cx('ws-vis-spot', schema?.color && `ws-tint--${schema.color}`) });
		const top = spot.createDiv({ cls: 'ws-vis-spot__top' });
		avatar(top, this.ctx.ws.app, e, schema, { size: 'md' });
		const t = top.createDiv({ cls: 'ws-vis-spot__text' });
		t.createDiv({ cls: 'ws-vis-spot__name', text: e.name });
		const sub = [schema?.singular, lifeDates(this.s, e)].filter(Boolean).join(' · ');
		if (sub) t.createDiv({ cls: 'ws-vis-spot__meta', text: sub });
		button(top, { icon: 'x', variant: 'quiet', size: 'sm', tooltip: 'Close', cls: 'ws-vis-spot__close', onClick: () => { this.selected = null; spot.remove(); host.querySelectorAll('.ws-tree-card.is-selected').forEach((x) => x.removeClass('is-selected')); } });
		const desc = plainText(e.description);
		if (desc) spot.createDiv({ cls: 'ws-vis-spot__desc', text: desc.length > 160 ? `${desc.slice(0, 157)}…` : desc });
		if (doc.kind === 'family') {
			const L = familyLinks(this.s, doc);
			const facts = spot.createDiv({ cls: 'ws-vis-spot__facts' });
			for (const [label, ids] of [
				['Parents', L.parents(e.id)],
				['Partners', L.partners(e.id)],
				['Children', L.children(e.id)],
			] as const) {
				const f = facts.createDiv({ cls: 'ws-vis-spot__fact' });
				f.createDiv({ cls: 'ws-vis-spot__n', text: String(ids.length) });
				f.createDiv({ cls: 'ws-vis-spot__label', text: label });
			}
		} else {
			const n = hierarchyChildren(this.s, e.id).length;
			spot.createDiv({ cls: 'ws-vis-spot__meta', text: n ? `${n} inside` : 'Nothing inside yet' });
		}
		const acts = spot.createDiv({ cls: 'ws-vis-spot__actions' });
		button(acts, { label: 'Open', icon: 'arrow-up-right', variant: 'default', size: 'sm', onClick: (evt) => this.ctx.navigate(ROUTES.entity(e.id), evt.metaKey || evt.ctrlKey ? 'tab' : false) });
		if (doc.kind === 'family' && doc.rootId !== e.id) button(acts, { label: 'Centre here', icon: 'crosshair', variant: 'ghost', size: 'sm', onClick: () => this.update({ rootId: e.id }) });
	}

	// ── Editing from the tree ───────────────────────────────────────────────────────

	private toolsFor(doc: TreeDoc) {
		const S = this.s;
		const exclude = (ids: string[]) => new Set(ids);
		const typeOf = (n: TreeNode) => (n.entityId ? S.entities.get(n.entityId)?.typeId : undefined);
		const link = (from: string, kind: string, to: string, message: string) => {
			S.ensureRelationKinds([kind]);
			if (!S.relations.type(kind)) {
				new Notice('That relationship kind no longer exists. Choose another in Customize → Family links.');
				return;
			}
			try {
				const edge = S.relations.connect(from, kind, to);
				actionNotice(message, { label: 'Undo', run: () => S.relations.unlink(edge.id) });
			} catch (e) {
				new Notice(e instanceof Error ? e.message : String(e));
			}
		};
		const pick = (anchor: HTMLElement, n: TreeNode, placeholder: string, skip: string[], done: (e: EntityRecord) => void) => {
			const t = typeOf(n);
			new EntityPicker(anchor, { session: S, app: this.ctx.ws.app, typeIds: t ? [t] : [], createTypes: t ? [t] : [], exclude: exclude([n.entityId!, ...skip]), placeholder, onPick: (e) => done(e) });
		};
		if (doc.kind === 'family') {
			const L = familyLinks(S, doc);
			const parentKind = doc.parentKinds[0] ?? 'parent-of';
			const partnerKind = doc.partnerKinds[0] ?? 'marriage';
			const nameOf = (id: string) => S.entities.get(id)?.name ?? 'them';
			return {
				addParent: (n: TreeNode, a: HTMLElement) => pick(a, n, `A parent of ${nameOf(n.entityId!)}…`, L.parents(n.entityId!), (p) => link(p.id, parentKind, n.entityId!, `${p.name} is now a parent of ${nameOf(n.entityId!)}.`)),
				addPartner: (n: TreeNode, a: HTMLElement) => pick(a, n, `${nameOf(n.entityId!)}’s partner…`, L.partners(n.entityId!), (p) => link(n.entityId!, partnerKind, p.id, `${p.name} and ${nameOf(n.entityId!)} are now partners.`)),
				addChild: (n: TreeNode, a: HTMLElement) => pick(a, n, `A child of ${nameOf(n.entityId!)}…`, [...L.children(n.entityId!), ...L.parents(n.entityId!)], (c) => link(n.entityId!, parentKind, c.id, `${c.name} is now a child of ${nameOf(n.entityId!)}.`)),
				focus: (n: TreeNode) => this.update({ rootId: n.entityId }),
				menu: (n: TreeNode, evt: MouseEvent) => this.cardMenu(doc, n, evt),
			};
		}
		return {
			addChild: (n: TreeNode, a: HTMLElement) => {
				const parent = S.entities.get(n.entityId!);
				if (!parent) return;
				// Anything that may sit inside this type, and not the entry itself or what it's inside.
				const types = S.schemas.list().filter((t) => t.hierarchy.parentTypes.includes(parent.typeId) || t.id === parent.typeId).map((t) => t.id);
				const above: string[] = [];
				for (let p = parent.parentId ? S.entities.get(parent.parentId) : undefined; p && above.length < 200; p = p.parentId ? S.entities.get(p.parentId) : undefined) above.push(p.id);
				new EntityPicker(a, {
					session: S,
					app: this.ctx.ws.app,
					typeIds: types,
					createTypes: types.slice(0, 3),
					exclude: new Set([parent.id, ...above, ...hierarchyChildren(S, parent.id).map((c) => c.id)]),
					placeholder: `Put something inside ${parent.name}…`,
					onPick: (c) => {
						const before = S.entities.get(c.id)?.parentId ?? null;
						S.entityService.update(c.id, { parentId: parent.id });
						if (doc.collapsed.includes(parent.id)) this.update({ collapsed: doc.collapsed.filter((x) => x !== parent.id) });
						actionNotice(`${c.name} is now inside ${parent.name}.`, { label: 'Undo', run: () => S.entityService.update(c.id, { parentId: before }) });
					},
				});
			},
			toggle: (n: TreeNode) => {
				if (!n.entityId) return;
				const folded = doc.collapsed.includes(n.entityId);
				if (!folded && !n.folded) this.update({ collapsed: [...doc.collapsed, n.entityId] });
				else this.update({ collapsed: doc.collapsed.filter((x) => x !== n.entityId), down: n.folded && !folded ? Math.min(12, doc.down + 1) : doc.down });
			},
			menu: (n: TreeNode, evt: MouseEvent) => this.cardMenu(doc, n, evt),
		};
	}

	private cardMenu(doc: TreeDoc, n: TreeNode, evt: MouseEvent): void {
		const e = n.entityId ? this.s.entities.get(n.entityId) : undefined;
		if (!e) return;
		const menu = entityMenu(this.ctx.ws, e);
		menu.addSeparator();
		const S = this.s;
		if (doc.kind === 'family') {
			if (doc.rootId !== e.id) menu.addItem((i) => i.setTitle('Centre the tree here').setIcon('crosshair').onClick(() => this.update({ rootId: e.id })));
			// The family links this card stands on, each removable (with Undo).
			const kinds = new Set([...doc.parentKinds, ...doc.partnerKinds]);
			for (const edge of S.relations.edgesTouching(e.id)) {
				if (!kinds.has(edge.type)) continue;
				const other = S.entities.get(edge.from === e.id ? edge.to : edge.from);
				if (!other || other.trashedAt) continue;
				const asParent = doc.parentKinds.includes(edge.type);
				const text = asParent ? (edge.from === e.id ? `Not ${other.name}’s parent` : `${other.name} isn’t a parent`) : `Not partners with ${other.name}`;
				menu.addItem((i) =>
					i.setTitle(text).setIcon('unlink').onClick(() => {
						const gone = S.relations.unlink(edge.id);
						if (gone) actionNotice('Removed that family link.', { label: 'Undo', run: () => S.relations.restore([gone]) });
					}),
				);
			}
		} else if (e.parentId && e.id !== doc.rootId) {
			const parent = S.entities.get(e.parentId);
			menu.addItem((i) =>
				i.setTitle(`Take out of ${parent?.name ?? 'its parent'}`).setIcon('corner-left-up').onClick(() => {
					const before = e.parentId;
					S.entityService.update(e.id, { parentId: null });
					actionNotice(`${e.name} is no longer inside ${parent?.name ?? 'it'}.`, { label: 'Undo', run: () => S.entityService.update(e.id, { parentId: before }) });
				}),
			);
		}
		menu.showAtMouseEvent(evt);
	}

	// ── Customize ─────────────────────────────────────────────────────────────────

	private togglePanel(anchor: HTMLElement): void {
		if (this.panel) {
			this.panel.close();
			return;
		}
		this.panel = new Popover(anchor, { cls: 'ws-vis-panel', width: 360, label: 'Customize the tree', onClose: () => (this.panel = null) });
		this.fillPanel(this.panel.el);
	}

	private fillPanel(el: HTMLElement): void {
		const doc = this.doc;
		const keepScroll = el.scrollTop;
		el.querySelectorAll(':scope > :not(.ws-sr-only)').forEach((x) => x.remove());
		if (!doc) return;
		aboutSection(el, doc.description, doc.kind === 'family' ? 'Whose line this is, what it’s for…' : 'What this hierarchy shows…', (description) => this.update({ description }));
		const look = panelSection(el, 'Look', 'palette');
		segmentedRow(look, 'Grows', [
			{ id: 'down', label: 'Down', icon: 'arrow-down' },
			{ id: 'up', label: 'Up', icon: 'arrow-up' },
			{ id: 'right', label: 'Sideways', icon: 'arrow-right' },
		], doc.direction, (direction) => this.update({ direction }));
		segmentedRow(look, 'Cards', [
			{ id: 'portrait', label: 'Portraits' },
			{ id: 'compact', label: 'Compact' },
			{ id: 'name', label: 'Names' },
		], doc.card, (card) => this.update({ card }));
		segmentedRow(look, 'Color by', [
			{ id: 'generation', label: doc.kind === 'family' ? 'Generation' : 'Level' },
			{ id: 'type', label: 'Type' },
			{ id: 'status', label: 'Status' },
			{ id: 'none', label: 'None' },
		], doc.colorBy, (colorBy) => this.update({ colorBy }));
		segmentedRow(look, 'Lines', [
			{ id: 'curved', label: 'Curved' },
			{ id: 'square', label: 'Square' },
			{ id: 'straight', label: 'Straight' },
		], doc.lines, (lines) => this.update({ lines }));
		segmentedRow(look, 'Background', BACKGROUND_OPTIONS, doc.background, (background) => this.update({ background }));

		const size = panelSection(el, doc.kind === 'family' ? 'Generations' : 'Depth', 'layers');
		if (doc.kind === 'family') stepperRow(size, 'Ancestors', doc.up, 0, 8, (up) => this.update({ up }), 'Generations above');
		stepperRow(size, doc.kind === 'family' ? 'Descendants' : 'Levels', doc.down, doc.kind === 'family' ? 0 : 1, 12, (down) => this.update({ down }), doc.kind === 'family' ? 'Generations below' : 'How deep to show');
		if (doc.kind === 'hierarchy' && doc.collapsed.length) {
			const r = size.createDiv({ cls: 'ws-vis-panel__line' });
			button(r, { label: `Unfold all (${doc.collapsed.length})`, icon: 'unfold-vertical', variant: 'ghost', size: 'sm', onClick: () => this.update({ collapsed: [] }) });
		}

		const show = panelSection(el, 'On each card', 'id-card');
		if (doc.card !== 'name') toggleRow(show, 'Pictures', doc.show.photos, (photos) => this.update({ show: { ...doc.show, photos } }));
		if (doc.card !== 'name') toggleRow(show, 'Dates', doc.show.dates, (dates) => this.update({ show: { ...doc.show, dates } }), 'Birth and death, or start and end');
		if (doc.card !== 'name') toggleRow(show, 'Type', doc.show.type, (type) => this.update({ show: { ...doc.show, type } }));
		if (doc.card === 'portrait') toggleRow(show, 'Status', doc.show.status, (status) => this.update({ show: { ...doc.show, status } }));
		if (doc.kind === 'family') {
			toggleRow(show, 'Partners', doc.show.partners, (partners) => this.update({ show: { ...doc.show, partners } }));
			toggleRow(show, 'Brothers & sisters', doc.show.siblings, (siblings) => this.update({ show: { ...doc.show, siblings } }));
		}

		if (doc.kind === 'family') {
			const fam = panelSection(el, 'Family links', 'git-merge');
			fam.createDiv({ cls: 'ws-vis-panel__hint', text: 'Which kinds of connection make someone a parent or a partner.' });
			const kinds = this.s.relations.types();
			this.kindPicker(fam, 'Parents and children', kinds.filter((k) => !k.symmetric), doc.parentKinds, (parentKinds) => this.update({ parentKinds }), 'From the parent to the child');
			this.kindPicker(fam, 'Partners', kinds, doc.partnerKinds, (partnerKinds) => this.update({ partnerKinds }));
		}
		el.scrollTop = keepScroll;
	}

	private kindPicker(parent: HTMLElement, label: string, kinds: RelationType[], value: string[], onChange: (v: string[]) => void, hint?: string): void {
		const row = parent.createDiv({ cls: 'ws-vis-kinds' });
		const head = row.createDiv({ cls: 'ws-vis-kinds__head' });
		head.createDiv({ cls: 'ws-vis-kinds__label', text: label });
		if (hint) head.createDiv({ cls: 'ws-vis-kinds__hint', text: hint });
		const chips = row.createDiv({ cls: 'ws-vis-kinds__chips' });
		for (const id of value) {
			const k = this.s.relations.type(id);
			const c = chips.createDiv({ cls: cx('ws-vis-kind', !k && 'is-missing') });
			if (k?.icon) icon(c, k.icon);
			c.createSpan({ text: k?.label ?? `${id} (not in this world)` });
			const x = c.createEl('button', { cls: 'ws-vis-kind__x', attr: { type: 'button', 'aria-label': `Stop using ${k?.label ?? id}` } });
			icon(x, 'x');
			x.addEventListener('click', () => onChange(value.filter((v) => v !== id)));
		}
		button(chips, {
			label: 'Add',
			icon: 'plus',
			variant: 'ghost',
			size: 'sm',
			onClick: (evt) => {
				const m = new Menu();
				const groups = new Map<string, RelationType[]>();
				for (const k of kinds) if (!value.includes(k.id)) groups.set(k.category, [...(groups.get(k.category) ?? []), k]);
				for (const [cat, list] of groups) {
					m.addSeparator();
					m.addItem((i) => i.setTitle(cat).setIsLabel(true));
					for (const k of list) m.addItem((i) => i.setTitle(k.label).setIcon(k.icon ?? 'link').onClick(() => onChange([...value, k.id])));
				}
				if (!groups.size) m.addItem((i) => i.setTitle('Every kind is in use').setDisabled(true));
				m.showAtMouseEvent(evt);
			},
		});
	}
}
