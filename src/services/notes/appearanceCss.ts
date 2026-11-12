import type { NoteAccent, NoteTemplate } from '../../core/types';
import { hashText } from './format';

/**
 * Per-template look of native notes (0.17), pure: accent, title font, density, portrait,
 * headings and style become CSS rules keyed by `.ws-note.ws-tpl-<id>`. Notes only carry
 * the class, so changing a template's look rewrites no note.
 */

const ACCENTS: Record<Exclude<NoteAccent, 'theme'>, { dark: [string, string]; light: [string, string] }> = {
	bronze: { dark: ['#bb915e', '#d4a774'], light: ['#8f6236', '#8a5f33'] },
	crimson: { dark: ['#b5524a', '#d9776a'], light: ['#9a3b31', '#9a3b31'] },
	verdigris: { dark: ['#6eaaa4', '#8cc4bd'], light: ['#2f746d', '#2b6b64'] },
	violet: { dark: ['#a084bb', '#bba3d3'], light: ['#6e4d91', '#6a4a8c'] },
	azure: { dark: ['#6f9fd8', '#93b9e6'], light: ['#2f63a0', '#2d5f9a'] },
};

/** A template id reduced to characters that are safe anywhere in CSS (0.20.2: ids can come from imports). */
export function safeTplId(id: string): string {
	return String(id).replace(/[^A-Za-z0-9_-]/g, '-');
}

/** CSS class-safe template id. */
export function tplClass(id: string): string {
	return `ws-tpl-${safeTplId(id)}`;
}

export function templateCss(t: Pick<NoteTemplate, 'id' | 'appearance'>): string {
	const a = t.appearance;
	const sel = `.ws-note.${tplClass(t.id)}`;
	const rv = `.markdown-preview-view${sel}`;
	const lp = `.markdown-source-view.is-live-preview${sel}`;
	const out: string[] = [];
	const vars: string[] = [];
	if (a.accent === 'theme') vars.push('--wsn-accent: var(--interactive-accent)', '--wsn-accent-text: var(--text-accent)');
	else {
		const c = ACCENTS[a.accent] ?? ACCENTS.bronze;
		vars.push(`--wsn-accent: ${c.dark[0]}`, `--wsn-accent-text: ${c.dark[1]}`);
		out.push(`.theme-light ${sel} { --wsn-accent: ${c.light[0]}; --wsn-accent-text: ${c.light[1]}; }`);
	}
	if (a.titleFont === 'theme') vars.push('--wsn-display: var(--font-text)');
	if (a.density === 'compact') vars.push('--wsn-gap: 1em', '--wsn-title-size: 2.5em', '--wsn-card-width: 260px');
	out.unshift(`${sel} { ${vars.join('; ')}; }`);
	if (a.style === 'plain') {
		out.push(`.markdown-preview-view${sel}, ${lp} { background: var(--background-primary); color: var(--text-normal); }`);
		out.push(`.theme-light ${sel}, ${sel} { --wsn-ink: var(--text-normal); --wsn-muted: var(--text-muted); --wsn-faint: var(--text-faint); --wsn-panel: var(--background-secondary); --wsn-panel-2: var(--background-modifier-hover); --wsn-line: var(--background-modifier-border); --wsn-page: var(--background-primary); }`);
	}
	if (a.style === 'chronicle') {
		out.push(`${sel} h1, ${sel} .ws-kicker, ${sel} .ws-aliases, ${lp} .HyperMD-header-1 { text-align: center; }`);
		out.push(`${rv} .el-blockquote blockquote { border-left: 0; text-align: center; padding: 0.4em 2em; }`);
		out.push(`${sel} h2 { justify-content: center; border-bottom: 0; }`, `${sel} h2::after { content: '❖'; color: var(--wsn-accent); font-size: 0.6em; }`, `${lp} .HyperMD-header-2 { text-align: center; border-bottom: 0; }`);
	}
	if (a.style === 'fieldguide') out.push(`${sel} h2, ${lp} .HyperMD-header-2 { text-transform: uppercase; letter-spacing: 0.08em; font-size: 1.2em; }`);
	if (a.style === 'atlas') out.push(`${sel} img[alt='ws-banner'] { height: 270px; }`);
	if (a.headings === 'rule' || a.headings === 'plain') out.push(`${sel} h2::before, ${sel} h2::after { content: none; }`);
	if (a.headings === 'plain') out.push(`${sel} h2, ${lp} .HyperMD-header-2 { border-bottom: 0; }`);
	if (a.portrait === 'left') out.push(`${rv} .callout[data-callout='ws-infobox'] { float: left; margin: 0.3em 1.6em 1em 0; }`);
	if (!a.hideProperties) out.push(`${rv} .metadata-container { display: block; }`);
	return out.join('\n');
}

/** Rules for every template (built-ins and people's), in one stylesheet. */
export function templatesCss(templates: Array<Pick<NoteTemplate, 'id' | 'appearance'>>): string {
	// Markers use the safe id: a raw id could close the comment and add rules of its own.
	return templates.map((t) => `/* tpl:${safeTplId(t.id)} */\n${templateCss(t)}\n/* end tpl:${safeTplId(t.id)} */`).join('\n');
}

// ── the CSS snippet (notes stay styled with Worldsmith off) ────────────────────

export const SNIPPET_MARK = 'Worldsmith notes snippet';

/** The snippet file: a header with the hash of what follows, then the CSS. */
export function snippetText(css: string): string {
	return `/* ${SNIPPET_MARK} · written by the Worldsmith plugin · ws-hash:${hashText(css)}\n * Styles Worldsmith's native notes (cssclasses: ws-note), also while the plugin is off.\n * Worldsmith rewrites this file only while it is unchanged; edit a copy to customise it. */\n${css}`;
}

/**
 * Who owns an existing snippet file: absent, Worldsmith's and unedited (safe to rewrite),
 * or someone else's / edited (never overwritten).
 */
export function snippetOwnership(existing: string | null): 'absent' | 'ours' | 'foreign' {
	if (existing === null) return 'absent';
	const m = /^\/\* Worldsmith notes snippet · written by the Worldsmith plugin · ws-hash:([a-z0-9]+)\n[^]*?\*\/\n/.exec(existing);
	if (!m) return 'foreign';
	const body = existing.slice(m[0].length);
	return hashText(body) === m[1] ? 'ours' : 'foreign';
}

/** Template rules kept from an earlier snippet (other worlds' templates). */
export function snippetTemplateBlocks(existing: string): Map<string, string> {
	const out = new Map<string, string>();
	for (const m of existing.matchAll(/\/\* tpl:([A-Za-z0-9_-]+) \*\/\n([^]*?)\n\/\* end tpl:\1 \*\//g)) out.set(m[1]!, m[0]);
	return out;
}

/**
 * The file name to write: the usual one when it's free or Worldsmith's unedited file,
 * otherwise the first free (or ours) "worldsmith-notes-2", "-3", …
 */
export function pickSnippetName(base: string, read: (name: string) => string | null): string {
	for (let n = 1; n < 50; n++) {
		const name = n === 1 ? base : `${base}-${n}`;
		if (snippetOwnership(read(name)) !== 'foreign') return name;
	}
	return `${base}-${Date.now()}`;
}
