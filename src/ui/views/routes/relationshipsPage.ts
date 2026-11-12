import { Menu, Notice, setIcon } from 'obsidian';
import type { FieldDefinition, RelationType } from '../../../core/types';
import { slugId } from '../../../core/util/ids';
import type { RelationTypePatch } from '../../../services/RelationService';
import type { WorldSession } from '../../../services/WorldSession';
import { ROUTES } from '../../../state/route';
import { button, cx, emptyState, icon, nameRegion } from '../../components/dom';
import { own } from '../../components/lifecycle';
import { IconPickerModal, promptModal } from '../../components/modals';
import { actionNotice } from '../../components/notice';
import { inlineText, toggle, typePicker } from './typeStudio/common';
import type { RouteContext, RouteDefinition } from './RouteRegistry';

/** Kinds that make sense as properties of a connection (no options editor needed). */
const PROP_KINDS = ['text', 'longtext', 'number', 'percent', 'rating', 'boolean', 'chrono', 'list', 'url'];

/**
 * Studio → Relationships: the kinds of connection in this world. Each kind reads
 * differently from its two ends ("Students" / "Mentors"), may suggest which entry types
 * it connects, and can give every connection extra properties.
 */
export const relationshipsRoute: RouteDefinition = {
	id: 'relationships',
	needsWorld: true,
	title: (p, s) => {
		const t = s?.relations.type(p.typeId);
		return t ? `${t.label} · Relationships` : 'Relationships';
	},
	icon: () => 'waypoints',
	render(ctx) {
		new RelationshipsPage(ctx).mount();
	},
};

class RelationshipsPage {
	private typeId: string | null;
	/** List filter: every kind, only those in use, or only ones made in this world. */
	private filter: 'all' | 'used' | 'custom' = 'all';
	private query = '';
	private folded = new Set<string>();
	private listEl!: HTMLElement;
	private mainEl!: HTMLElement;
	private queued = false;

	constructor(private readonly ctx: RouteContext) {
		const s = ctx.session!;
		const wanted = ctx.params.typeId;
		this.typeId = wanted && s.relations.type(wanted) ? wanted : (s.relations.types()[0]?.id ?? null);
	}

	private get s(): WorldSession {
		return this.ctx.session!;
	}

	mount(): void {
		const page = this.ctx.el.createDiv({ cls: 'ws-page ws-page--studio' });
		const head = page.createDiv({ cls: 'ws-studio-head' });
		const mark = head.createDiv({ cls: 'ws-db-header__mark ws-tint--cyan' });
		icon(mark, 'waypoints');
		const ht = head.createDiv({ cls: 'ws-db-header__text' });
		ht.createEl('h1', { cls: 'ws-db-header__title', text: 'Relationships' });
		ht.createDiv({ cls: 'ws-db-header__desc', text: 'The kinds of connection between entries — and how each one reads from either side.' });
		const actions = head.createDiv({ cls: 'ws-db-header__actions' });
		button(actions, { label: 'New relationship', icon: 'plus', variant: 'primary', onClick: () => void this.create() });

		const body = page.createDiv({ cls: 'ws-studio' });
		this.listEl = body.createDiv({ cls: 'ws-studio__list', attr: { role: 'navigation'} });
		nameRegion(this.listEl, 'Relationships' );
		this.mainEl = body.createDiv({ cls: 'ws-studio__main' });
		this.renderList();
		this.renderMain();

		const refresh = () => this.queue();
		for (const ev of ['relationType:created', 'relationType:updated', 'relationType:deleted', 'schema:updated', 'edge:created', 'edge:deleted'] as const) {
			own(this.ctx.component, this.s.events.on(ev, refresh));
		}
	}

	private queue(): void {
		if (this.queued) return;
		this.queued = true;
		window.requestAnimationFrame(() => {
			this.queued = false;
			if (this.typeId && !this.s.relations.type(this.typeId)) this.typeId = this.s.relations.types()[0]?.id ?? null;
			this.renderList();
			this.renderMain();
		});
	}

