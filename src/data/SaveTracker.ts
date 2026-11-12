import type { EventBus } from '../core/events/EventBus';
import type { SaveState, WorldsmithEvents } from '../core/events/events';
import type { StoreState } from './storage/BucketStore';

/**
 * Aggregates the state of every store into one app-wide save state for the UI:
 * error > saving > pending > saved. After everything settles, 'saved' is shown briefly
 * and then decays to 'idle'.
 */
export class SaveTracker {
	private states = new Map<string, StoreState>();
	private lastError: unknown = null;
	private current: SaveState = 'idle';
	private decayTimer: ReturnType<typeof setTimeout> | null = null;

	constructor(private readonly events: EventBus<WorldsmithEvents>) {}

	reporter(storeName: string): (state: StoreState, error?: unknown) => void {
		return (state, error) => {
			this.states.set(storeName, state);
			if (state === 'error') this.lastError = error;
			this.recompute();
		};
	}

	get state(): SaveState {
		return this.current;
	}

	private recompute(): void {
		const values = [...this.states.values()];
		let next: SaveState;
		if (values.includes('error')) next = 'error';
		else if (values.includes('saving')) next = 'saving';
		else if (values.includes('pending')) next = 'pending';
		else next = this.current === 'idle' ? 'idle' : 'saved';

		if (next === this.current) return;
		this.current = next;
		if (this.decayTimer) window.clearTimeout(this.decayTimer);
		this.decayTimer = null;
		if (next === 'saved') {
			this.decayTimer = window.setTimeout(() => {
				this.current = 'idle';
				this.events.emit('save:state', { state: 'idle' });
			}, 2500);
		}
		this.events.emit('save:state', { state: next, error: next === 'error' ? this.lastError : undefined });
	}

	forget(storeName: string): void {
		this.states.delete(storeName);
		this.recompute();
	}

	dispose(): void {
		if (this.decayTimer) window.clearTimeout(this.decayTimer);
	}
}
