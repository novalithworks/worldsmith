import { Component, MarkdownRenderer, Menu, Notice, setIcon } from 'obsidian';
import type { WorldsmithContext } from '../../app/context';
import type { EntityRecord, EntitySchema, NoteAccent, NoteAppearance, NoteSection, NoteSectionKind, NoteTemplate } from '../../core/types';
import { tplClass } from '../../services/notes/appearanceCss';
import { fieldHome, longFields } from '../../services/notes/properties';
import { sectionId, sectionsFromLayout } from '../../services/notes/templates';
import type { WorldSession } from '../../services/WorldSession';
import { button, cx, emptyState, icon, nameRegion, pinStyles } from '../components/dom';
import { confirmModal, promptModal } from '../components/modals';
import { actionNotice } from '../components/notice';
import { MigrationModal } from './migrationModal';

/**
 * Layout Studio → Native note (0.17): the note template of each type. Pick a template, or
 * customise a copy (sections, their order and fields, and the look), with a live preview
 * of a real entry's note. The preview is drawn here; no note is written. Changing the look
 * writes no note at all; changing sections rewrites only Worldsmith's parts of the notes
 * using the template, in the background.
 */

const KIND_LABEL: Record<NoteSectionKind, { label: string; icon: string; hint: string }> = {
	banner: { label: 'Banner', icon: 'panel-top', hint: 'The entry’s banner image' },
	infocard: { label: 'Info card', icon: 'id-card', hint: 'Portrait and key facts, beside the text' },
	title: { label: 'Title', icon: 'heading-1', hint: 'Type and status, name and aliases' },
	summary: { label: 'Summary', icon: 'quote', hint: 'The entry’s summary, as a quote (editable in the note)' },
	facts: { label: 'Facts', icon: 'layout-grid', hint: 'A grid of chosen fields' },
	schemaSections: { label: 'The type’s sections', icon: 'rows-3', hint: 'One fact group per section in Type Studio, with its long text' },
	field: { label: 'Text section', icon: 'align-left', hint: 'One long-text field, editable in the note' },
	connections: { label: 'Connections', icon: 'git-branch', hint: 'Grouped links to connected entries' },
	children: { label: 'Nested entries', icon: 'git-fork', hint: 'Entries inside this one' },
	gallery: { label: 'Gallery', icon: 'images', hint: 'The entry’s gallery images' },
	separator: { label: 'Separator', icon: 'minus', hint: 'A dividing line' },
	heading: { label: 'Heading', icon: 'heading-2', hint: 'A heading of your own' },
	footer: { label: '“Open in Worldsmith”', icon: 'external-link', hint: 'The link back to the entry' },
};

export const ACCENTS: Array<[NoteAccent, string, string]> = [
	['bronze', 'Bronze', '#bb915e'],
	['crimson', 'Crimson', '#b5524a'],
	['verdigris', 'Verdigris', '#6eaaa4'],
	['violet', 'Violet', '#a084bb'],
	['azure', 'Azure', '#6f9fd8'],
	['theme', 'Theme accent', 'var(--interactive-accent)'],
];

export class NoteStudio {
	private selected: string | null = null;
	private sampleId: string | null = null;
	private device: 'desktop' | 'phone' = 'desktop';
	private preview: Component | null = null;

	constructor(
		private readonly ws: WorldsmithContext,
		private readonly s: WorldSession,
		private readonly component: Component,
		private readonly rerender: () => void,
	) {}

	dispose(): void {
		if (this.preview) this.component.removeChild(this.preview);
		this.preview = null;
		this.host = null;
	}

	private host: HTMLElement | null = null;
	private schemaId: string | null = null;
	/** The preview's Markdown is ready (it renders asynchronously). */
	private previewReady: Promise<unknown> = Promise.resolve();
	private swapping = 0;

	/** Open on this template (a picker's “Preview first”). */
	select(templateId: string | null, sampleId?: string | null): void {
		if (templateId) this.selected = templateId;
		if (sampleId) this.sampleId = sampleId;
	}

	/** The type this studio is showing. */
	get typeId(): string | null {
		return this.host?.isConnected ? this.schemaId : null;
	}

