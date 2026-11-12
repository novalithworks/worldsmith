import { Notice, TFile, TFolder, normalizePath, requestUrl, type App, type Component } from 'obsidian';
import { dedupePath, extensionForMime, extensionOf, fileNameOf, importName, isImagePath } from '../core/util/media';
import type { WorldsmithSettings } from '../settings/settings';
import type { WorldService } from './WorldService';

/** A file from outside the vault: a drop, a paste, a file chooser or a download. */
export interface IncomingFile {
	name: string;
	type?: string;
	data: ArrayBuffer;
}

/**
 * Vault-facing half of media handling (the world-facing half is `session.media`):
 * follows file moves, lists images, and copies images from outside the vault into it.
 */
export class MediaService {
	constructor(
		private readonly app: App,
		private readonly worlds: WorldService,
		private readonly settings: () => WorldsmithSettings,
		/** Worldsmith's own data folder — its JSON churn is never media. */
		private readonly dataFolder: () => string,
	) {}

	private isOwnData(path: string): boolean {
		const root = this.dataFolder();
		return !!root && (path === root || path.startsWith(`${root}/`));
	}

	/** Follow renames/moves of files and folders. Deleted files stay referenced. */
	register(owner: Component): void {
		owner.registerEvent(
			this.app.vault.on('rename', (file, oldPath) => {
				const s = this.worlds.session;
				if (!s || this.isOwnData(oldPath) || this.isOwnData(file.path)) return;
				s.media.rename(oldPath, file.path);
			}),
		);
	}

	// ── lookups ────────────────────────────────────────────────────────────────

	exists(path: string): boolean {
		return !!this.app.vault.getFileByPath(path);
	}

	file(path: string): TFile | null {
		return this.app.vault.getFileByPath(path);
	}

	url(path: string): string | null {
		const f = this.app.vault.getFileByPath(path);
		return f ? this.app.vault.getResourcePath(f) : null;
	}

	/** Every image in the vault (outside Worldsmith's data folder), newest first. */
	images(): TFile[] {
		return this.app.vault
			.getFiles()
			.filter((f) => isImagePath(f.path) && !this.isOwnData(f.path))
			.sort((a, b) => (b.stat?.mtime ?? 0) - (a.stat?.mtime ?? 0));
	}

	// ── importing ──────────────────────────────────────────────────────────────

	/** Where imported images go, for display in settings and notices. */
	describeTarget(): string {
		const m = this.settings().media;
		return m.useAttachmentFolder ? 'your attachment folder' : m.folder || 'the vault root';
	}

	private async ensureFolder(folder: string): Promise<void> {
		if (!folder) return;
		let cur = '';
		for (const part of folder.split('/').filter(Boolean)) {
			cur = cur ? `${cur}/${part}` : part;
			const existing = this.app.vault.getAbstractFileByPath(cur);
			if (existing instanceof TFolder || existing) continue;
			try {
				await this.app.vault.createFolder(cur);
			} catch {
				/* created concurrently */
			}
		}
	}

	private async targetPath(name: string, sourcePath?: string): Promise<string> {
		const m = this.settings().media;
		if (m.useAttachmentFolder) {
			return this.app.fileManager.getAvailablePathForAttachment(name, sourcePath ?? '');
		}
		const folder = normalizePath(m.folder || '/').replace(/^\/$/, '');
		await this.ensureFolder(folder);
		const path = normalizePath(folder ? `${folder}/${name}` : name);
		return dedupePath(path, (p) => !!this.app.vault.getAbstractFileByPath(p));
	}

	/**
	 * Copy images into the vault. Non-images are skipped. `sourcePath` (e.g. the entry's
	 * linked note) lets Obsidian's "same folder as current file" attachment setting work.
	 */
	async import(files: IncomingFile[], sourcePath?: string): Promise<TFile[]> {
		const out: TFile[] = [];
		const skipped: string[] = [];
		for (const f of files) {
			const ext = isImagePath(f.name) ? extensionOf(f.name) : extensionForMime(f.type);
			if (!ext) {
				skipped.push(f.name || 'file');
				continue;
			}
			const name = importName(isImagePath(f.name) ? f.name : `${f.name || pastedName()}.${ext}`, ext);
			try {
				const path = await this.targetPath(name, sourcePath);
				out.push(await this.app.vault.createBinary(path, f.data));
			} catch (e) {
				new Notice(`Couldn’t add ${f.name}: ${e instanceof Error ? e.message : String(e)}`);
			}
		}
		if (skipped.length) new Notice(`Skipped ${skipped.length === 1 ? `“${skipped[0]}”` : `${skipped.length} files`} — only images can be added.`);
		return out;
	}

