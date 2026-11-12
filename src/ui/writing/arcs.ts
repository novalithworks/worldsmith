import { Menu } from 'obsidian';
import type { CharacterArc, ManuscriptItem } from '../../core/types';
import { appearancesOf, arcPeople } from '../../services/writing/world';
import { avatar } from '../components/avatar';
import { cx, emptyState } from '../components/dom';
import { actionNotice } from '../components/notice';
import { button } from '../components/dom';
import { promptModal } from '../components/modals';
import { head, type Studio, type StudioScreen } from './kit';
import { binderModel, chapterOf } from './model';

/**
 * WS5 (0.23): character arcs. The people of a book's scenes (points of view and casts); for the
 * one chosen, a strip of the whole book showing where they appear, where they start and end
 * (a note per character per book, kept in the project), and their scenes in reading order.
 */
export class ArcsScreen implements StudioScreen {
	private readonly el: HTMLElement;
	private who: string | null;

	constructor(
		private readonly st: Studio,
		parent: HTMLElement,
		who: string | null,
		private readonly onSelect: (id: string | null) => void,
	) {
		this.el = parent.createDiv({ cls: 'ws-wr-arcs' });
		this.who = who;
	}

	mount(): void {
		this.refresh();
	}

	refresh(): void {
		// Never redraw under someone typing an arc note.
		if (this.el.contains(activeDocument.activeElement) && activeDocument.activeElement?.tagName === 'TEXTAREA') return;
		const st = this.st;
		const p = st.project!;
		this.el.empty();
		const scenes = st.w.scenes(p.id).filter((s) => !s.trashedAt);
		const people = arcPeople(scenes).filter((x) => {
			const e = st.s.entities.get(x.id);
			return e && !e.trashedAt;
		});
		if (!people.length) {
			head(this.el, { eyebrow: 'Character arcs', title: 'Character arcs', sub: `Follow one character through ${p.name}.` });
			emptyState(this.el, {
				icon: 'trending-up',
				title: 'No one to follow yet',
				body: 'Choose a scene’s point of view and who’s in it (in the scene’s inspector, under Who and where). Everyone who appears gets an arc here.',
				actionLabel: 'Open the manuscript',
				actionIcon: 'feather',
				onAction: () => st.go({ project: p.id, view: 'manuscript' }),
			});
			return;
		}
		if (!this.who || !people.some((x) => x.id === this.who)) this.who = people[0]!.id;
		head(this.el, { eyebrow: 'Character arcs', title: (this.who && st.s.entities.get(this.who)?.name) || 'Character arcs', sub: `Follow one character through ${p.name}: how hope and despair move, what they want and need, where it turns.` });
		const grid = this.el.createDiv({ cls: 'ws-wr-arcs__grid' });
		const list = grid.createDiv({ cls: 'ws-wr-arcs__people', attr: { role: 'listbox', 'aria-label': 'Characters' } });
		for (const x of people) {
			const e = st.s.entities.get(x.id)!;
			const on = x.id === this.who;
			const b = list.createEl('button', { cls: cx('ws-wr-arcs__person', on && 'is-active'), attr: { type: 'button', role: 'option', 'aria-selected': String(on), 'data-entity': x.id } });
			avatar(b, st.ws.app, e, st.s.schemas.get(e.typeId), { size: 'sm' });
			const t = b.createSpan({ cls: 'ws-wr-arcs__pt' });
			t.createSpan({ cls: 'ws-wr-arcs__pname', text: e.name });
			t.createSpan({ cls: 'ws-wr-arcs__pmeta', text: `${x.scenes} scene${x.scenes === 1 ? '' : 's'}${x.pov ? ` · ${x.pov} as point of view` : ''}` });
			b.tabIndex = on ? 0 : -1;
			b.addEventListener('click', () => {
				this.who = x.id;
				this.onSelect(x.id);
				this.refresh();
			});
		}
		// A list box: one stop for Tab; up and down move between people (WS8).
		list.addEventListener('keydown', (e) => {
			const d = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? -1 : 0;
			if (!d) return;
			e.preventDefault();
			const i = people.findIndex((x) => x.id === this.who);
			const next = people[(i + d + people.length) % people.length];
			if (!next) return;
			this.who = next.id;
			this.onSelect(next.id);
			this.refresh();
			this.el.querySelector<HTMLElement>(`.ws-wr-arcs__person[data-entity="${next.id}"]`)?.focus();
		});
		this.paintArc(grid.createDiv({ cls: 'ws-wr-arcs__arc' }), scenes, this.who);
	}