	render(el: HTMLElement, schema: EntitySchema): void {
		if (this.preview) this.component.removeChild(this.preview);
		this.preview = null;
		this.host = el;
		this.schemaId = schema.id;
		this.build(el, schema);
	}

	/**
	 * Update in place (0.17.2): the new content is built off-screen, its preview rendered,
	 * and then swapped in at once, so nothing flashes or jumps while switching templates.
	 */
	refresh(): void {
		const host = this.host;
		const schema = this.schemaId ? this.s.schemas.get(this.schemaId) : undefined;
		if (!host?.isConnected || !schema) return this.rerender();
		const old = this.preview;
		this.preview = null;
		const next = createDiv();
		this.build(next, schema);
		const ticket = ++this.swapping;
		const swap = () => {
			if (ticket !== this.swapping) return;
			if (old) this.component.removeChild(old);
			host.replaceChildren(...Array.from(next.childNodes));
		};
		void Promise.race([this.previewReady, new Promise((r) => window.setTimeout(r, 350))]).then(() => {
			if (ticket !== this.swapping) {
				// A newer refresh took over (it disposes this one's preview when it swaps).
				if (old) this.component.removeChild(old);
				return;
			}
			swap();
		});
	}

	private build(el: HTMLElement, schema: EntitySchema): void {
		const s = this.s;
		const inUse = s.noteTemplates.forType(schema);
		const chosen = s.world.noteTemplates?.byType?.[schema.id];
		if (!this.selected || !s.noteTemplates.get(this.selected)) this.selected = inUse.id;
		const tpl = s.noteTemplates.get(this.selected)!;
		const users = [...s.entities.values()].filter((e) => e.nativeNote && e.typeId === schema.id);
		const usingTpl = [...s.entities.values()].filter((e) => e.nativeNote && s.schemas.get(e.typeId) && s.noteTemplates.forEntity(e, s.schemas.get(e.typeId)!).template.id === tpl.id);

		const intro = el.createDiv({ cls: 'ws-ls__sec ws-nns__intro' });
		const without = [...s.entities.values()].filter((e) => e.typeId === schema.id && !e.nativeNote && !e.trashedAt && !e.archivedAt).length;
		if (without)
			button(intro, {
				label: `Make ${schema.plural.toLowerCase()} native notes…`,
				icon: 'file-check',
				variant: 'ghost',
				size: 'sm',
				cls: 'ws-nns__migrate',
				tooltip: `A dry run first: see what would happen to the ${without} ${without === 1 ? schema.singular.toLowerCase() : schema.plural.toLowerCase()} without a native note, then decide`,
				onClick: () => new MigrationModal(this.ws, { kind: 'type', id: schema.id }).open(),
			});
		intro.createEl('p', {
			cls: 'ws-nn-muted',
			text: `How ${schema.singular.toLowerCase()} notes look in Obsidian. ${users.length ? `${users.length} ${users.length === 1 ? 'entry has' : 'entries have'} a native note.` : 'No entry of this type has a native note yet.'} Changing colours, type or density rewrites no note. Adding, removing or moving sections rewrites only Worldsmith’s parts.`,
		});

		// ── templates ──
		const sec = el.createDiv({ cls: 'ws-ls__sec ws-ls__choices' });
		const h = sec.createDiv({ cls: 'ws-ls__h' });
		h.createSpan({ text: 'Note templates' });
		h.createSpan({ cls: 'ws-ls__h-hint', text: 'Choose one to preview it below' });
		const grid = sec.createDiv({ cls: 'ws-nns__tpls', attr: { role: 'listbox' } });
		nameRegion(grid, 'Note templates');
		for (const t of s.noteTemplates.list()) {
			const on = t.id === tpl.id;
			const b = grid.createEl('button', { cls: cx('ws-nns__tpl', on && 'is-active'), attr: { type: 'button', role: 'option', 'aria-selected': String(on), 'data-template': t.id } });
			const nm = b.createDiv({ cls: 'ws-nns__tpl-name' });
			icon(nm, t.icon);
			nm.createSpan({ text: t.name });
			if (t.id === inUse.id) nm.createSpan({ cls: 'ws-ls__badge', text: 'In use' });
			b.createDiv({ cls: 'ws-nns__tpl-desc', text: t.builtIn ? t.description : t.description || 'Your template' });
			const sw = b.createDiv({ cls: 'ws-nns__swatch' });
			sw.style.setProperty('--sw', ACCENTS.find((a) => a[0] === t.appearance.accent)?.[2] ?? '#bb915e');
			b.addEventListener('click', () => {
				this.selected = t.id;
				this.refresh();
			});
		}
		const add = grid.createEl('button', { cls: 'ws-nns__tpl ws-nns__tpl--add', attr: { type: 'button' } });
		const an = add.createDiv({ cls: 'ws-nns__tpl-name' });
		icon(an, 'plus');
		an.createSpan({ text: 'Start from my Worldsmith page' });
		add.createDiv({ cls: 'ws-nns__tpl-desc', text: `A new template made from the ${schema.singular.toLowerCase()} page layout.` });
		add.addEventListener('click', () => this.fromPage(schema));

		// ── actions on the selected template ──
		const bar = el.createDiv({ cls: 'ws-ls__bar ws-nns__bar' });
		const label = bar.createDiv({ cls: 'ws-ls__bar-label' });
		label.createSpan({ cls: 'ws-ls__h', text: tpl.id === inUse.id ? `${tpl.name} (in use)` : tpl.name });
		if (usingTpl.length) label.createSpan({ cls: 'ws-ls__h-hint', text: `${usingTpl.length} note${usingTpl.length === 1 ? '' : 's'} use it` });
		const actions = bar.createDiv({ cls: 'ws-ls__actions' });
		button(actions, {
			label: tpl.id === inUse.id ? 'In use' : `Use for ${schema.plural}`,
			icon: tpl.id === inUse.id ? undefined : 'check',
			variant: 'primary',
			size: 'sm',
			cls: 'ws-nns__use',
			disabled: tpl.id === inUse.id,
			onClick: () => {
				const prev = s.noteTemplates.assign(schema.id, tpl.id);
				actionNotice(`${schema.plural} notes now use ${tpl.name}.`, { label: 'Undo', run: () => s.noteTemplates.assign(schema.id, prev) });
				this.refresh();
			},
		});
		if (chosen)
			button(actions, {
				label: 'Restore default',
				icon: 'rotate-ccw',
				variant: 'ghost',
				size: 'sm',
				cls: 'ws-nns__restore',
				tooltip: 'Back to the built-in template that fits this type',
				onClick: () => {
					const prev = s.noteTemplates.assign(schema.id, null);
					actionNotice(`${schema.plural} notes use the built-in template again.`, { label: 'Undo', run: () => s.noteTemplates.assign(schema.id, prev) });
					this.refresh();
				},
			});
		if (tpl.builtIn)
			button(actions, {
				label: 'Customize',
				icon: 'copy',
				variant: 'ghost',
				size: 'sm',
				cls: 'ws-nns__customize',
				tooltip: 'Built-in templates stay as they are; customise a copy of your own',
				onClick: () => {
					const copy = s.noteTemplates.duplicate(tpl.id);
					if (copy) this.selected = copy.id;
					this.refresh();
				},
			});
		button(actions, { icon: 'more-horizontal', variant: 'quiet', size: 'sm', tooltip: 'More', cls: 'ws-nns__more', onClick: (evt) => this.templateMenu(evt, tpl, schema) });

		const cols = el.createDiv({ cls: 'ws-nns__cols' });
		const left = cols.createDiv({ cls: 'ws-nns__edit' });
		if (tpl.builtIn) {
			const n = left.createDiv({ cls: 'ws-nns__locked' });
			icon(n, 'lock');
			n.createSpan({ text: 'Built-in templates can’t be changed. Customize makes a copy you can rearrange and restyle.' });
		}
		this.renderSections(left, tpl, schema);
		this.renderAppearance(left, tpl);
		this.renderPreview(cols.createDiv({ cls: 'ws-ls__sec ws-ls__preview ws-nns__preview' }), tpl, schema);
	}

