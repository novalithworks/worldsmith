import { FuzzySuggestModal, normalizePath, type App, type TFile } from 'obsidian';
import type { WorldsmithContext } from '../../app/context';

/**
 * Reading and writing the files of imports and exports (Milestone 9). Exports go into the
 * vault (so they sync and can be found in the file explorer), never over an existing file.
 * Imports come from a file in the vault or from the computer.
 */

/** Where exports go: “Worldsmith/Exports” next to the linked notes folder. */
export function exportsFolder(ws: WorldsmithContext): string {
	const base = (ws.settings.notesFolder || 'Worldsmith').replace(/^\/+|\/+$/g, '');
	return normalizePath(`${base}/Exports`);
}

export async function ensureFolder(app: App, folder: string): Promise<void> {
	if (!folder) return;
	let cur = '';
	for (const part of folder.split('/').filter(Boolean)) {
		cur = cur ? `${cur}/${part}` : part;
		if (!app.vault.getAbstractFileByPath(cur)) {
			try {
				await app.vault.createFolder(cur);
			} catch {
				// Created meanwhile (e.g. by Sync) — fine.
			}
		}
	}
}

/** A path that doesn't exist yet: “name.json”, then “name 2.json”, … */
export function freePath(app: App, folder: string, base: string, ext: string): string {
	const clean = base.replace(/[\\/:*?"<>|#^[\]]+/g, ' ').replace(/\s+/g, ' ').trim() || 'Export';
	let path = normalizePath(`${folder}/${clean}.${ext}`);
	for (let n = 2; app.vault.getAbstractFileByPath(path); n++) path = normalizePath(`${folder}/${clean} ${n}.${ext}`);
	return path;
}

/** Write a new file in the vault (never replacing one); returns its path. */
export async function writeNewFile(app: App, folder: string, base: string, ext: string, content: string): Promise<string> {
	await ensureFolder(app, folder);
	// Another export (a double click, Sync) may take the name between choosing and writing.
	for (let attempt = 0; ; attempt++) {
		const path = freePath(app, folder, base, ext);
		try {
			await app.vault.create(path, content);
			return path;
		} catch (e) {
			if (attempt >= 5 || !app.vault.getAbstractFileByPath(path)) throw e;
		}
	}
}

/** “2026-10-08” for file names. */
export function dateStamp(d = new Date()): string {
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

class VaultFilePicker extends FuzzySuggestModal<TFile> {
	constructor(
		app: App,
		private readonly exts: string[],
		placeholder: string,
		private readonly onPick: (f: TFile | null) => void,
	) {
		super(app);
		this.modalEl.addClass('worldsmith-modal');
		this.setPlaceholder(placeholder);
		this.emptyStateText = `No ${exts.map((e) => `.${e}`).join(' or ')} files in your vault.`;
	}
	private picked = false;
	getItems(): TFile[] {
		return this.app.vault
			.getFiles()
			.filter((f) => this.exts.includes(f.extension.toLowerCase()))
			.sort((a, b) => (b.stat?.mtime ?? 0) - (a.stat?.mtime ?? 0));
	}
	getItemText(f: TFile): string {
		return f.path;
	}
	onChooseItem(f: TFile): void {
		this.picked = true;
		this.onPick(f);
	}
	override onClose(): void {
		// Choosing closes the modal first; only a real dismissal reports “nothing”.
		window.setTimeout(() => !this.picked && this.onPick(null), 0);
	}
}

export interface PickedFile {
	name: string;
	text: string;
	/** The file's bytes, when it was read as binary (world archives, 0.19). */
	bytes?: Uint8Array;
}

/**
 * Text from file bytes: UTF-8 (with or without a BOM), UTF-16 with a BOM (Excel's “Unicode
 * text”), else Windows-1252 — what Excel's plain “CSV” uses on Windows — so accents survive.
 */
export function decodeText(buf: ArrayBuffer): string {
	const b = new Uint8Array(buf);
	if (b[0] === 0xff && b[1] === 0xfe) return new TextDecoder('utf-16le').decode(b.subarray(2));
	if (b[0] === 0xfe && b[1] === 0xff) return new TextDecoder('utf-16be').decode(b.subarray(2));
	try {
		return new TextDecoder('utf-8', { fatal: true }).decode(b);
	} catch {
		return new TextDecoder('windows-1252').decode(b);
	}
}

/** Choose a file in the vault and read it. */
export function pickVaultFile(app: App, exts: string[], placeholder: string, binary = false): Promise<PickedFile | null> {
	return new Promise((resolve) => {
		new VaultFilePicker(app, exts, placeholder, (f) => {
			if (!f) return resolve(null);
			if (binary) {
				void app.vault
					.readBinary(f)
					.then((buf) => resolve({ name: f.name, text: '', bytes: new Uint8Array(buf) }))
					.catch(() => resolve(null));
				return;
			}
			const read = typeof app.vault.readBinary === 'function' ? app.vault.readBinary(f).then(decodeText) : app.vault.read(f);
			void read.then((text) => resolve({ name: f.name, text })).catch(() => resolve(null));
		}).open();
	});
}

/** Choose a file on this computer (or phone) and read it as text. */
export function pickComputerFile(accept: string, binary = false): Promise<PickedFile | null> {
	return new Promise((resolve) => {
		const input = createEl('input');
		input.type = 'file';
		input.accept = accept;
		input.setCssStyles({ display: 'none' });
		activeDocument.body.appendChild(input);
		let settled = false;
		let changed = false;
		const win = activeDocument.defaultView ?? window;
		const done = (v: PickedFile | null) => {
			if (settled) return;
			settled = true;
			input.remove();
			win.removeEventListener('focus', onFocus);
			resolve(v);
		};
		// Older mobile web views have no “cancel” event: when the window gets focus back and
		// no file arrived shortly after, the picker was dismissed.
		const onFocus = () => window.setTimeout(() => !changed && !input.files?.length && done(null), 4000);
		input.addEventListener('change', () => {
			changed = true;
			const file = input.files?.[0];
			if (!file) return done(null);
			const reader = new FileReader();
			reader.onload = () => {
				const buf = reader.result instanceof ArrayBuffer ? reader.result : null;
				if (binary) return done(buf ? { name: file.name, text: '', bytes: new Uint8Array(buf) } : null);
				done({ name: file.name, text: buf ? decodeText(buf) : String(reader.result ?? '') });
			};
			reader.onerror = () => done(null);
			reader.readAsArrayBuffer(file);
		});
		input.addEventListener('cancel', () => done(null));
		// Only where the “cancel” event doesn't exist (a slow cloud pick must not count as one).
		if (!('oncancel' in input)) window.setTimeout(() => win.addEventListener('focus', onFocus), 300);
		input.click();
	});
}

/** Parse JSON, or say why it isn't. */
export function parseJson(text: string): { value: unknown } | { error: string } {
	try {
		return { value: JSON.parse(text.replace(/^\uFEFF/, '')) as unknown };
	} catch {
		return { error: 'That file isn’t valid JSON.' };
	}
}
