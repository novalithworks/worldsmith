import { Platform } from 'obsidian';
import { BODY_FONTS, cleanStyle, documentWords, MARGIN_CM, PAGE_SIZES, STUDIO_HEADING_CSS, STYLE_PRESETS, type Block, type BookStyle, type ChapterStyle, type CompileOptions } from '../../services/writing/compile';
import { button, cx, icon } from '../components/dom';
import { compileDocument, compileTo, savedOptions, SEPS, STYLES, TARGETS, type Target } from './compileModal';
import { caps, fmt, head, type Studio } from './kit';

/**
 * Compile (0.28): the whole page. Format, what to include (parts and chapters, ticked), story
 * or in-world time order, layout, front and back matter; a live preview of the title page and
 * the first chapter, with scenes, words and pages; Export makes the file.
 */
export class CompileScreen {
	private readonly el: HTMLElement;
	private o: CompileOptions;
	private target: Target;
	private timer: number | null = null;
	private previewEl: HTMLElement | null = null;

	constructor(
		private readonly st: Studio,
		parent: HTMLElement,
	) {
		this.el = parent.createDiv({ cls: 'ws-wr-compilepage' });
		const p = st.project!;
		this.o = savedOptions(p);
		const t = p.compile?.target as Target | undefined;
		this.target = t && TARGETS.some((x) => x.id === t) && !(t === 'print' && Platform.isMobile) ? t : 'docx';
	}

	mount(): void {
		this.paint();
	}

	refresh(): void {
		if (this.el.contains(activeDocument.activeElement) && ['INPUT', 'TEXTAREA', 'SELECT'].includes(activeDocument.activeElement?.tagName ?? '')) return;
		this.paint();
	}