	// ── sections ────────────────────────────────────────────────────────────

	private renderSections(host: HTMLElement, tpl: NoteTemplate, schema: EntitySchema): void {
		const s = this.s;
		const ro = !!tpl.builtIn;
		const sec = host.createDiv({ cls: 'ws-nns__group' });
		sec.createDiv({ cls: 'ws-nn-label', text: 'Sections' });
		const list = sec.createDiv({ cls: 'ws-nns__sections' });
		const save = (sections: NoteSection[], msg?: string) => {
			const r = s.noteTemplates.update(tpl.id, { sections });
			if (r && msg) actionNotice(msg, { label: 'Undo', run: () => s.noteTemplates.update(tpl.id, { sections: r.before.sections }) });
			this.refresh();
		};
		tpl.sections.forEach((x, i) => {
			const row = list.createDiv({ cls: cx('ws-nns__section', x.hidden && 'is-hidden'), attr: { 'data-section': x.id } });
			const meta = KIND_LABEL[x.kind];
			icon(row, meta.icon, 'ws-nns__section-icon');
			const txt = row.createDiv({ cls: 'ws-nns__section-text' });
			const f = x.kind === 'field' ? schema.fields.find((y) => y.id === x.fields?.[0]) : undefined;
			txt.createDiv({ cls: 'ws-nns__section-name', text: x.kind === 'field' ? (f?.label ?? 'Missing field') : x.title || meta.label });
			txt.createDiv({ cls: 'ws-nns__section-hint', text: x.fields?.length && x.kind !== 'field' ? `${x.fields.length} chosen field${x.fields.length === 1 ? '' : 's'}` : meta.hint });
			if (ro) return;
			const tools = row.createDiv({ cls: 'ws-nns__section-tools' });
			button(tools, { icon: 'arrow-up', variant: 'quiet', size: 'sm', tooltip: 'Move up', disabled: i === 0, onClick: () => save(move(tpl.sections, i, -1)) });
			button(tools, { icon: 'arrow-down', variant: 'quiet', size: 'sm', tooltip: 'Move down', disabled: i === tpl.sections.length - 1, onClick: () => save(move(tpl.sections, i, 1)) });
			button(tools, { icon: x.hidden ? 'eye-off' : 'eye', variant: 'quiet', size: 'sm', tooltip: x.hidden ? 'Show' : 'Hide', onClick: () => save(tpl.sections.map((y) => (y.id === x.id ? { ...y, hidden: !y.hidden } : y))) });
			button(tools, { icon: 'more-horizontal', variant: 'quiet', size: 'sm', tooltip: 'Options', onClick: (evt) => this.sectionMenu(evt, tpl, schema, x, save) });
		});
		if (!ro) {
			button(sec, { label: 'Add section', icon: 'plus', variant: 'ghost', size: 'sm', cls: 'ws-nns__add', onClick: (evt) => this.addMenu(evt, tpl, schema, save) });
		}
		// Long fields with no section of their own (only when the type's sections aren't shown).
		if (!tpl.sections.some((x) => x.kind === 'schemaSections' && !x.hidden)) {
			const placed = new Set(tpl.sections.filter((x) => x.kind === 'field').map((x) => x.fields?.[0]));
			const tray = longFields(schema).filter((f) => !placed.has(f.id) && !f.hidden);
			if (tray.length) {
				const t = sec.createDiv({ cls: 'ws-nns__tray' });
				t.createDiv({ cls: 'ws-nn-label', text: 'Not placed yet' });
				t.createDiv({ cls: 'ws-nn-faint', text: 'These long-text fields get a section before the footer once they have text. Place them to choose where.' });
				const chips = t.createDiv({ cls: 'ws-nns__chips' });
				for (const f of tray) {
					const c = chips.createEl('button', { cls: 'ws-chip', text: f.label, attr: { type: 'button', ...(ro ? { disabled: '' } : {}) } });
					if (!ro) c.addEventListener('click', () => save(insertBeforeFooter(tpl.sections, { id: sectionId(f.id, new Set(tpl.sections.map((y) => y.id))), kind: 'field', fields: [f.id] })));
				}
			}
		}
		sec.createDiv({ cls: 'ws-nn-faint ws-nns__note', text: 'Every short field (text, numbers, dates, choices, lists) is always in the note’s Properties, whether or not it is shown in a section.' });
	}