	private paintArc(box: HTMLElement, scenes: ManuscriptItem[], id: string): void {
		const st = this.st;
		const p = st.project!;
		const e = st.s.entities.get(id)!;
		const apps = appearancesOf(scenes, id);
		const arc = p.arcs?.[id] ?? { start: '', end: '' };
		const top = box.createDiv({ cls: 'ws-wr-arcs__top' });
		top.createSpan({ cls: 'ws-wr-muted', text: `In ${apps.length} of ${scenes.length} scenes. Their profile stays in ${st.s.schemas.get(e.typeId)?.plural ?? 'the world'}; this is what changes in ${p.name}.` });
		button(top, { label: 'Open profile', icon: 'arrow-up-right', variant: 'ghost', size: 'sm', cls: 'ws-wr-arcs__profile', onClick: () => void st.ws.open({ name: 'entity', params: { id } }, { newLeaf: 'tab' }) });

		// The curve: despair to hope, through their scenes in reading order.
		const chart = box.createDiv({ cls: 'ws-wr-arcs__chart' });
		if (!apps.length) chart.createDiv({ cls: 'ws-wr-muted', text: 'Put them in a scene (point of view or who’s in it) to draw their arc.' });
		else this.curve(chart, apps.map((a) => a.scene), id);

		// Wants, needs, flaw, conflicts, arc.
		const grid = box.createDiv({ cls: 'ws-wr-arcs__fields' });
		const fields: Array<[Extract<keyof CharacterArc, string>, string, string]> = [
			['wants', 'Wants', 'What they’re after in this book'],
			['needs', 'Needs', 'What they really need (often not what they want)'],
			['flaw', 'Flaw', 'What stands in their own way'],
			['internal', 'Internal conflict', 'The fight inside them'],
			['external', 'External conflict', 'Who or what opposes them'],
			['arc', 'Arc', 'Beginning · midpoint · end'],
		];
		for (const [key, label, ph] of fields) {
			const f = grid.createDiv({ cls: 'ws-wr-arcs__field' });
			const fid = `ws-wr-arc-${key}`;
			f.createEl('label', { cls: 'ws-wr-caps', text: label, attr: { for: fid } });
			const ta = f.createEl('textarea', { cls: 'ws-wr-arcs__ta', attr: { id: fid, rows: '2', placeholder: ph, 'data-arc': key } });
			const initial = key === 'arc' && !arc.arc && (arc.start || arc.end) ? [arc.start && `Beginning: ${arc.start}`, arc.end && `End: ${arc.end}`].filter(Boolean).join(' · ') : ((arc[key] as string | undefined) ?? '');
			ta.value = initial;
			ta.addEventListener('blur', () => {
				const cur = (st.w.project(p.id)?.arcs?.[id]?.[key] as string | undefined) ?? '';
				if (ta.value.trimEnd() === cur || (key === 'arc' && ta.value === initial && !cur)) return;
				const undo = st.w.setArc(p.id, id, { [key]: ta.value });
				actionNotice(`${e.name}’s arc saved.`, { label: 'Undo', run: undo });
			});
		}

		// Turning points: the scenes named on the curve.
		const tp = box.createDiv({ cls: 'ws-wr-panel ws-wr-arcs__turning' });
		tp.createDiv({ cls: 'ws-wr-panel__head' }).createEl('h3', { cls: 'ws-wr-panel__title', text: 'Turning points' });
		const named = apps.filter((a) => arc.turning?.[a.scene.id]);
		if (!named.length) tp.createDiv({ cls: 'ws-wr-muted', text: 'Click a point on the curve to name what turns there.' });
		const m = binderModel(st.w.tree(p.id));
		for (const a of named) {
			const row = tp.createEl('button', { cls: 'ws-wr-arcs__scene', attr: { type: 'button', 'data-scene': a.scene.id } });
			const ch = chapterOf(m, a.scene.id);
			row.createSpan({ cls: 'ws-wr-arcs__where', text: ch ? `Chapter ${m.chapterNo.get(ch.id) ?? ''}` : '' });
			row.createSpan({ cls: 'ws-wr-arcs__stitle', text: a.scene.title });
			row.createSpan({ cls: 'ws-wr-arcs__what', text: arc.turning![a.scene.id]! });
			row.addEventListener('click', () => st.go({ project: p.id, view: 'manuscript', item: a.scene.id }));
		}
	}

