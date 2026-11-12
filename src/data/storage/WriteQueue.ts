/**
 * Serializes operations per path (two writes to the same file never interleave) and caps
 * global concurrency so a large flush doesn't flood the filesystem bridge on mobile.
 */
export class WriteQueue {
	private chains = new Map<string, Promise<unknown>>();
	private active = 0;
	private waiting: Array<() => void> = [];

	constructor(private readonly concurrency = 8) {}

	run<T>(path: string, op: () => Promise<T>): Promise<T> {
		const prev = this.chains.get(path) ?? Promise.resolve();
		const next = prev
			.catch(() => undefined)
			.then(() => this.withSlot(op));
		this.chains.set(path, next);
		void next.finally(() => {
			if (this.chains.get(path) === next) this.chains.delete(path);
		}).catch(() => undefined);
		return next;
	}

	/** Resolves when every queued operation has settled. */
	async idle(): Promise<void> {
		while (this.chains.size > 0) {
			await Promise.allSettled([...this.chains.values()]);
		}
	}

	private async withSlot<T>(op: () => Promise<T>): Promise<T> {
		if (this.active >= this.concurrency) {
			await new Promise<void>((resolve) => this.waiting.push(resolve));
		}
		this.active++;
		try {
			return await op();
		} finally {
			this.active--;
			this.waiting.shift()?.();
		}
	}
}