	private addMenu(evt: MouseEvent, tpl: NoteTemplate, schema: EntitySchema, save: (s: NoteSection[], msg?: string) => void): void {
		const m = new Menu();
		const taken = new Set(tpl.sections.map((x) => x.id));
		const add = (sec: Omit<NoteSection, 'id'>, base: string) => save(insertBeforeFooter(tpl.sections, { ...sec, id: sectionId(base, taken) }));
		for (const k of ['facts', 'heading', 'separator', 'connections', 'children', 'gallery', 'schemaSections', 'banner', 'infocard', 'title', 'summary', 'footer'] as NoteSectionKind[]) {
			if (['banner', 'infocard', 'title', 'summary', 'footer', 'schemaSections'].includes(k) && tpl.sections.some((x) => x.kind === k)) continue;
			m.addItem((i) =>
				i
					.setTitle(KIND_LABEL[k].label)
					.setIcon(KIND_LABEL[k].icon)
					.onClick(async () => {
						if (k === 'heading') {
							const t = await promptModal(this.ws.app, { title: 'Heading', label: 'Text', value: 'Notes' });
							if (t) add({ kind: 'heading', title: t }, t);
						} else add({ kind: k, ...(k === 'facts' ? { title: 'At a glance' } : {}) }, k);
					}),
			);
		}
		const placed = new Set(tpl.sections.filter((x) => x.kind === 'field').map((x) => x.fields?.[0]));
		const longs = longFields(schema).filter((f) => !placed.has(f.id));
		if (longs.length) {
			m.addSeparator();
			for (const f of longs) m.addItem((i) => i.setTitle(`Text: ${f.label}`).setIcon('align-left').onClick(() => add({ kind: 'field', fields: [f.id] }, f.id)));
		}
		m.showAtMouseEvent(evt);
	}