	/** An SVG curve of hope and despair; each point opens a small menu. */
	private curve(host: HTMLElement, list: ManuscriptItem[], id: string): void {
		const st = this.st;
		const p = st.project!;
		const arc = p.arcs?.[id];
		const NS = 'http://www.w3.org/2000/svg';
		const doc = host.ownerDocument;
		const W = Math.max(480, list.length * 90);
		const H = 220;
		const L = 70;
		const R = 30;
		const T = 34;
		const B = 46;
		const x = (i: number) => (list.length === 1 ? (L + W - R) / 2 : L + (i * (W - L - R)) / (list.length - 1));
		const y = (v: number) => T + ((1 - v) / 2) * (H - T - B);
		const svg = doc.createElementNS(NS, 'svg');
		svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
		svg.setAttribute('class', 'ws-wr-arcs__svg');
		svg.setAttribute('role', 'img');
		svg.setAttribute('aria-label', `Arc of hope and despair across ${list.length} scenes`);
		const el = (tag: string, a: Record<string, string>, text?: string) => {
			const n = doc.createElementNS(NS, tag);
			for (const [k, v] of Object.entries(a)) n.setAttribute(k, v);
			if (text) n.textContent = text;
			svg.appendChild(n);
			return n;
		};
		el('text', { x: '8', y: String(y(1) + 4), class: 'ws-wr-arcs__axis' }, 'Hope');
		el('text', { x: '8', y: String(y(-1) + 4), class: 'ws-wr-arcs__axis' }, 'Despair');
		el('line', { x1: String(L), x2: String(W - R), y1: String(y(0)), y2: String(y(0)), class: 'ws-wr-arcs__mid' });
		const pts = list.map((s, i) => ({ s, x: x(i), y: y(arc?.points?.[s.id] ?? 0) }));
		// Touch screens get bigger points to tap.
		const coarse = !!doc.defaultView?.matchMedia?.('(pointer: coarse)').matches;
		// …and the curve keeps its full width (it scrolls sideways) so they stay big enough.
		if (coarse) svg.style.minWidth = `${W}px`;
		// A smooth line through the points (Catmull-Rom as cubic Béziers).
		let d = `M ${pts[0]!.x} ${pts[0]!.y}`;
		for (let i = 0; i < pts.length - 1; i++) {
			const p0 = pts[i - 1] ?? pts[i]!;
			const p1 = pts[i]!;
			const p2 = pts[i + 1]!;
			const p3 = pts[i + 2] ?? p2;
			d += ` C ${p1.x + (p2.x - p0.x) / 6} ${p1.y + (p2.y - p0.y) / 6}, ${p2.x - (p3.x - p1.x) / 6} ${p2.y - (p3.y - p1.y) / 6}, ${p2.x} ${p2.y}`;
		}
		el('path', { d, class: 'ws-wr-arcs__line' });
		pts.forEach((pt, i) => {
			const label = pt.s.title.length > 12 ? `${pt.s.title.slice(0, 11)}…` : pt.s.title;
			el('text', { x: String(pt.x), y: String(H - 14), class: 'ws-wr-arcs__xlabel', 'text-anchor': 'middle' }, label);
			const turn = arc?.turning?.[pt.s.id];
			if (turn) el('text', { x: String(pt.x), y: String(pt.y + ((arc?.points?.[pt.s.id] ?? 0) >= 0 ? -14 : 24)), class: 'ws-wr-arcs__turn', 'text-anchor': 'middle' }, turn);
			const c = el('circle', { cx: String(pt.x), cy: String(pt.y), r: coarse ? '12' : '7', class: 'ws-wr-arcs__dot', tabindex: '0', role: 'button', 'aria-label': `${pt.s.title}: ${(arc?.points?.[pt.s.id] ?? 0) >= 0 ? 'hope' : 'despair'} ${arc?.points?.[pt.s.id] ?? 0}. Change`, 'data-scene': pt.s.id });
			const open = (evt: MouseEvent | KeyboardEvent) => this.pointMenu(evt, pt.s, id, i);
			c.addEventListener('click', (e) => open(e as MouseEvent));
			c.addEventListener('keydown', (e) => {
				if ((e).key === 'Enter' || (e).key === ' ') {
					e.preventDefault();
					open(e);
				}
			});
		});
		const wrap = host.createDiv({ cls: 'ws-wr-arcs__scroll' });
		wrap.appendChild(svg);
	}

