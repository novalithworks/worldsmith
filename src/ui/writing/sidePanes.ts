import { cx, icon } from '../components/dom';
import { caps, type Studio } from './kit';
import { binderModel, chapterOf } from './model';
import { openResearch, RESEARCH_ICON } from './researchPage';

/**
 * The side panel's Outline and Research (0.28, from the design's split view): the book's
 * chapters and scenes with their summaries beside the page (click one to open it), and the
 * book's research (click to open it beside the manuscript).
 */

export function renderSideOutline(st: Studio, el: HTMLElement, selected: string | null, onSelect: (id: string) => void): void {
	const p = st.project!;
	const scenes = st.w.scenes(p.id).filter((s) => !s.trashedAt);
	if (!scenes.length) {
		el.createDiv({ cls: 'ws-wr-muted ws-wr-side__empty', text: 'No scenes yet.' });
		return;
	}
	const m = binderModel(st.w.tree(p.id));
	let lastCh: string | null | undefined;
	for (const s of scenes) {
		const ch = chapterOf(m, s.id);
		if ((ch?.id ?? null) !== lastCh) {
			lastCh = ch?.id ?? null;
			if (ch) {
				const h = el.createDiv({ cls: 'ws-wr-sol__chapter' });
				h.createSpan({ cls: 'ws-wr-sol__num', text: String(m.chapterNo.get(ch.id) ?? '') });
				h.createSpan({ text: ch.title });
			}
		}
		const row = el.createEl('button', { cls: cx('ws-wr-sol__scene', s.id === selected && 'is-active'), attr: { type: 'button', 'data-item': s.id } });
		row.createDiv({ cls: 'ws-wr-sol__title', text: s.title });
		if (s.synopsis) row.createDiv({ cls: 'ws-wr-sol__syn', text: s.synopsis });
		row.addEventListener('click', () => onSelect(s.id));
	}
}

export function renderSideResearch(st: Studio, el: HTMLElement): void {
	const p = st.project!;
	const items = [...(p.research ?? [])].reverse();
	if (!items.length) {
		el.createDiv({ cls: 'ws-wr-muted ws-wr-side__empty', text: 'Nothing gathered yet. Add notes, images, links and sources on the Research tab.' });
	}
	for (const it of items) {
		const row = el.createEl('button', { cls: cx('ws-wr-sres', `is-${it.kind}`), attr: { type: 'button', 'data-research': it.id } });
		const k = row.createDiv({ cls: 'ws-wr-sres__kind' });
		icon(k, RESEARCH_ICON[it.kind] ?? 'file');
		k.createSpan({ text: it.kind });
		row.createDiv({ cls: 'ws-wr-sres__title', text: it.title });
		if (it.citation) row.createDiv({ cls: 'ws-wr-sres__meta', text: it.citation });
		row.addEventListener('click', () => openResearch(st, it));
	}
	const go = el.createEl('button', { cls: 'ws-wr-sres__all', text: 'Open the Research tab', attr: { type: 'button' } });
	go.addEventListener('click', () => st.go({ project: p.id, view: 'research' }));
	void caps;
}