	/** Download an image from the web into the vault. */
	async importUrl(url: string, sourcePath?: string): Promise<TFile | null> {
		let u: URL;
		try {
			u = new URL(url.trim());
		} catch {
			new Notice('That isn’t a web address.');
			return null;
		}
		if (u.protocol !== 'https:' && u.protocol !== 'http:') {
			new Notice('Only http and https links can be downloaded.');
			return null;
		}
		try {
			const res = await requestUrl({ url: u.toString(), throw: false });
			if (res.status >= 400) throw new Error(`the server answered ${res.status}`);
			const type = res.headers['content-type'] ?? res.headers['Content-Type'];
			const fromUrl = decodeURIComponent(fileNameOf(u.pathname)) || 'Image';
			const ext = extensionForMime(type) ?? (isImagePath(fromUrl) ? extensionOf(fromUrl) : null);
			if (!ext) throw new Error('it isn’t an image');
			const name = isImagePath(fromUrl) ? fromUrl : `${fromUrl}.${ext}`;
			const [file] = await this.import([{ name, type, data: res.arrayBuffer }], sourcePath);
			return file ?? null;
		} catch (e) {
			new Notice(`Couldn’t download the image: ${e instanceof Error ? e.message : String(e)}`);
			return null;
		}
	}

	/**
	 * Images carried by a drop or paste: files from the computer are copied into the vault;
	 * files dragged from Obsidian's file explorer (or links to them) are used where they
	 * are; image links from a browser are downloaded.
	 */
	async fromTransfer(dt: DataTransfer, sourcePath?: string): Promise<TFile[]> {
		const incoming: Promise<IncomingFile>[] = [];
		for (const f of Array.from(dt.files ?? [])) {
			if (f.type.startsWith('image/') || isImagePath(f.name)) {
				incoming.push(f.arrayBuffer().then((data) => ({ name: f.name && f.name !== 'image.png' ? f.name : `${pastedName()}.${extensionForMime(f.type) ?? 'png'}`, type: f.type, data })));
			}
		}
		if (incoming.length) return this.import(await Promise.all(incoming), sourcePath);

		const vaultFiles = this.vaultFilesIn(dt);
		if (vaultFiles.length) return vaultFiles;

		const uri = (dt.getData('text/uri-list') || dt.getData('text/plain') || '').split('\n').map((l) => l.trim()).find((l) => /^https?:\/\//i.test(l));
		if (uri) {
			const f = await this.importUrl(uri, sourcePath);
			return f ? [f] : [];
		}
		return [];
	}

	/** True if a drag carries something we could turn into an image. */
	static mightHaveImages(dt: DataTransfer | null): boolean {
		if (!dt) return false;
		const types = Array.from(dt.types ?? []);
		return types.includes('Files') || types.includes('text/plain') || types.includes('text/uri-list');
	}

	private vaultFilesIn(dt: DataTransfer): TFile[] {
		const out: TFile[] = [];
		const add = (f: TFile | null | undefined) => {
			if (f && isImagePath(f.path) && !out.includes(f)) out.push(f);
		};
		// Obsidian's own drag state (file explorer, search results). Not part of the
		// public API, so it's read defensively.
		const dm = (this.app as unknown as { dragManager?: { draggable?: { type?: string; file?: unknown; files?: unknown[] } } }).dragManager;
		const d = dm?.draggable;
		if (d?.file instanceof TFile) add(d.file);
		if (Array.isArray(d?.files)) for (const f of d.files) if (f instanceof TFile) add(f);
		if (out.length) return out;

		const text = dt.getData('text/plain') || '';
		for (const line of text.split('\n').map((l) => l.trim()).filter(Boolean)) {
			if (line.startsWith('obsidian://')) {
				try {
					const file = new URL(line).searchParams.get('file');
					if (file) add(this.app.vault.getFileByPath(file) ?? this.app.metadataCache.getFirstLinkpathDest(file, ''));
				} catch {
					/* not a URL */
				}
				continue;
			}
			const wiki = /!?\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]/g;
			let m: RegExpExecArray | null;
			let any = false;
			while ((m = wiki.exec(line))) {
				any = true;
				add(this.app.metadataCache.getFirstLinkpathDest(m[1]?.trim() ?? '', ''));
			}
			const md = /!?\[[^\]]*\]\(([^)]+)\)/g;
			while ((m = md.exec(line))) {
				any = true;
				const p = decodeURIComponent(m[1] ?? '');
				add(this.app.vault.getFileByPath(p) ?? this.app.metadataCache.getFirstLinkpathDest(p, ''));
			}
			if (!any && isImagePath(line)) add(this.app.vault.getFileByPath(line) ?? this.app.metadataCache.getFirstLinkpathDest(line, ''));
		}
		return out;
	}
}

/** "Pasted image 20261007-142233", like Obsidian's own pasted images. */
export function pastedName(d = new Date()): string {
	const p = (n: number) => String(n).padStart(2, '0');
	return `Pasted image ${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}