	private paint(): void {
		const st = this.st;
		const p = st.project!;
		this.el.empty();
		const tools = head(this.el, { eyebrow: 'Compile', title: 'Compile the manuscript', sub: 'Joins your scenes into one file. Your notes are never changed.' });
		button(tools, { label: 'Export', icon: 'file-output', variant: 'primary', size: 'sm', cls: 'ws-wr-compile-export', onClick: () => void compileTo(st, this.target, this.o) });
		const grid = this.el.createDiv({ cls: 'ws-wr-cgrid' });
		const left = grid.createDiv({ cls: 'ws-wr-cside' });
		const card = (title: string) => {
			const c = left.createDiv({ cls: 'ws-wr-ccard' });
			caps(c, title, 'ws-wr-ccard__head');
			return c;
		};
		const changed = () => this.schedulePreview();

		// Format: a tile each (0.28.2).
		const fmtCard = card('Format');
		const tiles = fmtCard.createDiv({ cls: 'ws-wr-ftiles', attr: { role: 'radiogroup', 'aria-label': 'Format' } });
		const order: Target[] = ['docx', 'print', 'epub', 'html', 'md', 'txt'];
		for (const id of order) {
			if (id === 'print' && Platform.isMobile) continue;
			const t = TARGETS.find((x) => x.id === id)!;
			const on = id === this.target;
			const b = tiles.createEl('button', { cls: cx('ws-wr-ftile', on && 'is-active'), attr: { type: 'button', role: 'radio', 'aria-checked': String(on), 'data-target': id } });
			icon(b, t.icon, 'ws-wr-ftile__icon');
			b.createSpan({ cls: 'ws-wr-ftile__label', text: t.label });
			b.addEventListener('click', () => {
				this.target = id;
				this.paint();
			});
		}
		fmtCard.createDiv({ cls: 'ws-wr-ccard__hint', text: TARGETS.find((x) => x.id === this.target)?.hint ?? '' });

		// Style: how the book looks (not for Markdown or plain text).
		if (this.target !== 'md' && this.target !== 'txt') this.styleCard(card('Style'), changed);

		// Include: parts and chapters, ticked.
		const inc = card('Include');
		const skip = new Set(this.o.exclude ?? []);
		const tree = st.w.tree(p.id);
		const row = (id: string, label: string, words: number | null, depth: number, disabled: boolean) => {
			const lab = inc.createEl('label', { cls: cx('ws-wr-cinc', `is-d${depth}`, disabled && 'is-off'), attr: { 'data-item': id } });
			const box = lab.createEl('input', { attr: { type: 'checkbox' } });
			box.checked = !skip.has(id);
			box.disabled = disabled;
			lab.createSpan({ cls: 'ws-wr-cinc__label', text: label });
			if (words !== null) lab.createSpan({ cls: 'ws-wr-cinc__n', text: fmt(words) });
			box.addEventListener('change', () => {
				const next = new Set(this.o.exclude ?? []);
				if (box.checked) next.delete(id);
				else next.add(id);
				this.o.exclude = [...next];
				this.paint();
			});
		};
		const walk = (nodes: typeof tree, depth: number, off: boolean) => {
			for (const n of nodes) {
				if (n.item.kind === 'scene') continue;
				row(n.item.id, n.item.title, n.item.kind === 'chapter' ? st.w.wordCount(n.item.id) : null, depth, off);
				walk(n.children, depth + 1, off || skip.has(n.item.id));
			}
		};
		walk(tree, 0, false);
		if (!tree.some((n) => n.item.kind !== 'scene')) inc.createDiv({ cls: 'ws-wr-ccard__hint', text: 'Every scene is included (the book has no parts or chapters).' });

		// Order.
		const ord = card('Order');
		const oseg = ord.createDiv({ cls: 'ws-wr-seg', attr: { role: 'radiogroup', 'aria-label': 'Order' } });
		for (const [k, l] of [['story', 'Story order'], ['time', 'Time order']] as const) {
			const b = oseg.createEl('button', { cls: cx('ws-wr-seg__item', (this.o.order ?? 'story') === k && 'is-active'), text: l, attr: { type: 'button', role: 'radio', 'aria-checked': String((this.o.order ?? 'story') === k), 'data-order': k } });
			b.addEventListener('click', () => {
				this.o.order = k;
				this.paint();
			});
		}
		if (this.o.order === 'time') ord.createDiv({ cls: 'ws-wr-ccard__hint', text: 'Scenes follow their in-story dates; chapters are left out. Scenes without a date come last.' });

		// Layout.
		const lay = card('Layout');
		const lrow = (label: string) => {
			const r = lay.createEl('label', { cls: 'ws-wr-crow' });
			r.createSpan({ cls: 'ws-wr-crow__label', text: label });
			return r;
		};
		const text = (label: string, key: 'title' | 'author' | 'language', ph = '') => {
			const i = lrow(label).createEl('input', { cls: 'ws-input', attr: { type: 'text', placeholder: ph, 'data-opt': key } });
			i.value = (this.o[key]) ?? '';
			i.addEventListener('input', () => {
				(this.o[key]) = i.value;
				changed();
			});
		};
		text('Title', 'title');
		text('Author', 'author', 'Your name');
		const tp = lrow('Title page').createEl('input', { attr: { type: 'checkbox', 'data-opt': 'titlePage' } });
		tp.checked = this.o.titlePage;
		tp.addEventListener('change', () => {
			this.o.titlePage = tp.checked;
			changed();
		});
		const cs = lrow('Chapter headings').createEl('select', { cls: 'dropdown', attr: { 'data-opt': 'chapterStyle' } });
		for (const [k, l] of STYLES) cs.createEl('option', { text: l, attr: { value: k } });
		cs.value = this.o.chapterStyle;
		cs.addEventListener('change', () => {
			this.o.chapterStyle = cs.value as ChapterStyle;
			changed();
		});
		const stl = lrow('Scene titles').createEl('input', { attr: { type: 'checkbox', 'data-opt': 'sceneTitles' } });
		stl.checked = this.o.sceneTitles;
		const sep = lrow('Scene separator').createEl('select', { cls: 'dropdown', attr: { 'data-opt': 'separator' } });
		for (const [k, l] of SEPS) sep.createEl('option', { text: l, attr: { value: k } });
		sep.value = this.o.separator;
		sep.disabled = this.o.sceneTitles;
		sep.addEventListener('change', () => {
			this.o.separator = sep.value;
			changed();
		});
		stl.addEventListener('change', () => {
			this.o.sceneTitles = stl.checked;
			sep.disabled = stl.checked;
			changed();
		});
		if (this.target === 'epub' || this.target === 'docx' || this.target === 'html') text('Language', 'language', 'en');

		// Front and back matter.
		const mat = card('Front & back matter');
		const area = (label: string, key: 'dedication' | 'epigraph' | 'epigraphBy' | 'acknowledgements' | 'about', ph: string, rows = 2) => {
			const r = mat.createEl('label', { cls: 'ws-wr-cmat' });
			r.createSpan({ cls: 'ws-wr-crow__label', text: label });
			const t = rows > 1 ? r.createEl('textarea', { cls: 'ws-input', attr: { rows: String(rows), placeholder: ph, 'data-opt': key } }) : r.createEl('input', { cls: 'ws-input', attr: { type: 'text', placeholder: ph, 'data-opt': key } });
			t.value = this.o[key] ?? '';
			t.addEventListener('input', () => {
				this.o[key] = t.value;
				changed();
			});
		};
		area('Dedication', 'dedication', 'For my sister, who read it first.');
		area('Epigraph', 'epigraph', 'A quotation to open the book');
		area('Epigraph by', 'epigraphBy', 'Who said it', 1);
		area('Acknowledgements', 'acknowledgements', 'Thanks…', 3);
		area('About the author', 'about', 'A few lines about you', 3);

		// Preview.
		const right = grid.createDiv({ cls: 'ws-wr-cpreview' });
		this.previewEl = right;
		void this.renderPreview();
	}

