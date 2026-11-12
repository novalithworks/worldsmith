/**
 * Checks for data that came from outside (archives, world files, type files), 0.20.2.
 * `JSON.parse` keeps a `"__proto__"` key as an ordinary property, but code that later
 * assigns by key (`obj[key] = …`) would then change an object's prototype. Imported data
 * never needs such a key, so it's refused, as is nesting deep enough to exhaust the stack.
 */
export function unsafeJsonReason(value: unknown, maxDepth = 64): string | null {
	const stack: Array<{ v: unknown; d: number }> = [{ v: value, d: 0 }];
	let seen = 0;
	while (stack.length) {
		const { v, d } = stack.pop()!;
		if (!v || typeof v !== 'object') continue;
		if (d > maxDepth) return 'it is nested too deeply';
		if (++seen > 5_000_000) return 'it is too large';
		if (Array.isArray(v)) {
			for (const x of v) stack.push({ v: x, d: d + 1 });
			continue;
		}
		for (const k of Object.keys(v)) {
			if (k === '__proto__') return 'it contains a “__proto__” key';
			stack.push({ v: (v as Record<string, unknown>)[k], d: d + 1 });
		}
	}
	return null;
}