	private sectionMenu(evt: MouseEvent, tpl: NoteTemplate, schema: EntitySchema, x: NoteSection, save: (s: NoteSection[], msg?: string) => void): void {
		const m = new Menu();
		const patch = (p: Partial<NoteSection>) => save(tpl.sections.map((y) => (y.id === x.id ? { ...y, ...p } : y)));
		if (['facts', 'connections', 'children', 'gallery', 'heading'].includes(x.kind)) {
			m.addItem((i) =>
				i.setTitle('Rename…').setIcon('pencil').onClick(async () => {
					const t = await promptModal(this.ws.app, { title: 'Section title', label: 'Title', value: x.title ?? KIND_LABEL[x.kind].label });
					if (t !== null) patch({ title: t.trim() || undefined });
				}),
			);
		}
		if (x.kind === 'facts' || x.kind === 'infocard') {
			m.addItem((i) => i.setTitle(x.fields?.length ? 'Choose fields automatically' : 'Fields: chosen automatically').setIcon('wand-2').setChecked(!x.fields?.length).onClick(() => patch({ fields: undefined })));
			const fieldsMenu = (i: { setSubmenu?: () => Menu }) => (typeof i.setSubmenu === 'function' ? i.setSubmenu() : m);
			m.addItem((i) => {
				i.setTitle('Fields…').setIcon('list-checks');
				const sub = fieldsMenu(i as never);
				for (const f of schema.fields.filter((y) => fieldHome(y) !== 'section' && !['image', 'file', 'gallery', 'formula'].includes(y.type))) {
					const on = !!x.fields?.includes(f.id);
					sub.addItem((j) =>
						j
							.setTitle(f.label)
							.setChecked(on)
							.onClick(() => patch({ fields: on ? (x.fields ?? []).filter((id) => id !== f.id) : [...(x.fields ?? []), f.id] })),
					);
				}
			});
		}
		if (['facts', 'connections', 'children', 'gallery'].includes(x.kind)) {
			for (const [fold, label] of [
				['none', 'Always open'],
				['open', 'Collapsible, open'],
				['closed', 'Collapsible, closed'],
			] as const)
				m.addItem((i) => i.setTitle(label).setChecked((x.fold ?? 'none') === fold).onClick(() => patch({ fold })));
		}
		if (x.kind === 'connections') m.addItem((i) => i.setTitle('Also as a table').setChecked(!!x.table).onClick(() => patch({ table: !x.table })));
		m.addSeparator();
		m.addItem((i) =>
			i
				.setTitle('Remove')
				.setIcon('trash-2')
				.setWarning(true)
				.onClick(() => save(tpl.sections.filter((y) => y.id !== x.id), `Removed “${x.title || KIND_LABEL[x.kind].label}”. Your own text in notes is never touched.`)),
		);
		m.showAtMouseEvent(evt);
	}