	private select(id: string): void {
		this.typeId = id;
		this.ctx.replaceParams({ typeId: id });
		this.ctx.setTitle(`${this.s.relations.type(id)?.label ?? ''} · Relationships`);
		this.renderList();
		this.renderMain(true);
	}

	private async create(): Promise<void> {
		const name = await promptModal(this.ctx.ws.app, { title: 'New relationship', label: 'Name', placeholder: 'e.g. Oath of fealty, Debt, Patronage', confirmLabel: 'Create' });
		if (!name?.trim()) return;
		const t = this.s.relations.createType({ label: name.trim() });
		this.select(t.id);
	}

	private usageCounts(): Map<string, number> {
		const m = new Map<string, number>();
		for (const e of this.s.relations.allEdges()) m.set(e.type, (m.get(e.type) ?? 0) + 1);
		return m;
	}

	private selEl: HTMLSelectElement | null = null;
	private filterEl!: HTMLElement;
	private itemsEl!: HTMLElement;

	/** The search box is built once (typing and input methods aren't interrupted); the rest redraws. */
	private renderList(): void {
		const el = this.listEl;
		const types = this.s.relations.types();
		const counts = this.usageCounts();
		const inUse = (t: RelationType) => (counts.get(t.id) ?? 0) > 0;
		if (!this.selEl) {
			// Phone: a plain select replaces the list.
			const sel = el.createEl('select', { cls: 'ws-input dropdown ws-studio__select', attr: { 'aria-label': 'Relationship' } });
			sel.addEventListener('change', () => this.select(sel.value));
			this.selEl = sel;
			const tools = el.createDiv({ cls: 'ws-rlist__tools' });
			const sw = tools.createDiv({ cls: 'ws-rlist__search' });
			icon(sw, 'search');
			const input = sw.createEl('input', { cls: 'ws-rlist__input', attr: { type: 'search', placeholder: 'Search kinds…', 'aria-label': 'Search relationships', spellcheck: 'false' } });
			const onInput = (e?: Event) => {
				if ((e as InputEvent | undefined)?.isComposing) return;
				this.query = input.value;
				this.renderList();
			};
			input.addEventListener('input', onInput);
			input.addEventListener('compositionend', () => onInput());
			this.filterEl = tools.createDiv({ cls: 'ws-rlist__filter', attr: { role: 'radiogroup' } });
			nameRegion(this.filterEl, 'Show');
			this.itemsEl = el.createDiv({ cls: 'ws-rlist__items' });
		}
		const sel = this.selEl;
		sel.empty();
		const cats = new Map<string, RelationType[]>();
		for (const t of types) cats.set(t.category, [...(cats.get(t.category) ?? []), t]);
		for (const [cat, list] of cats) {
			const og = sel.createEl('optgroup', { attr: { label: cat } });
			for (const t of list) og.createEl('option', { text: t.label, value: t.id });
		}
		if (this.typeId) sel.value = this.typeId;

		const seg = this.filterEl;
		seg.empty();
		const nUsed = types.filter(inUse).length;
		const nCustom = types.filter((t) => !t.origin).length;
		for (const [id, label, n] of [
			['all', 'All', types.length],
			['used', 'Linked', nUsed],
			['custom', 'Yours', nCustom],
		] as const) {
			const on = this.filter === id;
			const b = seg.createEl('button', { cls: cx('ws-rlist__fbtn', on && 'is-active'), attr: { type: 'button', role: 'radio', 'aria-checked': String(on) } });
			b.createSpan({ text: label });
			b.createSpan({ cls: 'ws-rlist__fn', text: String(n) });
			b.addEventListener('click', () => {
				this.filter = id;
				this.renderList();
			});
		}
		const items = this.itemsEl;
		items.empty();

		const q = this.query.trim().toLowerCase();
		const shown = types.filter((t) => (this.filter === 'used' ? inUse(t) : this.filter === 'custom' ? !t.origin : true) && (!q || `${t.label} ${t.forwardLabel} ${t.reverseLabel} ${t.category}`.toLowerCase().includes(q)));
		const byCat = new Map<string, RelationType[]>();
		for (const t of shown) byCat.set(t.category, [...(byCat.get(t.category) ?? []), t]);
		if (!shown.length) items.createDiv({ cls: 'ws-rlist__empty', text: q ? `Nothing matches “${this.query}”.` : this.filter === 'used' ? 'No connections yet — link two entries and the kind shows here.' : 'None yet — use “New relationship”.' });
		for (const [cat, list] of [...byCat.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
			const folded = !q && this.folded.has(cat) && !list.some((t) => t.id === this.typeId);
			const g = items.createDiv({ cls: cx('ws-rlist__cat', folded && 'is-folded') });
			const h = g.createEl('button', { cls: 'ws-rlist__cat-head', attr: { type: 'button', 'aria-expanded': String(!folded) } });
			const caret = h.createSpan({ cls: 'ws-rlist__caret' });
			setIcon(caret, 'chevron-down');
			h.createSpan({ cls: 'ws-rlist__cat-label', text: cat });
			h.createSpan({ cls: 'ws-rlist__cat-n', text: String(list.length) });
			h.addEventListener('click', () => {
				if (this.folded.has(cat)) this.folded.delete(cat);
				else this.folded.add(cat);
				this.renderList();
			});
			if (folded) continue;
			for (const t of list) {
				const on = t.id === this.typeId;
				const item = g.createEl('button', { cls: cx('ws-rlist__item', on && 'is-active', `ws-tint--${t.color ?? 'cyan'}`), attr: { type: 'button', 'aria-current': on ? 'true' : 'false' } });
				const glyph = item.createSpan({ cls: 'ws-rlist__glyph' });
				setIcon(glyph, t.icon ?? 'link-2');
				const tx = item.createSpan({ cls: 'ws-rlist__text' });
				tx.createSpan({ cls: 'ws-rlist__name', text: t.label });
				tx.createSpan({ cls: 'ws-rlist__reads', text: t.symmetric ? `${t.forwardLabel} ⇄` : `${t.forwardLabel} · ${t.reverseLabel}` });
				const n = counts.get(t.id) ?? 0;
				if (n) item.createSpan({ cls: 'ws-rlist__n', text: String(n) });
				else if (!t.origin) item.createSpan({ cls: 'ws-rlist__badge', text: 'Yours' });
				item.addEventListener('click', () => this.select(t.id));
			}
		}
	}

	private card(parent: HTMLElement, title: string, hint?: string, ic?: string): HTMLElement {
		const c = parent.createEl('section', { cls: 'ws-rcard' });
		const h = c.createDiv({ cls: 'ws-rcard__head' });
		if (ic) icon(h, ic, 'ws-rcard__icon');
		const t = h.createDiv();
		t.createDiv({ cls: 'ws-rcard__title', text: title });
		if (hint) t.createDiv({ cls: 'ws-rcard__hint', text: hint });
		return c.createDiv({ cls: 'ws-rcard__body' });
	}

	private renderMain(resetScroll = false): void {
		const el = this.mainEl;
		const scroller = el.closest('.ws-shell__page');
		const scroll = scroller?.scrollTop ?? 0;
		el.empty();
		const R = this.s.relations;
		const t = R.type(this.typeId);
		if (!t) {
			emptyState(el, { icon: 'waypoints', title: 'No relationships yet', actionLabel: 'New relationship', onAction: () => void this.create() });
			return;
		}
		const usage = R.typeUsage(t.id, this.s.schemas.list());
		const update = (patch: RelationTypePatch) => {
			try {
				R.updateType(t.id, patch);
			} catch (e) {
				new Notice(e instanceof Error ? e.message : String(e));
			}
		};
		const tint = `ws-tint--${t.color ?? 'cyan'}`;

		// ── Hero: icon, name, category, what it is.
		const hero = el.createDiv({ cls: cx('ws-rhero', tint) });
		const m = hero.createEl('button', { cls: 'ws-rhero__mark', attr: { type: 'button', 'aria-label': 'Change icon' } });
		setIcon(m, t.icon ?? 'link-2');
		m.addEventListener('click', () => new IconPickerModal(this.ctx.ws.app, (id) => update({ icon: id })).open());
		const ht = hero.createDiv({ cls: 'ws-rhero__text' });
		inlineText(ht, t.label, { cls: 'ws-rhero__name', ariaLabel: 'Name', onCommit: (v) => v.trim() && update({ label: v.trim() }) });
		const meta = ht.createDiv({ cls: 'ws-rhero__meta' });
		inlineText(meta, t.category, { cls: 'ws-rhero__cat', ariaLabel: 'Category', onCommit: (v) => update({ category: v.trim() || 'Custom' }) });
		meta.createSpan({ cls: 'ws-rhero__dot', text: '·' });
		meta.createSpan({ text: `${usage.edges} connection${usage.edges === 1 ? '' : 's'}` });
		meta.createSpan({ cls: 'ws-rhero__dot', text: '·' });
		meta.createSpan({ text: `used by ${usage.fields.length} field${usage.fields.length === 1 ? '' : 's'}` });
		if (!t.origin) meta.createSpan({ cls: 'ws-rlist__badge', text: 'Yours' });
		inlineText(ht, t.description ?? '', { cls: 'ws-rhero__desc', multiline: true, ariaLabel: 'Description', placeholder: 'What this relationship means in your world…', onCommit: (v) => update({ description: v.trim() || undefined }) });

		const grid = el.createDiv({ cls: 'ws-rgrid' });

		// ── How it reads: a picture of the two sides, then the words.
		const reads = this.card(grid, 'How it reads', 'What each entry calls the other in its Connections.', 'book-open-text');
		reads.parentElement?.addClass('ws-rcard--wide');
		const names = (ids: string[]) => ids.map((id) => this.s.schemas.get(id)).filter((x): x is NonNullable<typeof x> => !!x);
		const from = names(t.sourceTypes);
		const to = names(t.targetTypes);
		const example = R.allEdges().find((e) => e.type === t.id);
		const ea = example ? this.s.entities.get(example.from) : undefined;
		const eb = example ? this.s.entities.get(example.to) : undefined;
		const diagram = reads.createDiv({ cls: cx('ws-rdiag', tint, t.symmetric && 'is-sym') });
		const node = (side: typeof from, entity: typeof ea, fallback: string) => {
			const n = diagram.createDiv({ cls: 'ws-rdiag__node' });
			const sc = entity ? this.s.schemas.get(entity.typeId) : side[0];
			const g = n.createDiv({ cls: cx('ws-rdiag__glyph', sc?.color && `ws-tint--${sc.color}`) });
			setIcon(g, sc?.icon ?? 'circle-dashed');
			n.createDiv({ cls: 'ws-rdiag__name', text: entity?.name ?? (side.length ? side.map((x) => x.singular).join(' / ') : fallback) });
			n.createDiv({ cls: 'ws-rdiag__kind', text: entity ? 'example' : side.length ? 'usually' : 'any entry' });
		};
		node(from, ea, 'Entry');
		const link = diagram.createDiv({ cls: 'ws-rdiag__link' });
		if (t.symmetric) {
			const l = link.createDiv({ cls: 'ws-rdiag__line is-both' });
			l.createSpan({ cls: 'ws-rdiag__label', text: t.forwardLabel });
		} else {
			const top = link.createDiv({ cls: 'ws-rdiag__line is-fwd' });
			top.createSpan({ cls: 'ws-rdiag__label', text: t.forwardLabel });
			const bot = link.createDiv({ cls: 'ws-rdiag__line is-rev' });
			bot.createSpan({ cls: 'ws-rdiag__label', text: t.reverseLabel });
		}
		node(to, eb, 'Entry');
		const a = ea?.name ?? (from[0] ? `A ${from[0].singular.toLowerCase()}` : 'One entry');
		const b = eb?.name ?? (to[0] ? `a ${to[0].singular.toLowerCase()}` : 'the other');
		const sent = reads.createDiv({ cls: 'ws-rdiag__sentences' });
		const sentence = (text: string, ic: string) => {
			const r = sent.createDiv({ cls: 'ws-rdiag__sentence' });
			icon(r, ic);
			r.createSpan({ text });
		};
		const same = !ea && from[0] && to[0] && from[0].id === to[0].id;
		if (t.symmetric) sentence(same ? `Two ${from[0]!.plural.toLowerCase()} each list the other under “${t.forwardLabel}”.` : `${a} and ${b} each list the other under “${t.forwardLabel}”.`, 'repeat');
		else {
			sentence(`${a}’s page lists ${eb?.name ?? 'them'} under “${t.forwardLabel}”.`, 'arrow-right');
			sentence(`${eb?.name ?? b.replace(/^a /, 'The ')}’s page lists ${ea?.name ?? 'them'} under “${t.reverseLabel}”.`, 'arrow-left');
		}
		const words = reads.createDiv({ cls: 'ws-rwords' });
		const w = (label: string, hint: string) => {
			const box = words.createDiv({ cls: 'ws-rwords__item' });
			box.createDiv({ cls: 'ws-rwords__label', text: label });
			const v = box.createDiv({ cls: 'ws-rwords__value' });
			box.createDiv({ cls: 'ws-rwords__hint', text: hint });
			return v;
		};
		toggle(w('Same from both sides', 'Friends, allies, rivals'), t.symmetric, (v) => update({ symmetric: v }), 'Goes both ways');
		if (t.symmetric) inlineText(w('Both list it as', 'The heading on each entry'), t.forwardLabel, { cls: 'ws-input-like', ariaLabel: 'Listed as', onCommit: (v) => update({ forwardLabel: v }) });
		else {
			inlineText(w(`${from[0]?.singular ?? 'One side'} lists`, 'e.g. a mentor lists “Students”'), t.forwardLabel, { cls: 'ws-input-like', ariaLabel: 'Forward label', onCommit: (v) => update({ forwardLabel: v }) });
			inlineText(w(`${to[0]?.singular ?? 'The other side'} lists`, 'e.g. a student lists “Mentors”'), t.reverseLabel, { cls: 'ws-input-like', ariaLabel: 'Reverse label', onCommit: (v) => update({ reverseLabel: v }) });
		}

		// ── Who it connects.
		const kinds = this.card(grid, 'Usually connects', 'Suggestions for pickers — any two entries can still be linked.', 'shapes');
		const kr = kinds.createDiv({ cls: 'ws-rconnects' });
		const side = (label: string, ids: string[], set: (next: string[]) => void) => {
			const c = kr.createDiv({ cls: 'ws-rconnects__side' });
			c.createDiv({ cls: 'ws-rwords__label', text: label });
			typePicker(c, this.s, ids, set, 'Any kind');
		};
		side(t.symmetric ? 'Entries of kind' : 'From', t.sourceTypes, (next) => update({ sourceTypes: next }));
		side(t.symmetric ? 'With' : 'To', t.targetTypes, (next) => update({ targetTypes: next }));

		// ── Details on each connection.
		this.renderProps(this.card(grid, 'Details on each connection', 'Every connection has status, strength, secret, dates and notes. Add your own (e.g. Trust, Oath sworn).', 'list-plus'), t, update);

		// ── In use.
		const used = this.card(grid, 'In use', undefined, 'activity');
		if (!usage.fields.length && !usage.edges) used.createDiv({ cls: 'ws-rcard__empty', text: 'Nothing uses this relationship yet.' });
		for (const u of usage.fields) {
			const r = used.createEl('button', { cls: 'ws-rels__use', attr: { type: 'button' } });
			icon(r, u.schema.icon);
			r.createSpan({ text: `${u.schema.plural} → ${u.field.label}` });
			icon(r, 'arrow-up-right', 'ws-rels__use-go');
			const section = u.schema.sections.find((x) => x.fieldIds.includes(u.field.id));
			r.addEventListener('click', () => this.ctx.navigate(ROUTES.typeStudio(u.schema.id, { tab: 'fields', section: section?.id })));
		}
		const edges = R.allEdges().filter((e) => e.type === t.id);
		for (const e of edges.slice(0, 5)) {
			const x = this.s.entities.get(e.from);
			const y = this.s.entities.get(e.to);
			if (!x || !y) continue;
			const r = used.createEl('button', { cls: 'ws-rels__use ws-rels__edge', attr: { type: 'button' } });
			r.createSpan({ text: x.name });
			icon(r, t.symmetric ? 'arrow-left-right' : 'arrow-right', 'ws-rels__edge-arrow');
			r.createSpan({ text: y.name });
			r.addEventListener('click', () => this.ctx.navigate(ROUTES.entity(x.id)));
		}
		if (edges.length > 5) used.createDiv({ cls: 'ws-rcard__empty', text: `and ${edges.length - 5} more — see Connections on each entry.` });

		// ── Manage.
		const danger = el.createDiv({ cls: 'ws-rdanger' });
		const inUse = usage.edges > 0 || usage.fields.length > 0;
		const dt = danger.createDiv({ cls: 'ws-rdanger__text' });
		dt.createDiv({ cls: 'ws-rdanger__title', text: 'Delete this relationship' });
		dt.createDiv({ cls: 'ws-rcard__hint', text: inUse ? 'Available once no connections or fields use it — nothing is ever removed silently.' : 'It isn’t used anywhere, so nothing else changes.' });
		button(danger, {
			label: 'Delete',
			icon: 'trash-2',
			variant: 'danger',
			size: 'sm',
			disabled: inUse,
			onClick: () => {
				try {
					const removed = R.deleteType(t.id, this.s.schemas.list());
					actionNotice(`Deleted “${removed.label}”.`, { label: 'Undo', run: () => R.restoreType(removed) });
				} catch (e) {
					new Notice(e instanceof Error ? e.message : String(e));
				}
			},
		});

		if (scroller) scroller.scrollTop = resetScroll ? 0 : scroll;
	}

	private renderProps(g: HTMLElement, t: RelationType, update: (p: RelationTypePatch) => void): void {
		const list = g.createDiv({ cls: 'ws-rels__props' });
		const fields = t.fields;
		const save = (next: FieldDefinition[]) => update({ fields: next });
		fields.forEach((f, i) => {
			const kind = this.ctx.ws.fieldTypes.for(f);
			const r = list.createDiv({ cls: 'ws-rels__prop' });
			const k = r.createSpan({ cls: 'ws-frow-item__kind' });
			setIcon(k, kind.icon);
			inlineText(r, f.label, {
				cls: 'ws-rels__prop-label',
				ariaLabel: 'Property name',
				onCommit: (v) => save(fields.map((x, j) => (j === i ? { ...x, label: v.trim() || x.label } : x))),
			});
			r.createSpan({ cls: 'ws-rels__prop-kind', text: kind.label });
			button(r, {
				icon: 'x',
				variant: 'quiet',
				size: 'sm',
				tooltip: 'Remove property (values are kept)',
				onClick: () => {
					const prev = fields;
					save(fields.filter((_, j) => j !== i));
					actionNotice(`Removed “${f.label}”. Its values stay on each connection.`, { label: 'Undo', run: () => update({ fields: prev }) });
				},
			});
		});
		const add = g.createDiv();
		button(add, {
			label: 'Add property',
			icon: 'plus',
			variant: 'ghost',
			size: 'sm',
			onClick: (evt) => {
				const menu = new Menu();
				for (const id of PROP_KINDS) {
					const kind = this.ctx.ws.fieldTypes.get(id);
					if (!kind) continue;
					menu.addItem((i) =>
						i
							.setTitle(kind.label)
							.setIcon(kind.icon)
							.onClick(async () => {
								const name = await promptModal(this.ctx.ws.app, { title: `New ${kind.label.toLowerCase()} property`, label: 'Name', placeholder: 'e.g. Trust', confirmLabel: 'Add' });
								if (!name?.trim()) return;
								const def: FieldDefinition = { id: slugId(name, fields.map((x) => x.id)), type: id, label: name.trim() };
								if (kind.defaultWidth) def.width = kind.defaultWidth;
								if (id === 'rating') def.config = { max: 5 };
								save([...fields, def]);
							}),
					);
				}
				menu.showAtMouseEvent(evt);
			},
		});
	}
}
