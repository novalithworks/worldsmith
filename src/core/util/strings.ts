/** Lowercase + strip diacritics, for search haystacks and comparisons. */
export function normalizeText(s: string): string {
	return s
		.normalize('NFKD')
		.replace(/[̀-ͯ]/g, '')
		.toLowerCase();
}

/** Characters not allowed in vault file names. */
export function sanitizeFileName(name: string): string {
	const cleaned = name.replace(/[\\/:*?"<>|#^[\]]/g, ' ').replace(/\s+/g, ' ').trim();
	return cleaned.slice(0, 120) || 'Untitled';
}

export function pluralize(n: number, singular: string, plural: string): string {
	return `${n.toLocaleString()} ${n === 1 ? singular : plural}`;
}

/** "3 minutes ago", "yesterday", "12 Mar 2026". */
export function relativeTime(ts: number, now = Date.now()): string {
	const s = Math.round((now - ts) / 1000);
	if (s < 45) return 'just now';
	const m = Math.round(s / 60);
	if (m < 60) return `${m} min ago`;
	const h = Math.round(m / 60);
	if (h < 24) return `${h} h ago`;
	const d = Math.round(h / 24);
	if (d === 1) return 'yesterday';
	if (d < 7) return `${d} days ago`;
	return new Date(ts).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

export function initials(name: string): string {
	const parts = name.trim().split(/\s+/).filter(Boolean);
	if (parts.length === 0) return '?';
	const first = parts[0]?.[0] ?? '';
	const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '';
	return (first + last).toUpperCase();
}

const PLURAL_ES = new Set(['hero', 'potato', 'tomato', 'echo', 'volcano', 'torpedo', 'veto']);
const IRREGULAR: Record<string, string> = { person: 'people', child: 'children', man: 'men', woman: 'women', mouse: 'mice', goose: 'geese', ox: 'oxen', foot: 'feet', tooth: 'teeth', die: 'dice', staff: 'staves', wolf: 'wolves', elf: 'elves', dwarf: 'dwarves', thief: 'thieves', knife: 'knives', life: 'lives', leaf: 'leaves', half: 'halves', self: 'selves', loaf: 'loaves', wife: 'wives', criterion: 'criteria', quiz: 'quizzes', matrix: 'matrices', vertex: 'vertices', index: 'indices', phenomenon: 'phenomena', cactus: 'cacti', fungus: 'fungi', nucleus: 'nuclei', sheep: 'sheep', deer: 'deer', fish: 'fish', species: 'species', series: 'series', moose: 'moose' };

/**
 * An English plural for a type name typed by the user (“Hero” → “Heroes”, “City” → “Cities”).
 * Only the last word changes, and its capitalization is kept.
 */
export function pluralOf(singular: string): string {
	const s = singular.trim();
	const m = /^(.*?)([A-Za-z]+)$/.exec(s);
	if (!m) return `${s}s`;
	const [, head, word] = m as unknown as [string, string, string];
	// Acronyms: “NPC” → “NPCs”.
	if (word.length > 1 && word === word.toUpperCase()) return `${s}s`;
	const lower = word.toLowerCase();
	const keepCase = (out: string) => (word[0] === word[0]!.toUpperCase() ? out[0]!.toUpperCase() + out.slice(1) : out);
	let out: string;
	if (IRREGULAR[lower]) out = IRREGULAR[lower]!;
	else if (/(?:s|le|ce|ts|rd|ch|ft|ge|se|ne|sher)man$/.test(lower) && lower !== 'talisman') out = `${lower.slice(0, -3)}men`;
	else if (/sis$/.test(lower)) out = `${lower.slice(0, -2)}es`;
	else if (PLURAL_ES.has(lower) || /(s|x|z|ch|sh)$/.test(lower)) out = `${lower}es`;
	else if (/[^aeiou]y$/.test(lower)) out = `${lower.slice(0, -1)}ies`;
	else out = `${lower}s`;
	return head + keepCase(out);
}

/** Markdown as plain text for short previews: no stars, links shown by their words. */
export function plainText(md: string): string {
	return md
		.replace(/!\[\[[^\]]*\]\]/g, '')
		.replace(/\[\[([^\]|]*)\|([^\]]*)\]\]/g, '$2')
		.replace(/\[\[([^\]]*)\]\]/g, '$1')
		.replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
		.replace(/(\*\*|__|~~|==)(.+?)\1/g, '$2')
		.replace(/(^|[\s(])[*_]([^*_\n]+)[*_](?=[\s).,;:!?]|$)/g, '$1$2')
		.replace(/`([^`]*)`/g, '$1')
		.replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+\.)\s+/gm, '')
		.replace(/\s+/g, ' ')
		.trim();
}

/** Front matter: `---` on the first line through the next line that is only `---`. */
const FRONT_MATTER = /^---[ \t]*\r?\n(?:[\s\S]*?\r?\n)?---[ \t]*(?:\r?\n|$)/;

/** A note split into its front matter (kept as is) and the text you read and edit. */
export function splitNote(md: string): { front: string; body: string } {
	const m = FRONT_MATTER.exec(md);
	return m ? { front: m[0], body: md.slice(m[0].length) } : { front: '', body: md };
}
