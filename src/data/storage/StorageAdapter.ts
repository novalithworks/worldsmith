/**
 * The smallest filesystem surface Worldsmith needs. Paths are vault-relative and
 * already normalized ("a/b/c.json"). Implemented over Obsidian's DataAdapter at runtime
 * and over node:fs in tests.
 */
export interface StorageAdapter {
	exists(path: string): Promise<boolean>;
	read(path: string): Promise<string>;
	write(path: string, data: string): Promise<void>;
	remove(path: string): Promise<void>;
	rename(from: string, to: string): Promise<void>;
	mkdir(path: string): Promise<void>;
	/** Immediate children of a folder (full paths). Missing folder → empty lists. */
	list(path: string): Promise<{ files: string[]; folders: string[] }>;
	rmdir?(path: string, recursive: boolean): Promise<void>;
}

export function joinPath(...parts: string[]): string {
	return parts
		.filter((p) => p !== '')
		.join('/')
		.replace(/\/{2,}/g, '/')
		.replace(/^\.\//, '');
}

export function parentPath(path: string): string {
	const i = path.lastIndexOf('/');
	return i === -1 ? '' : path.slice(0, i);
}

/** Recursively list every file below a folder. */
export async function listFilesDeep(adapter: StorageAdapter, root: string): Promise<string[]> {
	if (!(await adapter.exists(root))) return [];
	const out: string[] = [];
	const stack = [root];
	while (stack.length) {
		const dir = stack.pop() as string;
		const { files, folders } = await adapter.list(dir);
		out.push(...files);
		stack.push(...folders);
	}
	return out;
}
