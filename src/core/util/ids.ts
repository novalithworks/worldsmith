/** UUID v4 via Web Crypto (available on desktop and mobile Obsidian), with a fallback. */
export function uuid(): string {
	const c = (window as unknown as { crypto?: Crypto }).crypto;
	if (c && typeof c.randomUUID === 'function') return c.randomUUID();
	const bytes = new Uint8Array(16);
	if (c && typeof c.getRandomValues === 'function') {
		c.getRandomValues(bytes);
	} else {
		for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
	}
	bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
	bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
	const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isUuid(value: string): boolean {
	return UUID_RE.test(value);
}

/**
 * Turn a label into a slug id usable for types/fields/sections ("Weapon Class" → "weaponClass").
 * Ensures uniqueness against `taken`.
 */
export function slugId(label: string, taken: Iterable<string> = []): string {
	const words = label
		.normalize('NFKD')
		.replace(/[̀-ͯ]/g, '')
		.replace(/[^a-zA-Z0-9]+/g, ' ')
		.trim()
		.split(/\s+/)
		.filter(Boolean);
	let base = words
		.map((w, i) => (i === 0 ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()))
		.join('');
	if (!base || !/^[a-zA-Z]/.test(base)) base = 'f' + base;
	const set = new Set(taken);
	if (!set.has(base)) return base;
	let n = 2;
	while (set.has(`${base}${n}`)) n++;
	return `${base}${n}`;
}

/** Stable 32-bit FNV-1a hash, used for sharding buckets. */
export function hash32(input: string): number {
	let h = 0x811c9dc5;
	for (let i = 0; i < input.length; i++) {
		h ^= input.charCodeAt(i);
		h = Math.imul(h, 0x01000193);
	}
	return h >>> 0;
}
