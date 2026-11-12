import { Menu } from 'obsidian';
import { avatar } from '../components/avatar';
import { entityChip, worldFields } from './worldLinks';
import { renderPassesSection, renderSnapshotsSection } from './revision';
import type { ManuscriptItem } from '../../core/types';
import { debounce } from '../../core/util/async';
import { autoGrow, button, cx, icon } from '../components/dom';
import { itemMenu, mergeWithNext, nextScene, openNote, setStatus, toggleThread } from './actions';
import { statusFor } from './boards';
import { describeWhen, ThreadsModal, WhenModal } from './planDialogs';
import { busyScenes, MoveToModal, SplitModal } from './dialogs';
import { bar, caps, fmt, type Studio } from './kit';
import { count, itemWord } from './model';

/*
 * The inspector beside the writing page (WS3): the scene's details on a "Scene" tab
 * (status, synopsis, words and target, its note, split / merge / move) and the writer's
 * own notes about it on a "Notes" tab. The notes are kept in Worldsmith's data, never in
 * the scene's note. Text boxes only save what the person typed: an untouched box never
 * writes, so a change made elsewhere (an undo, another pane) is never written back over.
 */

/** A text box's pending save, flushed when another one takes over or the page goes. */
export interface FlushSlot {
	flush: (() => void) | null;
}

/**
 * A text field of an item that saves a moment after typing stops and on leaving it, only
 * when the person typed in it.
 */
export function itemTextField(
	parent: HTMLElement,
	st: Studio,
	it: ManuscriptItem,
	o: { key: 'synopsis' | 'notes'; cls: string; placeholder: string; label: string; slot: FlushSlot; rows?: number; onBlur?: () => void },
): HTMLTextAreaElement {
	const id = `ws-wr-${o.key}-${it.id}-${Math.random().toString(36).slice(2, 7)}`;
	parent.createEl('label', { cls: 'ws-wr-caps ws-wr-sheet__label', text: o.label, attr: { for: id } });
	const ta = parent.createEl('textarea', { cls: o.cls, attr: { id, rows: String(o.rows ?? 2), placeholder: o.placeholder } });
	ta.value = it[o.key];
	autoGrow(ta);
	let dirty = false;
	const save = () => {
		if (!dirty) return;
		dirty = false;
		const cur = st.w.item(it.id);
		if (cur && cur[o.key] !== ta.value) st.w.update(it.id, { [o.key]: ta.value });
	};
	const later = debounce(save, 700);
	// One saver at a time per slot: the one shown before is flushed first.
	o.slot.flush?.();
	const flush = () => {
		later.cancel();
		if (o.slot.flush === flush) o.slot.flush = null;
		save();
	};
	o.slot.flush = flush;
	ta.addEventListener('input', () => {
		dirty = true;
		later();
	});
	ta.addEventListener('blur', () => {
		later.cancel();
		save();
		o.onBlur?.();
	});
	return ta;
}

export type InspectorTab = 'scene' | 'notes' | 'world';

export class Inspector {
	readonly el: HTMLElement;
	private bodyEl: HTMLElement;
	private tabsEl: HTMLElement;
	private item: ManuscriptItem | null = null;
	private stale = false;
	private slot: FlushSlot = { flush: null };

	constructor(
		private readonly st: Studio,
		parent: HTMLElement,
		private tab: InspectorTab,
		private readonly o: {
			onTab: (t: InspectorTab) => void;
			/** Words in the open page right now (the note may not be saved yet). */
			liveWords: (it: ManuscriptItem) => number | null;
			onSelect: (id: string) => void;
		},
	) {
		this.el = parent.createDiv({ cls: 'ws-wr-insp' });
		this.tabsEl = this.el.createDiv({ cls: 'ws-wr-insp__tabs', attr: { role: 'tablist', 'aria-label': 'Inspector' } });
		this.bodyEl = this.el.createDiv({ cls: 'ws-wr-insp__body' });
		st.component.register(() => this.slot.flush?.());
	}

