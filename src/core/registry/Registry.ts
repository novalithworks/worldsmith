import { toDisposable, type Disposable } from '../util/disposable';

export interface Identified {
	id: string;
}

export type RegistryChange<T> = { kind: 'added' | 'removed'; item: T };

/**
 * Generic keyed registry — the backbone of every Worldsmith extension point.
 *
 * Registering returns a Disposable that unregisters, so extensions clean up after
 * themselves. Re-registering an existing id replaces it (last registration wins) and the
 * previous definition is restored when the newer one is disposed, which lets an extension
 * override a built-in block or field type without breaking unload.
 */
export class Registry<T extends Identified> {
	private stacks = new Map<string, T[]>();
	private listeners = new Set<(change: RegistryChange<T>) => void>();

	constructor(public readonly name: string) {}

	register(item: T): Disposable {
		const stack = this.stacks.get(item.id) ?? [];
		stack.push(item);
		this.stacks.set(item.id, stack);
		this.emit({ kind: 'added', item });
		return toDisposable(() => this.unregisterExact(item));
	}

	private unregisterExact(item: T): void {
		const stack = this.stacks.get(item.id);
		if (!stack) return;
		const idx = stack.lastIndexOf(item);
		if (idx === -1) return;
		stack.splice(idx, 1);
		if (stack.length === 0) this.stacks.delete(item.id);
		this.emit({ kind: 'removed', item });
	}

	get(id: string): T | undefined {
		const stack = this.stacks.get(id);
		return stack ? stack[stack.length - 1] : undefined;
	}

	require(id: string): T {
		const item = this.get(id);
		if (!item) throw new Error(`[Worldsmith] ${this.name}: "${id}" is not registered`);
		return item;
	}

	has(id: string): boolean {
		return this.stacks.has(id);
	}

	all(): T[] {
		const out: T[] = [];
		for (const stack of this.stacks.values()) {
			const top = stack[stack.length - 1];
			if (top) out.push(top);
		}
		return out;
	}

	onChange(cb: (change: RegistryChange<T>) => void): Disposable {
		this.listeners.add(cb);
		return toDisposable(() => this.listeners.delete(cb));
	}

	private emit(change: RegistryChange<T>): void {
		for (const l of this.listeners) l(change);
	}
}
