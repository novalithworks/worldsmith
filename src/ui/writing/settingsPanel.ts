import type { WorldsmithContext } from '../../app/context';
import { debounce } from '../../core/util/async';
import { WRITING_LIMITS, type WritingFont, type WritingSettings, type WritingSurface } from '../../settings/settings';
import { button } from '../components/dom';
import { Popover } from '../components/popover';
import { openPluginSettings } from '../obsidianInternals';
import { formRow, segmented, toggle } from '../views/routes/typeStudio/common';

/*
 * The small "Writing settings" panel from the studio's top bar (WS3). The same settings are
 * in Settings › Worldsmith › Writing Studio. Changes show at once and are saved a moment
 * later.
 */

const SURFACES: Array<{ id: WritingSurface; label: string }> = [
	{ id: 'theme', label: 'Theme' },
	{ id: 'paper', label: 'Paper' },
	{ id: 'dark', label: 'Dark' },
];
const FONTS: Record<WritingFont, string> = { book: 'Book serif', theme: 'Theme font', custom: 'A font I name' };

/** The writing controls (surface, width, leading, size, font, typewriter, dim), drawn into `el`. */
export function renderWritingControls(el: HTMLElement, ws: WorldsmithContext, redraw: () => void): void {
	const save = debounce(() => void ws.saveSettings(), 400);
	const set = (patch: Partial<WritingSettings>, now = false) => {
		ws.settings.writing = { ...ws.settings.writing, ...patch };
		// Shown at once (the studio repaints on this event); written to disk a moment later.
		ws.events.emit('settings:changed', { keys: ['writing'] });
		if (now) {
			save.cancel();
			void ws.saveSettings();
		} else save();
	};
	const w = ws.settings.writing;
	const surf = formRow(el, 'Writing surface', 'The page you write on. Paper is warm parchment in both light and dark mode.');
	surf.parentElement?.addClass('ws-wr-setpop__stack');
	segmented(surf, SURFACES, w.surface, (v) => {
		set({ surface: v }, true);
		redraw();
	}, 'Writing surface');
	slider(el, 'Page width', `${w.pageWidth} characters`, WRITING_LIMITS.pageWidth, w.pageWidth, 'ws-wr-set-width', (v, label) => {
		label.setText(`${v} characters`);
		set({ pageWidth: v });
	});
	slider(el, 'Line height', w.lineHeight.toFixed(2), WRITING_LIMITS.lineHeight, w.lineHeight, 'ws-wr-set-leading', (v, label) => {
		label.setText(v.toFixed(2));
		set({ lineHeight: v });
	});
	slider(el, 'Text size', `${w.fontSize}px`, WRITING_LIMITS.fontSize, w.fontSize, 'ws-wr-set-size', (v, label) => {
		label.setText(`${v}px`);
		set({ fontSize: v });
	});
	const font = formRow(el, 'Text font', 'Your theme’s font, Worldsmith’s book serif, or any installed font.');
	font.parentElement?.addClass('ws-wr-setpop__short');
	const sel = font.createEl('select', { cls: 'dropdown ws-wr-set-font', attr: { 'aria-label': 'Text font' } });
	for (const [id, label] of Object.entries(FONTS)) sel.createEl('option', { text: label, attr: { value: id } });
	sel.value = w.font;
	sel.addEventListener('change', () => {
		set({ font: sel.value as WritingFont }, true);
		redraw();
	});
	if (w.font === 'custom') {
		const row = el.createDiv({ cls: 'ws-wr-setpop__custom' });
		const inp = row.createEl('input', { cls: 'ws-wr-set-customfont', attr: { type: 'text', placeholder: 'e.g. Literata', 'aria-label': 'Font name', spellcheck: 'false' } });
		inp.value = w.customFont;
		inp.addEventListener('input', () => set({ customFont: inp.value.trim() }));
		row.createDiv({ cls: 'ws-frow__hint', text: 'A font installed on this device.' });
	}
	const short = (row: HTMLElement) => (row.parentElement?.addClass('ws-wr-setpop__short'), row);
	toggle(short(formRow(el, 'Typewriter mode', 'Keep the line you’re writing in the middle of the screen.')), w.typewriter, (v) => {
		set({ typewriter: v }, true);
		redraw();
	}, 'Typewriter mode').addClass('ws-wr-set-typewriter');
	toggle(short(formRow(el, 'Dim other paragraphs', 'In typewriter mode, fade everything but the paragraph you’re in.')), w.dimOthers, (v) => {
		set({ dimOthers: v }, true);
		redraw();
	}, 'Dim other paragraphs').addClass('ws-wr-set-dim');
}

export function openWritingSettings(ws: WorldsmithContext, anchor: HTMLElement, openPage?: () => void): Popover {
	const pop = new Popover(anchor, { cls: 'ws-wr-setpop', width: 320, label: 'Writing settings' });
	const draw = () => {
		const el = pop.el;
		el.empty();
		el.createDiv({ cls: 'ws-wr-setpop__title', text: 'Writing settings' });
		renderWritingControls(el, ws, draw);
		const foot = el.createDiv({ cls: 'ws-wr-setpop__foot' });
		if (openPage)
			button(foot, {
				label: 'All writing settings…',
				icon: 'sliders-horizontal',
				variant: 'quiet',
				size: 'sm',
				cls: 'ws-wr-setpop__page',
				onClick: () => {
					pop.close();
					openPage();
				},
			});
		button(foot, {
			label: 'All Worldsmith settings',
			icon: 'settings',
			variant: 'quiet',
			size: 'sm',
			onClick: () => {
				pop.close();
				openPluginSettings(ws.app, ws.plugin.manifest.id);
			},
		});
		pop.position();
	};
	draw();
	return pop;
}

function slider(parent: HTMLElement, label: string, value: string, lim: { min: number; max: number; step: number }, cur: number, cls: string, onInput: (v: number, label: HTMLElement) => void): void {
	const row = formRow(parent, label);
	row.addClass('ws-wr-setpop__slider');
	const inp = row.createEl('input', { cls: `ws-range ${cls}`, attr: { type: 'range', min: String(lim.min), max: String(lim.max), step: String(lim.step), 'aria-label': label } });
	inp.value = String(cur);
	const out = row.createSpan({ cls: 'ws-wr-setpop__value', text: value });
	inp.addEventListener('input', () => onInput(Number(inp.value), out));
}