	/** Show an item (null = nothing selected). Waits while something in it is being typed. */
	show(it: ManuscriptItem | null, force = false): void {
		const a = activeDocument.activeElement;
		const typing = this.bodyEl.contains(a) && (a instanceof HTMLTextAreaElement || a instanceof HTMLInputElement);
		const same = it?.id === this.item?.id;
		this.item = it;
		if (typing && same && !force) {
			this.stale = true;
			// The word count isn't something being typed: keep it current.
			this.paintWords();
			return;
		}
		this.render();
	}

	private render(): void {
		this.stale = false;
		const it = this.item;
		this.tabsEl.empty();
		const tabs: Array<[InspectorTab, string]> = [
			['scene', it ? itemWord(it.kind) : 'Scene'],
			['notes', 'Notes'],
			// 0.28: the world of the scene (its people and place) beside the writing.
			...(it?.kind === 'scene' ? ([['world', 'World']] as Array<[InspectorTab, string]>) : []),
		];
		for (const [id, label] of tabs) {
			const on = this.tab === id;
			const b = this.tabsEl.createEl('button', { cls: cx('ws-wr-insp__tab', on && 'is-active'), text: label, attr: { type: 'button', role: 'tab', 'aria-selected': String(on), 'data-tab': id } });
			b.addEventListener('click', () => {
				if (this.tab === id) return;
				this.slot.flush?.();
				this.tab = id;
				this.o.onTab(id);
				this.render();
			});
		}
		const b = this.bodyEl;
		b.empty();
		if (!it) {
			b.createDiv({ cls: 'ws-wr-muted ws-wr-insp__empty', text: 'Choose a scene in Contents.' });
			return;
		}
		if (this.tab === 'notes') this.renderNotes(b, it);
		else if (this.tab === 'world' && it.kind === 'scene') this.renderWorld(b, it);
		else if (it.kind === 'scene') this.renderScene(b, it);
		else this.renderGroup(b, it);
	}

	private afterBlur = () => {
		if (this.stale) window.setTimeout(() => !this.bodyEl.contains(activeDocument.activeElement) && this.render(), 0);
	};

	private renderNotes(b: HTMLElement, it: ManuscriptItem): void {
		const f = b.createDiv({ cls: 'ws-wr-insp__field' });
		itemTextField(f, this.st, it, {
			key: 'notes',
			cls: 'ws-wr-itemnotes',
			label: `Notes on this ${it.kind}`,
			placeholder: 'Reminders, questions, things to fix…',
			rows: 8,
			slot: this.slot,
			onBlur: this.afterBlur,
		});
		f.createDiv({ cls: 'ws-wr-sheet__help', text: 'Kept in Worldsmith, never written into the note.' });
	}

	/** The entry in focus on the World tab (one of the scene's people or its place). */
	private worldPick: string | null = null;