	private schedulePreview(): void {
		if (this.timer !== null) window.clearTimeout(this.timer);
		this.timer = window.setTimeout(() => {
			this.timer = null;
			void this.renderPreview();
		}, 250);
	}

	/** The look: a starting point, then colours, fonts, size, spacing, margins, page and touches. */
	private styleCard(c: HTMLElement, changed: () => void): void {
		const st = cleanStyle(this.o.style);
		this.o.style = st;
		const presets = c.createDiv({ cls: 'ws-wr-swatches', attr: { role: 'radiogroup', 'aria-label': 'Starting point' } });
		const NAMES: Record<Exclude<BookStyle['preset'], 'custom'>, string> = { studio: 'As in the Writing Studio', classic: 'Classic manuscript', plain: 'Plain', dark: 'Dark' };
		for (const [id, label] of Object.entries(NAMES) as Array<[Exclude<BookStyle['preset'], 'custom'>, string]>) {
			const ps = STYLE_PRESETS[id];
			const on = st.preset === id;
			const b = presets.createEl('button', { cls: cx('ws-wr-swatch', on && 'is-active'), attr: { type: 'button', role: 'radio', 'aria-checked': String(on), 'data-preset': id } });
			const sw = b.createDiv({ cls: 'ws-wr-swatch__page' });
			sw.style.background = ps.paper;
			sw.style.color = ps.ink;
			sw.createDiv({ cls: 'ws-wr-swatch__k', text: 'Chapter one' }).style.color = ps.accent;
			const tt = sw.createDiv({ cls: 'ws-wr-swatch__t', text: 'Aa' });
			tt.style.fontFamily = ps.headings === 'studio' ? STUDIO_HEADING_CSS : BODY_FONTS[ps.body].css;
			b.createSpan({ cls: 'ws-wr-swatch__label', text: label });
			b.addEventListener('click', () => {
				this.o.style = { ...STYLE_PRESETS[id] };
				this.paint();
			});
		}
		if (st.preset === 'custom') c.createDiv({ cls: 'ws-wr-ccard__hint', text: 'Customised. Choose a starting point above to reset.' });
		const set = (patch: Partial<BookStyle>, repaint = false) => {
			this.o.style = { ...cleanStyle(this.o.style), ...patch, preset: 'custom' };
			if (repaint) this.paint();
			else {
				changed();
				this.el.querySelectorAll('.ws-wr-swatch.is-active').forEach((x) => (x.removeClass('is-active'), x.setAttr('aria-checked', 'false')));
			}
		};
		const row = (label: string) => {
			const r = c.createEl('label', { cls: 'ws-wr-crow' });
			r.createSpan({ cls: 'ws-wr-crow__label', text: label });
			return r;
		};
		const colours = c.createDiv({ cls: 'ws-wr-colours' });
		for (const [key, label] of [['paper', 'Page'], ['ink', 'Text'], ['accent', 'Accent']] as const) {
			const l = colours.createEl('label', { cls: 'ws-wr-colour' });
			const inp = l.createEl('input', { attr: { type: 'color', 'data-style': key, 'aria-label': `${label} colour` } });
			inp.value = st[key];
			l.createSpan({ text: label });
			inp.addEventListener('input', () => set({ [key]: inp.value }));
		}
		const sel = (label: string, key: keyof BookStyle, opts: Array<[string, string]>, cast: (v: string) => unknown = (v) => v) => {
			const s2 = row(label).createEl('select', { cls: 'dropdown', attr: { 'data-style': key } });
			for (const [v, l] of opts) s2.createEl('option', { text: l, attr: { value: v } });
			s2.value = String(st[key]);
			s2.addEventListener('change', () => set({ [key]: cast(s2.value) }));
		};
		sel('Text font', 'body', Object.entries(BODY_FONTS).map(([k, v]) => [k, v.label]));
		sel('Headings', 'headings', [['studio', 'The studio’s title face'], ['body', 'Same as the text']]);
		sel('Text size', 'size', ['10', '10.5', '11', '11.5', '12', '13', '14'].map((v) => [v, `${v} pt`]), Number);
		sel('Line spacing', 'leading', [['1.3', 'Tight'], ['1.5', 'Comfortable'], ['1.6', 'Book (as in the studio)'], ['1.8', 'Airy'], ['2', 'Double (manuscript)']], Number);
		sel('Margins', 'margins', [['narrow', 'Narrow'], ['normal', 'Normal'], ['wide', 'Wide']]);
		if (this.target !== 'epub' && this.target !== 'html') sel('Page size', 'page', Object.entries(PAGE_SIZES).map(([k, v]) => [k, v.label]));
		const tog = (label: string, key: 'dropCap' | 'indent' | 'ornaments') => {
			const t = row(label).createEl('input', { attr: { type: 'checkbox', 'data-style': key } });
			t.checked = st[key];
			t.addEventListener('change', () => set({ [key]: t.checked }));
		};
		tog('Decorative first letter', 'dropCap');
		tog('Indent paragraphs', 'indent');
		tog('Ornaments', 'ornaments');
		if (this.target === 'docx') c.createDiv({ cls: 'ws-wr-ccard__hint', text: 'Word shows the page colour; to print it, turn on “Print background colors” in Word. The title face is named in the file (Word uses a similar font if it isn’t installed).' });
		if (this.target === 'print') c.createDiv({ cls: 'ws-wr-ccard__hint', text: 'On the desktop the PDF uses the studio’s fonts exactly; elsewhere it uses the PDF format’s own serif. The page colour fills every page.' });
	}

