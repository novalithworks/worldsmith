/**
 * Debouncer with a max-wait bound, independent of Obsidian so it runs in tests.
 * `flush()` runs a pending call immediately; `cancel()` drops it.
 */
export interface Debounced<A extends unknown[]> {
	(...args: A): void;
	flush(): void;
	cancel(): void;
	pending(): boolean;
}

export function debounce<A extends unknown[]>(
	fn: (...args: A) => void,
	wait: number,
	maxWait?: number,
): Debounced<A> {
	let timer: ReturnType<typeof setTimeout> | null = null;
	let maxTimer: ReturnType<typeof setTimeout> | null = null;
	let lastArgs: A | null = null;

	const clear = () => {
		if (timer) window.clearTimeout(timer);
		if (maxTimer) window.clearTimeout(maxTimer);
		timer = maxTimer = null;
	};
	const run = () => {
		const args = lastArgs;
		clear();
		lastArgs = null;
		if (args) fn(...args);
	};

	const debounced = ((...args: A) => {
		lastArgs = args;
		if (timer) window.clearTimeout(timer);
		timer = window.setTimeout(run, wait);
		if (maxWait != null && !maxTimer) maxTimer = window.setTimeout(run, maxWait);
	}) as Debounced<A>;
	debounced.flush = () => {
		if (lastArgs) run();
	};
	debounced.cancel = () => {
		clear();
		lastArgs = null;
	};
	debounced.pending = () => lastArgs !== null;
	return debounced;
}

/** Run async tasks with bounded concurrency, preserving result order. */
export async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
	const results: R[] = new Array<R>(items.length);
	let next = 0;
	const worker = async () => {
		while (next < items.length) {
			const i = next++;
			results[i] = await fn(items[i] as T, i);
		}
	};
	await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
	return results;
}
