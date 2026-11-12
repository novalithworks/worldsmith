import { normalizePath, type DataAdapter } from 'obsidian';
import type { StorageAdapter } from './StorageAdapter';

/**
 * StorageAdapter over Obsidian's DataAdapter. DataAdapter (unlike the Vault API) can read
 * and write dot-folders such as `.worldsmith/`, works on mobile, and does not trigger
 * vault indexing.
 */
export class ObsidianStorageAdapter implements StorageAdapter {
	constructor(private readonly adapter: DataAdapter) {}

	exists(path: string): Promise<boolean> {
		return this.adapter.exists(normalizePath(path));
	}

	read(path: string): Promise<string> {
		return this.adapter.read(normalizePath(path));
	}

	write(path: string, data: string): Promise<void> {
		return this.adapter.write(normalizePath(path), data);
	}

	remove(path: string): Promise<void> {
		return this.adapter.remove(normalizePath(path));
	}

	rename(from: string, to: string): Promise<void> {
		return this.adapter.rename(normalizePath(from), normalizePath(to));
	}

	async mkdir(path: string): Promise<void> {
		const p = normalizePath(path);
		if (!(await this.adapter.exists(p))) await this.adapter.mkdir(p);
	}

	async list(path: string): Promise<{ files: string[]; folders: string[] }> {
		const p = normalizePath(path);
		if (!(await this.adapter.exists(p))) return { files: [], folders: [] };
		return this.adapter.list(p);
	}

	rmdir(path: string, recursive: boolean): Promise<void> {
		return this.adapter.rmdir(normalizePath(path), recursive);
	}
}
