/** Deep clone for JSON-compatible data. */
export function clone<T>(value: T): T {
	if (typeof structuredClone === 'function') return structuredClone(value);
	return JSON.parse(JSON.stringify(value)) as T;
}

/** Structural equality for JSON-compatible data. */
export function jsonEqual(a: unknown, b: unknown): boolean {
	if (a === b) return true;
	if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') return false;
	if (Array.isArray(a)) {
		if (!Array.isArray(b) || a.length !== b.length) return false;
		return a.every((v, i) => jsonEqual(v, b[i]));
	}
	if (Array.isArray(b)) return false;
	const ka = Object.keys(a);
	const kb = Object.keys(b as object);
	if (ka.length !== kb.length) return false;
	return ka.every((k) => jsonEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}