	// ── appearance ──────────────────────────────────────────────────────────

	private renderAppearance(host: HTMLElement, tpl: NoteTemplate): void {
		const s = this.s;
		const ro = !!tpl.builtIn;
		const sec = host.createDiv({ cls: 'ws-nns__group ws-nns__look' });
		sec.createDiv({ cls: 'ws-nn-label', text: 'Look' });
		sec.createDiv({ cls: 'ws-nn-faint', text: 'Changes here rewrite no note.' });
		const set = (p: Partial<NoteAppearance>) => {
			const r = s.noteTemplates.update(tpl.id, { appearance: { ...tpl.appearance, ...p } });
			if (r) actionNotice('Look changed.', { label: 'Undo', run: () => s.noteTemplates.update(tpl.id, { appearance: r.before.appearance }) }, 4000);
			this.refresh();
		};
		const sw = sec.createDiv({ cls: 'ws-nns__accents', attr: { role: 'radiogroup', 'aria-label': 'Accent' } });
		for (const [id, label, color] of ACCENTS) {
			const on = tpl.appearance.accent === id;
			const b = sw.createEl('button', { cls: cx('ws-nns__accent', on && 'is-active'), attr: { type: 'button', role: 'radio', 'aria-checked': String(on), 'aria-label': label, 'data-accent': id, ...(ro ? { disabled: '' } : {}) } });
			b.style.setProperty('--sw', color);
			if (!ro) b.addEventListener('click', () => set({ accent: id }));
		}
		const seg = <K extends keyof NoteAppearance>(label: string, key: K, opts: Array<[NoteAppearance[K], string]>) => {
			const row = sec.createDiv({ cls: 'ws-nns__look-row' });
			row.createSpan({ cls: 'ws-nns__look-label', text: label });
			const g = row.createDiv({ cls: 'ws-segmented ws-segmented--sm', attr: { role: 'radiogroup', 'aria-label': label } });
			for (const [v, t] of opts) {
				const on = tpl.appearance[key] === v;
				const b = g.createEl('button', { cls: cx('ws-segmented__item', on && 'is-active'), text: t, attr: { type: 'button', role: 'radio', 'aria-checked': String(on), 'data-value': String(v), ...(ro ? { disabled: '' } : {}) } });
				if (!ro) b.addEventListener('click', () => set({ [key]: v }));
			}
		};
		seg('Style', 'style', [
			['dossier', 'Dossier'],
			['chronicle', 'Chronicle'],
			['fieldguide', 'Field guide'],
			['atlas', 'Atlas'],
			['plain', 'Plain'],
		]);
		seg('Title font', 'titleFont', [
			['codex', 'Worldsmith Codex'],
			['theme', 'Theme'],
		]);
		seg('Portrait', 'portrait', [
			['right', 'Right'],
			['left', 'Left'],
			['none', 'None'],
		]);
		seg('Density', 'density', [
			['detailed', 'Detailed'],
			['compact', 'Compact'],
		]);
		seg('Headings', 'headings', [
			['ornament', 'Ornament'],
			['rule', 'Rule'],
			['plain', 'Plain'],
		]);
		seg('Properties in Reading view', 'hideProperties', [
			[true, 'Folded away'],
			[false, 'Shown'],
		]);
	}

	// ── preview ─────────────────────────────────────────────────────────────

