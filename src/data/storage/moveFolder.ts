import { joinPath, listFilesDeep, type StorageAdapter } from './StorageAdapter';

export interface MoveResult {
	method: 'rename' | 'copy';
	files: number;
}

/**
 * Move a whole data folder (e.g. `.worldsmith` → `_worldsmith`).
 *
 * 1. Try a single folder rename (atomic on desktop).
 * 2. If the adapter can't rename folders, copy every file, verifying each one by reading
 *    it back. The original folder is then left in place untouched — a copy fallback never
 *    deletes anything, so an interrupted move can't lose data.
 *
 * Refuses to move into a folder that already contains files.
 */
export async function moveDataFolder(adapter: StorageAdapter, from: string, to: string): Promise<MoveResult> {
	if (from === to) throw new Error('Source and destination are the same folder.');
	if (!(await adapter.exists(from))) throw new Error(`“${from}” does not exist.`);
	if (await adapter.exists(to)) {
		const existing = await listFilesDeep(adapter, to);
		if (existing.length) throw new Error(`“${to}” already contains files; it won't be overwritten.`);
		if (adapter.rmdir) await adapter.rmdir(to, true);
	}

	try {
		await adapter.rename(from, to);
		if (await adapter.exists(joinPath(to, 'manifest.json'))) {
			return { method: 'rename', files: (await listFilesDeep(adapter, to)).length };
		}
		// Rename reported success but the data isn't there: fall through to copying back.
		if (await adapter.exists(from)) throw new Error('rename did not move contents');
	} catch {
		/* fall back to copying */
	}

	const files = await listFilesDeep(adapter, from);
	for (const src of files) {
		const dest = joinPath(to, src.slice(from.length + 1));
		const parent = dest.slice(0, dest.lastIndexOf('/'));
		await ensureDirs(adapter, parent);
		const data = await adapter.read(src);
		await adapter.write(dest, data);
		if ((await adapter.read(dest)) !== data) throw new Error(`Verification failed copying ${src}`);
	}
	return { method: 'copy', files: files.length };
}

async function ensureDirs(adapter: StorageAdapter, dir: string): Promise<void> {
	let cur = '';
	for (const part of dir.split('/').filter(Boolean)) {
		cur = cur ? `${cur}/${part}` : part;
		if (!(await adapter.exists(cur))) await adapter.mkdir(cur);
	}
}

/** True if a folder holds a Worldsmith data set (has a manifest). */
export function hasWorldsmithData(adapter: StorageAdapter, folder: string): Promise<boolean> {
	return adapter.exists(joinPath(folder, 'manifest.json'));
}
