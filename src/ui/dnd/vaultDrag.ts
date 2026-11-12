import { TFile, TFolder, type App, type TAbstractFile } from 'obsidian';

/**
 * Vault files carried by a drag: Obsidian's own drag state first (File Explorer, search
 * results; not public API, so read defensively), then the `obsidian://open` links and
 * [[wikilinks]] Obsidian puts in the drag's text (public). Dragged folders give the files
 * inside them when `folders` is on. Only files `accept` takes are returned, each once.
 */

interface DragState {
	type?: string;
	file?: unknown;
	files?: unknown[];
}

function dragState(app: App): DragState | null {
	const dm = (app as unknown as { dragManager?: { draggable?: DragState | null } }).dragManager;
	return dm?.draggable ?? null;
}

function filesUnder(folder: TFolder, out: TFile[]): void {
	for (const child of folder.children) {
		if (child instanceof TFile) out.push(child);
		else if (child instanceof TFolder) filesUnder(child, out);
	}
}

export function vaultFilesInDrag(app: App, dt: DataTransfer | null, accept: (f: TFile) => boolean, o: { folders?: boolean } = {}): TFile[] {
	const out: TFile[] = [];
	const add = (f: TAbstractFile | null | undefined) => {
		if (f instanceof TFile) {
			if (accept(f) && !out.includes(f)) out.push(f);
		} else if (o.folders && f instanceof TFolder) {
			const inner: TFile[] = [];
			filesUnder(f, inner);
			inner.sort((a, b) => a.path.localeCompare(b.path));
			for (const x of inner) add(x);
		}
	};
	const d = dragState(app);
	if (d?.file) add(d.file as TAbstractFile);
	if (Array.isArray(d?.files)) for (const f of d.files) add(f as TAbstractFile);
	if (out.length || !dt) return out;

	const text = dt.getData('text/plain') || '';
	for (const line of text.split('\n').map((l) => l.trim()).filter(Boolean)) {
		if (line.startsWith('obsidian://')) {
			try {
				const file = new URL(line).searchParams.get('file');
				if (file) add(app.vault.getAbstractFileByPath(file) ?? app.vault.getAbstractFileByPath(`${file}.md`) ?? app.metadataCache.getFirstLinkpathDest(file, ''));
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
			add(app.metadataCache.getFirstLinkpathDest(m[1]?.trim() ?? '', ''));
		}
		const md = /!?\[[^\]]*\]\(([^)]+)\)/g;
		while ((m = md.exec(line))) {
			any = true;
			let p = m[1] ?? '';
			try {
				p = decodeURIComponent(p);
			} catch {
				/* keep as written */
			}
			add(app.vault.getAbstractFileByPath(p) ?? app.metadataCache.getFirstLinkpathDest(p, ''));
		}
		if (!any) add(app.vault.getAbstractFileByPath(line) ?? app.metadataCache.getFirstLinkpathDest(line, ''));
	}
	return out;
}

/**
 * During dragover (when the drag's text can't be read yet): does this drag look like it
 * carries vault notes? True for Obsidian's own file or folder drags, and for any drag with
 * text (checked properly on drop).
 */
export function mightCarryNotes(app: App, dt: DataTransfer | null): boolean {
	const d = dragState(app);
	if (d) {
		if (d.file instanceof TFolder) return true;
		if (d.file instanceof TFile) return d.file.extension === 'md';
		if (Array.isArray(d.files)) return d.files.some((f) => (f instanceof TFile && f.extension === 'md') || f instanceof TFolder);
	}
	return !!dt && Array.from(dt.types ?? []).includes('text/plain');
}
