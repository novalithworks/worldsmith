import { setIcon } from 'obsidian';
import type { EntityRecord, EntitySchema } from '../../core/types';
import type { WorldSession } from '../../services/WorldSession';
import { avatar } from './avatar';
import { cx, nameRegion, revealInList, isSheet } from './dom';

export interface EntityPickerOptions {
	session: WorldSession;
	app: import('obsidian').App;
	/** Allowed types; empty = any. */
	typeIds?: string[];
	exclude?: Set<string>;
	placeholder?: string;
	/** Offer "Create “…”" for these types (defaults to `typeIds`; empty list disables). */
	createTypes?: string[];
	onPick(entity: EntityRecord, evt: MouseEvent | KeyboardEvent): void;
	onClose?(): void;
}

interface Row {
	kind: 'entity' | 'create';
	entity?: EntityRecord;
	schema?: EntitySchema;
	name?: string;
}

const LIMIT = 8;

/**
 * Inline search-and-pick popover for linking entries. Attaches to the Worldsmith pane
 * (so it inherits the scoped styles), positions under its anchor and flips upward when
 * there's no room. Keyboard: ↑/↓, Enter, Escape.
 */
export class EntityPicker {
	private el: HTMLElement;
	private nameEl: HTMLElement;
	private input: HTMLInputElement;
	private list: HTMLElement;
	private rows: Row[] = [];
	private active = 0;
	private cleanup: Array<() => void> = [];
	private closed = false;

	constructor(
		private readonly anchor: HTMLElement,
		private readonly o: EntityPickerOptions,
	) {
		const host = anchor.closest('.worldsmith, .worldsmith-modal .modal-content') ?? anchor.ownerDocument.body;
		this.el = (host as HTMLElement).createDiv({ cls: 'ws-picker', attr: { role: 'dialog'} });
		this.nameEl = nameRegion(this.el, o.placeholder ?? 'Link an entry');
		const bar = this.el.createDiv({ cls: 'ws-picker__bar' });
		const ic = bar.createSpan({ cls: 'ws-picker__search-icon' });
		setIcon(ic, 'search');
		this.input = bar.createEl('input', {
			cls: 'ws-picker__input',
			attr: { type: 'text', placeholder: o.placeholder ?? 'Search entries…', 'aria-autocomplete': 'list', spellcheck: 'false' },
		});
		this.list = this.el.createDiv({ cls: 'ws-picker__list', attr: { role: 'listbox' } });

		this.input.addEventListener('input', () => this.refresh());
		this.input.addEventListener('keydown', (e) => this.onKey(e));
		const doc = anchor.ownerDocument;
		const outside = (e: Event) => {
			if (!this.el.contains(e.target as Node) && !anchor.contains(e.target as Node)) this.close();
		};
		doc.addEventListener('mousedown', outside, true);
		doc.addEventListener('touchstart', outside, true);
		const reposition = () => this.position();
		doc.defaultView?.addEventListener('resize', reposition);
		doc.addEventListener('scroll', reposition, true);
		this.cleanup.push(
			() => doc.removeEventListener('mousedown', outside, true),
			() => doc.removeEventListener('touchstart', outside, true),
			() => doc.defaultView?.removeEventListener('resize', reposition),
			() => doc.removeEventListener('scroll', reposition, true),
		);
		this.refresh();
		this.position();
		window.setTimeout(() => this.input.focus({ preventScroll: true }), 0);
	}

	close(): void {
		if (this.closed) return;
		this.closed = true;
		for (const c of this.cleanup) c();
		this.el.remove();
		this.nameEl.remove();
		this.o.onClose?.();
	}

	private position(): void {
		if (isSheet(this.el)) {
			this.el.setCssStyles({ top: '', left: '', width: '' });
			return;
		}
		const host = this.el.parentElement as HTMLElement;
		const hr = host.getBoundingClientRect();
		const ar = this.anchor.getBoundingClientRect();
		const width = Math.min(340, hr.width - 16);
		let left = ar.left - hr.left;
		left = Math.max(8, Math.min(left, hr.width - width - 8));
		this.el.style.width = `${width}px`;
		this.el.style.left = `${left}px`;
		const h = this.el.offsetHeight || 300;
		const below = hr.bottom - ar.bottom;
		const up = below < h + 12 && ar.top - hr.top > below;
		this.el.toggleClass('is-above', up);
		this.el.style.top = up ? `${ar.top - hr.top - h - 6}px` : `${ar.bottom - hr.top + 6}px`;
	}