	private renderWorld(b: HTMLElement, it: ManuscriptItem): void {
		const st = this.st;
		const s = st.s;
		const ids = [...new Set([...(it.pov ? [it.pov] : []), ...it.cast, ...(it.location ? [it.location] : [])])].filter((id) => s.entities.get(id) && !s.entities.get(id)!.trashedAt);
		if (!ids.length) {
			b.createDiv({ cls: 'ws-wr-muted ws-wr-insp__empty', text: 'Choose the scene’s point of view, who’s in it and where it happens (on the Scene tab): their profiles show here, beside your writing.' });
			return;
		}
		if (!this.worldPick || !ids.includes(this.worldPick)) this.worldPick = ids[0]!;
		const chips = b.createDiv({ cls: 'ws-wr-wtab__chips', attr: { role: 'tablist', 'aria-label': 'People and place in this scene' } });
		for (const id of ids) {
			const e = s.entities.get(id)!;
			const on = id === this.worldPick;
			const c = chips.createEl('button', { cls: cx('ws-wr-wtab__chip', on && 'is-active'), attr: { type: 'button', role: 'tab', 'aria-selected': String(on), 'data-entity': id } });
			avatar(c, st.ws.app, e, s.schemas.get(e.typeId), { size: 'xs' });
			c.createSpan({ text: e.name.split(' ')[0] ?? e.name });
			c.addEventListener('click', () => {
				this.worldPick = id;
				this.render();
			});
		}
		const e = s.entities.get(this.worldPick)!;
		const schema = s.schemas.get(e.typeId);
		const head = b.createDiv({ cls: 'ws-wr-wtab__head' });
		avatar(head, st.ws.app, e, schema, { shape: 'arch', size: 'lg' });
		const t = head.createDiv({ cls: 'ws-wr-wtab__who' });
		if (schema) t.createDiv({ cls: 'ws-wr-wtab__type', text: schema.singular });
		t.createDiv({ cls: 'ws-wr-wtab__name', text: e.name });
		// A short line under the name: the first two short values (role, nation…).
		const shortVals: string[] = [];
		const longs: Array<{ label: string; text: string }> = [];
		const plain = (v: unknown): string => {
			if (typeof v === 'string') return v.replace(/[#*_>`]/g, '').trim();
			if (typeof v === 'number') return String(v);
			if (Array.isArray(v)) return v.map((x) => (typeof x === 'string' ? (s.entities.get(x)?.name ?? x) : '')).filter(Boolean).join(', ');
			return '';
		};
		for (const f of schema?.fields ?? []) {
			const raw = e.values[f.id];
			const v = f.type === 'relation' || f.type === 'entity' ? plain(Array.isArray(raw) ? raw : raw ? [raw] : []) : plain(raw);
			if (!v) continue;
			if (v.length <= 32 && shortVals.length < 2 && !/text|markdown|rich/.test(f.type)) shortVals.push(v);
			else if (v.length > 32 || /text|markdown|rich/.test(f.type)) longs.push({ label: f.label, text: v });
		}
		if (shortVals.length) t.createDiv({ cls: 'ws-wr-wtab__sub', text: shortVals.join(' · ') });
		if (e.description) longs.unshift({ label: 'Summary', text: e.description });
		for (const l of longs.slice(0, 6)) {
			const f = b.createDiv({ cls: 'ws-wr-insp__field ws-wr-wtab__field' });
			caps(f, l.label, 'ws-wr-sheet__label');
			f.createDiv({ cls: 'ws-wr-wtab__text', text: l.text.length > 320 ? `${l.text.slice(0, 320)}…` : l.text });
		}
		// Relationships with the others in this scene.
		const others = new Set(ids.filter((x) => x !== e.id));
		const rels = s.stores.edges.all().filter((x) => (x.from === e.id && others.has(x.to)) || (x.to === e.id && others.has(x.from)));
		if (rels.length) {
			const f = b.createDiv({ cls: 'ws-wr-insp__field ws-wr-wtab__rels' });
			caps(f, 'Relationships in this scene', 'ws-wr-sheet__label');
			for (const r of rels) {
				const otherId = r.from === e.id ? r.to : r.from;
				const type = s.relations.types().find((x) => x.id === r.type);
				const label = type ? (r.from === e.id ? type.forwardLabel || type.label : type.reverseLabel || type.label) : '';
				const row = f.createDiv({ cls: 'ws-wr-wtab__rel' });
				entityChip(row, st, otherId);
				row.createSpan({ cls: 'ws-wr-muted', text: [label, r.notes].filter(Boolean).join(' · ') });
			}
		}
		const open = b.createDiv({ cls: 'ws-wr-sheet__actions' });
		button(open, { label: `Open ${e.name.split(' ')[0]}’s page`, icon: 'arrow-up-right', variant: 'ghost', size: 'sm', cls: 'ws-wr-wtab__open', onClick: () => void st.ws.open({ name: 'entity', params: { id: e.id } }, { newLeaf: 'tab' }) });
	}

	private renderGroup(b: HTMLElement, it: ManuscriptItem): void {
		const f = b.createDiv({ cls: 'ws-wr-insp__field' });
		caps(f, 'Words', 'ws-wr-sheet__label');
		f.createDiv({ cls: 'ws-wr-insp__big', text: fmt(this.st.w.wordCount(it.id)) });
		f.createDiv({ cls: 'ws-wr-muted', text: count(this.st.w.scenesIn(it.id).length, 'scene') });
	}

	private renderScene(b: HTMLElement, it: ManuscriptItem): void {
		const p = this.st.project!;
		const st = this.st;
		const wf = worldFields(st, it);
		// Summary first (the design's order).
		itemTextField(b.createDiv({ cls: 'ws-wr-insp__field' }), st, it, {
			key: 'synopsis',
			cls: 'ws-wr-synopsis',
			label: 'Summary',
			placeholder: 'What happens in this scene?',
			slot: this.slot,
			onBlur: this.afterBlur,
		});
		// Point of view and status, side by side.
		const pair = b.createDiv({ cls: 'ws-wr-insp__pair' });
		wf.pov(pair);
		const status = pair.createDiv({ cls: 'ws-wr-insp__field' });
		caps(status, 'Status', 'ws-wr-sheet__label');
		const known = statusFor(p, it.status);
		const sp = status.createEl('button', { cls: cx('ws-wr-insp__status', `ws-tint--${known.color}`, !known.known && 'is-unknown'), attr: { type: 'button', 'aria-haspopup': 'menu', 'aria-label': `Status: ${known.label}. Change`, 'data-status': it.status } });
		sp.createSpan({ cls: 'ws-wr-dot' });
		sp.createSpan({ text: known.known ? known.label : 'No status' });
		sp.addEventListener('click', (e) => {
			const m = new Menu();
			for (const s of p.statuses) m.addItem((i) => i.setTitle(s.label).setChecked(it.status === s.id).onClick(() => setStatus(st, it, s.id)));
			m.showAtMouseEvent(e);
		});
		wf.location(b);
		const when = b.createDiv({ cls: 'ws-wr-insp__field' });
		caps(when, 'When', 'ws-wr-sheet__label');
		button(when, { label: it.date ? describeWhen(it.date, it.time) : 'Set a date…', icon: 'calendar-clock', variant: 'ghost', size: 'sm', cls: 'ws-wr-insp__when', onClick: () => new WhenModal(st, it).open() });
		itemTextField(b.createDiv({ cls: 'ws-wr-insp__field' }), st, it, {
			key: 'purpose',
			cls: 'ws-wr-purpose',
			label: 'Purpose',
			placeholder: 'What this scene does for the story',
			slot: this.slot,
			onBlur: this.afterBlur,
		});
		wf.cast(b);
		// WS4: plot threads (the scene's are chips; others can be added).
		const th = b.createDiv({ cls: 'ws-wr-insp__field' });
		caps(th, 'Plot threads', 'ws-wr-sheet__label');
		const tchips = th.createDiv({ cls: 'ws-wr-statuses ws-wr-insp__threads', attr: { role: 'group', 'aria-label': 'Plot threads' } });
		for (const t of p.threads) {
			const on = it.threads.includes(t.id);
			const c = tchips.createEl('button', { cls: cx('ws-wr-status', `ws-tint--${t.color ?? 'gray'}`, on && 'is-active'), attr: { type: 'button', 'aria-pressed': String(on), 'data-thread': t.id } });
			c.createSpan({ cls: 'ws-wr-dot' });
			c.createSpan({ text: t.label });
			c.addEventListener('click', () => toggleThread(st, it, t.id));
		}
		const addT = tchips.createEl('button', { cls: 'ws-wr-status ws-wr-insp__addthread', attr: { type: 'button' }, text: p.threads.length ? 'Edit…' : '+ New plot thread' });
		addT.addEventListener('click', () => new ThreadsModal(st, p, { addOne: !p.threads.length }).open());
		// WS6: revision passes and snapshots.
		renderPassesSection(b, st, it);
		renderSnapshotsSection(b, st, it);

		const words = b.createDiv({ cls: 'ws-wr-insp__field ws-wr-insp__words' });
		caps(words, 'Words', 'ws-wr-sheet__label');
		words.createDiv({ cls: 'ws-wr-insp__wordsbox' });
		this.paintWords();
		const tgt = words.createDiv({ cls: 'ws-wr-insp__target' });
		const tid = `ws-wr-target-${it.id}`;
		tgt.createEl('label', { text: 'Target', attr: { for: tid } });
		const inp = tgt.createEl('input', { cls: 'ws-wr-target', attr: { id: tid, type: 'number', min: '0', step: '100', inputmode: 'numeric', placeholder: 'None' } });
		inp.value = it.wordTarget ? String(it.wordTarget) : '';
		let typed = false;
		inp.addEventListener('input', () => (typed = true));
		inp.addEventListener('change', () => {
			if (!typed) return;
			typed = false;
			const n = Math.round(Number(inp.value));
			const next = inp.value.trim() && Number.isFinite(n) && n > 0 ? n : null;
			const cur = st.w.item(it.id);
			if (cur && cur.wordTarget !== next) st.w.update(it.id, { wordTarget: next });
		});

		const note = b.createDiv({ cls: 'ws-wr-insp__field' });
		caps(note, 'Note', 'ws-wr-sheet__label');
		const state = st.w.noteState(it.id);
		const path = it.notePath;
		const line = note.createDiv({ cls: cx('ws-wr-insp__note', `is-${state}`) });
		icon(line, state === 'ok' ? 'file-text' : state === 'missing' ? 'alert-triangle' : 'file-question');
		line.createSpan({ text: state === 'ok' && path ? path : state === 'missing' ? `Not found: ${path ?? ''}` : 'No note yet' });
		if (state === 'ok' && path) {
			const row = note.createDiv({ cls: 'ws-wr-sheet__actions' });
			button(row, { label: 'Open note', icon: 'feather', variant: 'ghost', size: 'sm', cls: 'ws-wr-opennote', tooltip: 'Open it in a normal Obsidian tab beside the studio', onClick: () => void openNote(st.ws.app, path) });
			button(row, { label: 'In a new tab', icon: 'file-plus-2', variant: 'quiet', size: 'sm', onClick: () => void openNote(st.ws.app, path, true) });
		}

		const busy = busyScenes.has(it.id);
		const tools = b.createDiv({ cls: 'ws-wr-sheet__tools ws-wr-insp__tools' });
		button(tools, { label: 'Split…', icon: 'scissors', variant: 'ghost', size: 'sm', cls: 'ws-wr-split-btn', disabled: state !== 'ok' || busy, onClick: () => new SplitModal(st, it, (c) => this.o.onSelect(c.id)).open() });
		const next = nextScene(st, it);
		button(tools, { label: 'Merge with next', icon: 'merge', variant: 'ghost', size: 'sm', cls: 'ws-wr-merge-btn', tooltip: next ? `Add “${next.title}” to the end of this scene` : 'This is the last scene', disabled: !next || busy, onClick: () => void mergeWithNext(st, it) });
		button(tools, { label: 'Move to…', icon: 'move', variant: 'ghost', size: 'sm', onClick: () => new MoveToModal(st, it).open() });
		button(tools, { icon: 'more-horizontal', variant: 'quiet', size: 'sm', tooltip: 'More', onClick: (e) => itemMenu(st, it, { onSelect: (x) => this.o.onSelect(x) }).showAtMouseEvent(e) });
	}

	/** Just the words and the bar toward the target (redrawn as the page is written). */
	paintWords(): void {
		const box = this.bodyEl.querySelector<HTMLElement>('.ws-wr-insp__wordsbox');
		const it = this.item;
		if (!box || !it || it.kind !== 'scene') return;
		const cur = this.st.w.item(it.id) ?? it;
		const live = this.o.liveWords(cur);
		const words = live ?? this.st.w.words.words(cur.notePath);
		box.empty();
		const n = box.createDiv({ cls: 'ws-wr-insp__big' });
		n.setText(words === null ? '…' : fmt(words));
		if (cur.wordTarget) {
			bar(box, (words ?? 0) / cur.wordTarget, 'ws-wr-insp__bar');
			box.createDiv({ cls: 'ws-wr-muted', text: `${fmt(words ?? 0)} of ${fmt(cur.wordTarget)}` });
		}
	}

	setTab(t: InspectorTab): void {
		if (t === this.tab) return;
		this.slot.flush?.();
		this.tab = t;
		this.render();
	}
}
