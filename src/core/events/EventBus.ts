import { toDisposable, type Disposable } from '../util/disposable';

/**
 * Minimal typed pub/sub. `Events` maps event names to payload types.
 * Listener errors are isolated so one broken subscriber can't break saving or rendering.
 */
export class EventBus<Events extends Record<string, unknown>> {
	private listeners = new Map<keyof Events, Set<(payload: never) => void>>();

	on<K extends keyof Events>(name: K, cb: (payload: Events[K]) => void): Disposable {
		let set = this.listeners.get(name);
		if (!set) {
			set = new Set();
			this.listeners.set(name, set);
		}
		const fn = cb as (payload: never) => void;
		set.add(fn);
		return toDisposable(() => set?.delete(fn));
	}

	emit<K extends keyof Events>(name: K, payload: Events[K]): void {
		const set = this.listeners.get(name);
		if (!set) return;
		for (const cb of [...set]) {
			try {
				(cb as (p: Events[K]) => void)(payload);
			} catch (e) {
				console.error(`[Worldsmith] listener for "${String(name)}" failed`, e);
			}
		}
	}

	clear(): void {
		this.listeners.clear();
	}
}
