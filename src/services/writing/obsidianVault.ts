import { normalizePath, TFile, TFolder, type App, type EventRef, type TAbstractFile } from 'obsidian';
import { toDisposable, type Disposable } from '../../core/util/disposable';
import { inFolder, type ManuscriptVault, type NoteFile, type VaultChange } from './vault';

/**
 * Obsidian's vault as a ManuscriptVault. Everything goes through the vault API (never
 * the file system), so it works the same on desktop and mobile. Worldsmith's own data
 * folder is invisible here: its files are never manuscript notes.
 */
export function obsidianVault(app: App, dataFolder: () => string): ManuscriptVault {
	const { vault } = app;
	const own = (path: string) => {
		const root = dataFolder();
		return !!root && inFolder(path, root);
	};
	const note = (f: TFile): NoteFile => ({ path: f.path, mtime: f.stat?.mtime ?? 0, size: f.stat?.size ?? 0 });
	const tfile = (path: string): TFile | null => {
		const f = vault.getAbstractFileByPath(normalizePath(path));
		return f instanceof TFile && !own(f.path) ? f : null;
	};
	const fileAt = (path: string): TFile => {
		const f = tfile(path);
		if (!f) throw new Error(`“${path}” wasn’t found.`);
		return f;
	};
	return {
		file: (path) => {
			const f = tfile(path);
			return f ? note(f) : null;
		},
		exists: (path) => !!vault.getAbstractFileByPath(normalizePath(path)),
		isFolder: (path) => !path || vault.getAbstractFileByPath(normalizePath(path)) instanceof TFolder,
		markdownFiles: (folder) =>
			vault
				.getMarkdownFiles()
				.filter((f) => inFolder(f.path, folder) && f.path !== folder && !own(f.path))
				.map(note),
		read: (path) => vault.read(fileAt(path)),
		cachedRead: (path) => vault.cachedRead(fileAt(path)),
		create: async (path, text) => {
			const p = normalizePath(path);
			// vault.create refuses an existing path; checking first gives a clearer error.
			if (vault.getAbstractFileByPath(p)) throw new Error(`“${p}” already exists.`);
			return note(await vault.create(p, text));
		},
		createFolder: async (path) => {
			await vault.createFolder(normalizePath(path));
		},
		process: async (path, fn) => {
			const f = fileAt(path);
			return vault.process(f, fn);
		},
		onChange: (cb) => {
			const isFolder = (f: TAbstractFile) => f instanceof TFolder;
			let refs: EventRef[] = [];
			let disposed = false;
			// While Obsidian starts it sends a "create" for every file in the vault; listening
			// only once the layout is ready skips that flood (nothing is renamed before then).
			app.workspace.onLayoutReady(() => {
				if (disposed) return;
				refs = [
					vault.on('create', (f) => !own(f.path) && cb({ type: 'create', path: f.path, folder: isFolder(f) })),
					vault.on('modify', (f) => !own(f.path) && cb({ type: 'modify', path: f.path, folder: isFolder(f) })),
					vault.on('delete', (f) => !own(f.path) && cb({ type: 'delete', path: f.path, folder: isFolder(f) })),
					vault.on('rename', (f, oldPath) => !own(oldPath) && cb({ type: 'rename', path: f.path, oldPath, folder: isFolder(f) } satisfies VaultChange)),
				];
			});
			const sub: Disposable = toDisposable(() => {
				disposed = true;
				refs.forEach((r) => vault.offref(r));
				refs = [];
			});
			return sub;
		},
	};
}