	private async renderPreview(): Promise<void> {
		const box = this.previewEl;
		if (!box) return;
		const p = this.st.project!;
		const o = { ...this.o, title: this.o.title.trim() || p.name };
		const doc = await compileDocument(this.st, o);
		if (!box.isConnected) return;
		box.empty();
		const plain = this.target === 'md' || this.target === 'txt';
		const st = plain ? STYLE_PRESETS.plain : cleanStyle(this.o.style);
		const page = PAGE_SIZES[st.page];
		// Real page width in CSS px (A5 is 148 mm); type and margins scale with the preview's width.
		const realPx = (page.w / 1440) * 96;
		const pages = box.createDiv({ cls: 'ws-wr-cpages' });
		pages.style.setProperty('--ratio', String(page.ratio));
		const mk = (cls: string, label: string) => {
			const el = pages.createDiv({ cls: ['ws-wr-cpage', cls].filter(Boolean), attr: { 'aria-label': label } });
			el.style.setProperty('--paper', st.paper);
			el.style.setProperty('--ink', st.ink);
			el.style.setProperty('--accent', st.accent);
			el.style.setProperty('--body', BODY_FONTS[st.body].css);
			el.style.setProperty('--head', st.headings === 'studio' ? STUDIO_HEADING_CSS : BODY_FONTS[st.body].css);
			el.style.setProperty('--fs', `${((st.size * 96) / 72 / realPx) * 100}cqi`);
			el.style.setProperty('--pad', `${((MARGIN_CM[st.margins] * 37.8) / realPx) * 100}cqi`);
			el.style.setProperty('--lh', String(st.leading));
			el.toggleClass('has-indent', st.indent);
			el.toggleClass('has-dropcap', st.dropCap);
			el.toggleClass('has-ornaments', st.ornaments);
			return el.createDiv({ cls: 'ws-wr-cpage__in' });
		};
		const first = mk('ws-wr-cpage--title', 'Preview: first page');
		const tb = doc.find((b) => b.t === 'title');
		if (tb && tb.t === 'title') {
			first.createDiv({ cls: 'ws-wr-cpage__arch', attr: { 'aria-hidden': 'true' } });
			if (p.series) first.createDiv({ cls: 'ws-wr-cpage__kicker', text: p.series });
			first.createDiv({ cls: 'ws-wr-cpage__book', text: tb.title });
			if (tb.author) first.createDiv({ cls: 'ws-wr-cpage__author', text: tb.author });
		} else first.createDiv({ cls: 'ws-wr-cpage__none', text: 'No title page' });
		const second = mk('', 'Preview: the first chapter');
		const start = doc.findIndex((b) => b.t === 'chapter' || b.t === 'p');
		let shown = 0;
		let opening = false;
		for (let i = Math.max(0, start); i < doc.length && shown < 14; i++) {
			const b = doc[i] as Block;
			if (b.t === 'chapter') {
				if (shown > 0) break;
				const m = /^(Chapter [^:]+)(?::\s*(.*))?$/.exec(b.text);
				if (m) second.createDiv({ cls: 'ws-wr-cpage__chkicker', text: m[1]! });
				second.createDiv({ cls: 'ws-wr-cpage__chtitle', text: m ? (m[2] ?? '') : b.text });
				second.createDiv({ cls: 'ws-wr-cpage__orn', text: '◆', attr: { 'aria-hidden': 'true' } });
				opening = true;
				shown++;
			} else if (b.t === 'p' || b.t === 'quote') {
				const para = second.createEl('p', { cls: cx('ws-wr-cpage__p', b.t === 'quote' && 'is-quote', opening && 'is-opening') });
				for (const r of b.runs) para.createEl(r.b ? 'strong' : r.i ? 'em' : 'span', { text: r.text });
				opening = false;
				shown++;
			} else if (b.t === 'sep') {
				second.createDiv({ cls: 'ws-wr-cpage__sep', text: this.o.sceneTitles ? '' : this.o.separator || '' });
				shown++;
			} else if (b.t === 'scene') {
				second.createDiv({ cls: 'ws-wr-cpage__scene', text: b.text });
				shown++;
			}
		}
		const scenes = this.st.w.scenes(p.id).filter((s) => !s.trashedAt).length;
		const words = documentWords(doc);
		const perPage = Math.round(((page.w * page.h) / (8391 * 11906)) * 250 * (12 / st.size) ** 2 * (1.6 / st.leading));
		const pagesN = Math.max(1, Math.round(words / Math.max(120, perPage)));
		box.createDiv({ cls: 'ws-wr-cpreview__stats', text: `${scenes} scene${scenes === 1 ? '' : 's'} · ${fmt(words)} words · about ${pagesN} page${pagesN === 1 ? '' : 's'}` });
		const note = box.createDiv({ cls: 'ws-wr-cpreview__note' });
		icon(note, 'info');
		note.createSpan({ text: plain ? 'Markdown and plain text carry the words only; the style applies to Word, PDF, EPUB and web pages.' : 'A preview of the first pages; the file has the whole book.' });
	}
}
