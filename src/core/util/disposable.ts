/** Something that can be released. Every register()/on() in Worldsmith returns one. */
export interface Disposable {
	/** A plain function (safe to pass around on its own, e.g. `register(x.on(...).dispose)`). */
	dispose: () => void;
}

export function toDisposable(fn: () => void): Disposable {
	let done = false;
	return {
		dispose: () => {
			if (done) return;
			done = true;
			fn();
		},
	};
}

/** Collects disposables and releases them together (in reverse order). */
export class DisposableStore implements Disposable {
	private items: Disposable[] = [];
	private disposed = false;

	add<T extends Disposable>(d: T): T {
		if (this.disposed) {
			d.dispose();
		} else {
			this.items.push(d);
		}
		return d;
	}

	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		const items = this.items.reverse();
		this.items = [];
		for (const d of items) {
			try {
				d.dispose();
			} catch (e) {
				console.error('[Worldsmith] dispose failed', e);
			}
		}
	}
}