	private renderPreview(sec: HTMLElement, tpl: NoteTemplate, schema: EntitySchema): void {
		const s = this.s;
		const bar = sec.createDiv({ cls: 'ws-ls__bar' });
		bar.createDiv({ cls: 'ws-ls__bar-label' }).createSpan({ cls: 'ws-ls__h', text: 'Preview' });
		const entries = s.entities
			.all()
			.filter((e) => e.typeId === schema.id && !e.trashedAt)
			.sort((a, b) => Number(!!b.nativeNote) - Number(!!a.nativeNote) || richness(b) - richness(a));
		if (!entries.some((e) => e.id === this.sampleId)) this.sampleId = entries[0]?.id ?? null;
		const sample = this.sampleId ? s.entities.get(this.sampleId) : undefined;
		const tools = bar.createDiv({ cls: 'ws-ls__tools' });
		if (entries.length) {
			const pick = tools.createEl('select', { cls: 'dropdown ws-ls__sample', attr: { 'aria-label': `Preview on which ${schema.singular.toLowerCase()}` } });
			for (const e of entries.slice(0, 80)) pick.createEl('option', { value: e.id, text: e.name });
			pick.value = this.sampleId ?? '';
			pick.addEventListener('change', () => {
				this.sampleId = pick.value;
				this.refresh();
			});
		}
		const seg = tools.createDiv({ cls: 'ws-segmented ws-segmented--sm ws-ls__device', attr: { role: 'radiogroup' } });
		for (const [id, ic, tip] of [
			['desktop', 'monitor', 'Wide pane'],
			['phone', 'smartphone', 'Phone'],
		] as const) {
			const on = this.device === id;
			const b = seg.createEl('button', { cls: cx('ws-segmented__item', on && 'is-active'), attr: { type: 'button', role: 'radio', 'aria-checked': String(on), 'aria-label': tip, 'data-device': id } });
			setIcon(b, ic);
			b.addEventListener('click', () => {
				this.device = id;
				this.refresh();
			});
		}
		const frame = sec.createDiv({ cls: cx('ws-nns__frame', `is-${this.device}`) });
		pinStyles(frame, '.markdown-preview-sizer', { minHeight: '0' });
		if (!sample) {
			emptyState(frame, { icon: schema.icon, title: `No ${schema.plural.toLowerCase()} to preview on yet`, compact: true });
			return;
		}
		const comp = new Component();
		this.preview = comp;
		this.component.addChild(comp);
		const text = this.ws.nativeNotes.compose(sample, tpl.id).replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');
		const view = frame.createDiv({ cls: `markdown-preview-view markdown-rendered ws-note ${tplClass(tpl.id)} ws-nns__note`, attr: { inert: '', 'aria-label': `Preview of ${sample.name}’s note` } });
		const sizer = view.createDiv({ cls: 'markdown-preview-sizer markdown-preview-section' });
		this.previewReady = MarkdownRenderer.render(this.ws.app, text, sizer, sample.nativeNote?.path ?? '', comp).then(() => wrapSections(sizer));
		const foot = sec.createDiv({ cls: 'ws-nn-faint ws-nns__foot' });
		foot.setText(sample.nativeNote ? `This is ${sample.name}’s note as this template would write it. Nothing is saved until you choose “Use for ${schema.plural}”.` : `${sample.name} has no native note yet; this is how it would look.`);
	}

	// ── templates ───────────────────────────────────────────────────────────

	private fromPage(schema: EntitySchema): void {
		const s = this.s;
		const sections = sectionsFromLayout({ blocks: s.layouts.typeLayout(schema).blocks }, schema);
		const t = s.noteTemplates.create({ name: `${schema.singular} page`, icon: schema.icon, description: `Made from the ${schema.singular.toLowerCase()} page layout.`, sections });
		this.selected = t.id;
		actionNotice(`Made “${t.name}” from the page layout.`, { label: 'Undo', run: () => s.noteTemplates.remove(t.id) });
		this.refresh();
	}