	private refresh(): void {
		const s = this.o.session;
		const q = this.input.value.trim();
		const types = this.o.typeIds ?? [];
		const hits = s.search.search(q, { limit: 200 });
		const entities = hits
			.map((h) => h.entity)
			.filter((e) => (!types.length || types.includes(e.typeId)) && !this.o.exclude?.has(e.id))
			.slice(0, LIMIT);
		this.rows = entities.map((entity) => ({ kind: 'entity', entity, schema: s.schemas.get(entity.typeId) }));
		const createTypes = this.o.createTypes ?? types;
		if (q && createTypes.length) {
			const exact = entities.some((e) => e.name.toLowerCase() === q.toLowerCase());
			if (!exact) {
				for (const id of createTypes.slice(0, 3)) {
					const schema = s.schemas.get(id);
					if (schema) this.rows.push({ kind: 'create', schema, name: q });
				}
			}
		}
		this.active = Math.min(this.active, Math.max(0, this.rows.length - 1));
		this.paint();
	}

	private paint(): void {
		this.list.empty();
		if (!this.rows.length) {
			this.list.createDiv({
				cls: 'ws-picker__empty',
				text: this.input.value.trim() ? 'Nothing matches.' : 'No entries of this kind yet. Type a name to create one.',
			});
			this.position();
			return;
		}
		const multiType = new Set(this.rows.filter((r) => r.kind === 'entity').map((r) => r.entity?.typeId)).size > 1 || !(this.o.typeIds ?? []).length;
		this.rows.forEach((r, i) => {
			const item = this.list.createDiv({
				cls: cx('ws-picker__item', i === this.active && 'is-active', r.kind === 'create' && 'is-create'),
				attr: { role: 'option', 'aria-selected': String(i === this.active), id: `ws-pick-${i}` },
			});
			if (r.kind === 'entity' && r.entity) {
				avatar(item, this.o.app, r.entity, r.schema, { size: 'xs' });
				const t = item.createDiv({ cls: 'ws-picker__text' });
				t.createDiv({ cls: 'ws-picker__name', text: r.entity.name });
				const sub = [multiType ? r.schema?.singular : '', this.o.session.entityService.subtitle(r.entity)].filter(Boolean).join(' • ');
				if (sub) t.createDiv({ cls: 'ws-picker__meta', text: sub });
			} else {
				const plus = item.createSpan({ cls: 'ws-picker__plus' });
				setIcon(plus, 'plus');
				const t = item.createDiv({ cls: 'ws-picker__text' });
				t.createDiv({ cls: 'ws-picker__name', text: `Create “${r.name}”` });
				t.createDiv({ cls: 'ws-picker__meta', text: `New ${r.schema?.singular.toLowerCase() ?? 'entry'}` });
			}
			item.addEventListener('mousemove', () => {
				if (this.active === i) return;
				this.active = i;
				this.highlight();
			});
			item.addEventListener('mousedown', (e) => e.preventDefault());
			item.addEventListener('click', (e) => this.choose(i, e));
		});
		this.input.setAttr('aria-activedescendant', `ws-pick-${this.active}`);
		this.position();
	}

	private highlight(): void {
		Array.from(this.list.children).forEach((c, i) => {
			c.toggleClass('is-active', i === this.active);
			c.setAttr('aria-selected', String(i === this.active));
		});
		this.input.setAttr('aria-activedescendant', `ws-pick-${this.active}`);
		const row = this.list.children[this.active] as HTMLElement | undefined;
		if (row) revealInList(this.list, row);
	}

	private onKey(e: KeyboardEvent): void {
		if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
			e.preventDefault();
			if (!this.rows.length) return;
			this.active = (this.active + (e.key === 'ArrowDown' ? 1 : -1) + this.rows.length) % this.rows.length;
			this.highlight();
		} else if (e.key === 'Enter') {
			e.preventDefault();
			this.choose(this.active, e);
		} else if (e.key === 'Escape') {
			e.preventDefault();
			e.stopPropagation();
			this.close();
			this.anchor.focus();
		} else if (e.key === 'Tab') {
			this.close();
		}
	}

	private choose(i: number, evt: MouseEvent | KeyboardEvent): void {
		const r = this.rows[i];
		if (!r) return;
		let entity = r.entity;
		if (r.kind === 'create' && r.schema && r.name) {
			entity = this.o.session.entityService.create(r.schema.id, { name: r.name });
		}
		if (!entity) return;
		this.close();
		this.o.onPick(entity, evt);
	}
}
