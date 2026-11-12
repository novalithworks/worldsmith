import type { App } from 'obsidian';

/**
 * "Why does Worldsmith look wrong in this vault?" — finds CSS from themes, snippets and
 * other plugins that applies to Worldsmith's elements, plus a snapshot of how the
 * affected elements actually rendered. Read-only; produces a Markdown report the user
 * can paste back.
 */

const SNAPSHOT_PROPS = [
	'display',
	'position',
	'box-sizing',
	'width',
	'height',
	'max-height',
	'min-height',
	'margin',
	'padding',
	'border',
	'border-radius',
	'background-color',
	'background-image',
	'overflow',
	'transform',
	'contain',
	'content-visibility',
] as const;

interface Hit {
	origin: string;
	selector: string;
	declarations: string;
	matched: Set<string>;
}

export function buildStyleReport(app: App, doc: Document = document): { text: string; hits: number; scope: string } {
	const card = doc.querySelector<HTMLElement>('.worldsmith .ws-card');
	const scopeEl = card ?? doc.querySelector<HTMLElement>('.worldsmith .ws-shell__page') ?? doc.querySelector<HTMLElement>('.worldsmith');
	const scope = card ? 'a database card' : scopeEl ? 'the current Worldsmith page' : 'nothing (no Worldsmith pane open)';
	const targets: HTMLElement[] = [];
	if (scopeEl) {
		targets.push(scopeEl);
		scopeEl.querySelectorAll<HTMLElement>('*').forEach((el, i) => {
			if (i < 400) targets.push(el);
		});
	}

	const hits = new Map<string, Hit>();
	const sheets = Array.from(doc.styleSheets);
	sheets.forEach((sheet, index) => {
		let rules: CSSRuleList;
		try {
			rules = sheet.cssRules;
		} catch {
			return; // cross-origin sheet: unreadable, and not a theme/plugin sheet anyway
		}
		if (isOwnSheet(rules) || isCoreSheet(sheet)) return;
		const origin = originOf(sheet, rules, index);
		walk(rules, (rule) => {
			const sel = rule.selectorText;
			if (!sel || !/[.#[]/.test(sel)) return; // ignore bare element selectors (div, *, body)
			const decls = declarations(rule.style);
			if (!decls) return;
			for (const el of targets) {
				let ok = false;
				try {
					ok = el.matches(sel);
				} catch {
					return;
				}
				if (!ok) continue;
				const key = `${origin}\n${sel}`;
				const hit = hits.get(key) ?? { origin, selector: sel, declarations: decls, matched: new Set<string>() };
				hit.matched.add(describe(el));
				hits.set(key, hit);
			}
		});
	});

	const lines: string[] = [];
	lines.push('# Worldsmith style report', '');
	lines.push(`Inspected: ${scope}`);
	lines.push(`Theme: ${safe(() => (app as unknown as { customCss?: { theme?: string } }).customCss?.theme) || 'default'}`);
	lines.push(`CSS snippets on: ${list(safe(() => (app as unknown as { customCss?: { enabledSnippets?: Set<string> } }).customCss?.enabledSnippets))}`);
	lines.push(`Community plugins on: ${list(safe(() => (app as unknown as { plugins?: { enabledPlugins?: Set<string> } }).plugins?.enabledPlugins))}`);
	lines.push(`Body classes: ${doc.body.className}`);
	lines.push('');

	if (card) {
		lines.push('## How the card rendered', '');
		for (const [label, el] of [
			['card', card],
			['media', card.querySelector('.ws-card__media')],
			['body', card.querySelector('.ws-card__body')],
			['foot', card.querySelector('.ws-card__foot')],
			['status', card.querySelector('.ws-card__status')],
			['grid', card.parentElement],
		] as const) {
			if (!el) continue;
			const cs = getComputedStyle(el);
			const r = el.getBoundingClientRect();
			lines.push(`- **${label}** (${Math.round(r.width)}×${Math.round(r.height)}): ${SNAPSHOT_PROPS.map((p) => `${p}: ${cs.getPropertyValue(p)}`).join('; ')}`);
		}
		lines.push('');
	}

	lines.push(`## Outside CSS that applies to Worldsmith (${hits.size})`, '');
	if (!hits.size) lines.push('None found — themes, snippets and other plugins are not styling these elements.');
	for (const h of hits.values()) {
		lines.push(`- From ${h.origin}`);
		lines.push(`  - Selector: \`${h.selector.slice(0, 300)}\``);
		lines.push(`  - Sets: \`${h.declarations.slice(0, 400)}\``);
		lines.push(`  - On: ${Array.from(h.matched).slice(0, 4).join(', ')}${h.matched.size > 4 ? ` (+${h.matched.size - 4} more)` : ''}`);
	}
	return { text: lines.join('\n'), hits: hits.size, scope };
}

function walk(rules: CSSRuleList, cb: (r: CSSStyleRule) => void): void {
	for (const r of Array.from(rules)) {
		if (r instanceof CSSStyleRule) {
			cb(r);
			// Nested CSS rules
			const nested = (r as CSSStyleRule & { cssRules?: CSSRuleList }).cssRules;
			if (nested?.length) walk(nested, cb);
		} else if ('cssRules' in r && (r as CSSGroupingRule).cssRules) {
			walk((r as CSSGroupingRule).cssRules, cb);
		}
	}
}

/** Declarations other than custom properties (variables never break layout by themselves). */
function declarations(style: CSSStyleDeclaration): string {
	// cssText keeps shorthands readable (`border: 0` rather than twelve longhands).
	return style.cssText
		.split(';')
		.map((d) => d.trim())
		.filter((d) => d && !d.startsWith('--'))
		.join('; ');
}

function isOwnSheet(rules: CSSRuleList): boolean {
	let n = 0;
	for (const r of Array.from(rules)) {
		if (++n > 400) break;
		if (r instanceof CSSStyleRule && r.selectorText.includes('.ws-shell__page')) return true;
	}
	return false;
}

function isCoreSheet(sheet: CSSStyleSheet): boolean {
	const href = sheet.href ?? '';
	return /\/app\.css(\?|$)/.test(href);
}

function originOf(sheet: CSSStyleSheet, rules: CSSRuleList, index: number): string {
	const node = sheet.ownerNode as HTMLElement | null;
	if (sheet.href) return sheet.href.split('/').slice(-2).join('/');
	const id = node?.id ? `#${node.id}` : '';
	const first = Array.from(rules)
		.filter((r): r is CSSStyleRule => r instanceof CSSStyleRule)
		.slice(0, 2)
		.map((r) => r.selectorText.slice(0, 60))
		.join(' | ');
	return `stylesheet ${index}${id} (starts with: ${first || '—'})`;
}

function describe(el: Element): string {
	const cls = Array.from(el.classList)
		.filter((c) => c.startsWith('ws-') || c === 'worldsmith')
		.slice(0, 2)
		.join('.');
	return cls ? `.${cls}` : el.tagName.toLowerCase();
}

function safe<T>(fn: () => T): T | undefined {
	try {
		return fn();
	} catch {
		return undefined;
	}
}

function list(v: Iterable<string> | undefined): string {
	const a = v ? Array.from(v) : [];
	return a.length ? a.join(', ') : 'none';
}