	private templateMenu(evt: MouseEvent, tpl: NoteTemplate, schema: EntitySchema): void {
		const s = this.s;
		const m = new Menu();
		m.addItem((i) =>
			i.setTitle('Duplicate').setIcon('copy').onClick(() => {
				const c = s.noteTemplates.duplicate(tpl.id);
				if (c) this.selected = c.id;
				this.refresh();
			}),
		);
		if (!tpl.builtIn) {
			m.addItem((i) =>
				i.setTitle('Rename…').setIcon('pencil').onClick(async () => {
					const n = await promptModal(this.ws.app, { title: 'Rename template', label: 'Name', value: tpl.name });
					if (n?.trim()) s.noteTemplates.update(tpl.id, { name: n });
					this.refresh();
				}),
			);
		}
		m.addItem((i) => i.setTitle('Export template file…').setIcon('download').onClick(() => void exportTemplate(this.ws, tpl.id)));
		m.addItem((i) => i.setTitle('Import template file…').setIcon('upload').onClick(() => importTemplate(this.ws, (t) => { this.selected = t.id; this.refresh(); })));
		if (!tpl.builtIn) {
			m.addSeparator();
			m.addItem((i) =>
				i
					.setTitle('Delete template')
					.setIcon('trash-2')
					.setWarning(true)
					.onClick(async () => {
						const users = [...s.entities.values()].filter((e) => e.nativeNote?.templateId === tpl.id);
						const ok = await confirmModal(this.ws.app, { title: `Delete “${tpl.name}”?`, body: `Notes using it go back to their type’s template${users.length ? ` (${users.length} chose it themselves)` : ''}. Only Worldsmith’s parts change; your text stays.`, confirmLabel: 'Delete', danger: true });
						if (!ok) return;
						const r = s.noteTemplates.remove(tpl.id);
						for (const e of users) this.ws.nativeNotes.setTemplate(e, null);
						this.selected = s.noteTemplates.forType(schema).id;
						if (r) actionNotice(`Deleted “${tpl.name}”.`, { label: 'Undo', run: () => { s.noteTemplates.restore(r.template, r.types); for (const e of users) { const n = s.entities.get(e.id); if (n) this.ws.nativeNotes.setTemplate(n, tpl.id); } } });
						this.refresh();
					}),
			);
		}
		m.showAtMouseEvent(evt);
	}
}

function richness(e: EntityRecord): number {
	return Object.values(e.values).filter((v) => v !== null && v !== undefined && v !== '' && !(Array.isArray(v) && !v.length)).length + (e.description ? 2 : 0) + (e.media.portrait ? 2 : 0);
}

function move<T>(arr: T[], i: number, d: number): T[] {
	const out = arr.slice();
	const j = i + d;
	if (j < 0 || j >= out.length) return out;
	[out[i], out[j]] = [out[j]!, out[i]!];
	return out;
}

function insertBeforeFooter(sections: NoteSection[], sec: NoteSection): NoteSection[] {
	const i = sections.findIndex((x) => x.kind === 'footer');
	const out = sections.slice();
	out.splice(i === -1 ? out.length : i, 0, sec);
	return out;
}

/** Reading view wraps each block in a div; the preview does the same so note styles apply. */
function wrapSections(sizer: HTMLElement): void {
	for (const child of Array.from(sizer.children)) {
		const tag = child.tagName.toLowerCase();
		const cls = child.classList.contains('callout') ? 'el-div' : tag === 'p' ? 'el-p' : tag === 'blockquote' ? 'el-blockquote' : /^h[1-6]$/.test(tag) ? `el-${tag}` : tag === 'hr' ? 'el-hr' : tag === 'table' ? 'el-table' : tag === 'ul' ? 'el-ul' : 'el-div';
		const wrap = createDiv({ cls });
		child.replaceWith(wrap);
		wrap.appendChild(child);
	}
}

async function exportTemplate(ws: WorldsmithContext, id: string): Promise<void> {
	const s = ws.worlds.session;
	const text = s?.noteTemplates.exportFile(id);
	const t = s?.noteTemplates.get(id);
	if (!text || !t) return;
	const folder = (ws.settings.notesFolder || 'Worldsmith').replace(/\/+$/, '');
	const base = `${folder}/Note templates/${t.name.replace(/[\\/:*?"<>|#^[\]]+/g, ' ').trim() || 'Template'}`;
	let path = `${base}.json`;
	for (let n = 2; ws.app.vault.getAbstractFileByPath(path); n++) path = `${base} ${n}.json`;
	const dir = path.slice(0, path.lastIndexOf('/'));
	if (!(await ws.app.vault.adapter.exists(dir))) await ws.app.vault.createFolder(dir).catch(() => undefined);
	await ws.app.vault.create(path, text);
	new Notice(`Saved the template as ${path}.`);
}

function importTemplate(ws: WorldsmithContext, done: (t: NoteTemplate) => void): void {
	const input = createEl('input');
	input.type = 'file';
	input.accept = '.json,application/json';
	input.addEventListener('change', () => {
		const f = input.files?.[0];
		if (!f) return;
		void f.text().then((text) => {
			try {
				const t = ws.worlds.session!.noteTemplates.importFile(text);
				new Notice(`Imported “${t.name}”.`);
				done(t);
			} catch (e) {
				new Notice(e instanceof Error ? e.message : String(e));
			}
		});
	});
	input.click();
}