	private pointMenu(evt: MouseEvent | KeyboardEvent, scene: ManuscriptItem, id: string, _i: number): void {
		const st = this.st;
		const p = st.project!;
		const e = st.s.entities.get(id)!;
		const arc = p.arcs?.[id];
		const cur = arc?.points?.[scene.id] ?? 0;
		const m = new Menu();
		const set = (v: number) => {
			const pts = { ...(arc?.points ?? {}), [scene.id]: v };
			const undo = st.w.setArc(p.id, id, { points: pts });
			actionNotice(`${e.name} in “${scene.title}”: ${v > 0 ? 'more hope' : v < 0 ? 'nearer despair' : 'level'}.`, { label: 'Undo', run: undo });
			this.refresh();
		};
		for (const [v, label] of [[1, 'Hope'], [0.5, 'Some hope'], [0, 'Level'], [-0.5, 'Low'], [-1, 'Despair']] as const) m.addItem((i) => i.setTitle(label).setChecked(cur === v).onClick(() => set(v)));
		m.addSeparator();
		m.addItem((i) =>
			i
				.setTitle(arc?.turning?.[scene.id] ? 'Rename turning point…' : 'Name this turning point…')
				.setIcon('milestone')
				.onClick(async () => {
					const t = await promptModal(st.ws.app, { title: `Turning point in “${scene.title}”`, label: 'What turns here?', value: arc?.turning?.[scene.id] ?? '', placeholder: 'Takes the oath', confirmLabel: 'Save' });
					if (t === null) return;
					const turning = { ...(arc?.turning ?? {}) };
					if (t.trim()) turning[scene.id] = t.trim();
					else delete turning[scene.id];
					const undo = st.w.setArc(p.id, id, { turning });
					actionNotice('Turning point saved.', { label: 'Undo', run: undo });
					this.refresh();
				}),
		);
		m.addItem((i) => i.setTitle('Open the scene').setIcon('feather').onClick(() => st.go({ project: p.id, view: 'manuscript', item: scene.id })));
		if (evt instanceof MouseEvent && evt.detail !== 0) m.showAtMouseEvent(evt);
		else {
			const r = (evt.target as Element).getBoundingClientRect();
			m.showAtPosition({ x: r.left, y: r.bottom + 4 });
		}
	}
}
