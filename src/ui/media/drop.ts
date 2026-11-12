import type { TFile } from 'obsidian';
import type { WorldsmithContext } from '../../app/context';
import { MediaService } from '../../services/MediaService';

export interface DropOptions {
	/** Shown over the target while dragging, e.g. "Drop to set the portrait". */
	label: string;
	/** Called with the images (already in the vault). */
	onImages: (files: TFile[]) => void;
	/** For Obsidian's "same folder as current file" attachment setting. */
	sourcePath?: () => string | undefined;
	/** Ignore drags that carry Worldsmith's own payloads (e.g. reordering). */
	ignoreTypes?: string[];
	/** Accept only one image (the first). */
	single?: boolean;
	/** Decline drags over parts of the element (e.g. a nested target). */
	accept?: (ev: DragEvent) => boolean;
}

/**
 * Make an element accept images: files from the computer (copied into the vault), files
 * dragged from Obsidian's file explorer, and image links dragged from a browser.
 */
export function imageDropTarget(el: HTMLElement, ws: WorldsmithContext, o: DropOptions): () => void {
	let depth = 0;
	const accepts = (dt: DataTransfer | null) => {
		if (!dt || !MediaService.mightHaveImages(dt)) return false;
		const types = Array.from(dt.types ?? []);
		return !o.ignoreTypes?.some((t) => types.includes(t)) && !types.includes('text/x-worldsmith-task') && !types.includes('text/x-worldsmith-item');
	};
	const clear = () => {
		depth = 0;
		el.removeClass('is-drop-target');
	};
	const enter = (ev: DragEvent) => {
		if (!accepts(ev.dataTransfer)) return;
		depth++;
		over(ev);
	};
	const over = (ev: DragEvent) => {
		if (!accepts(ev.dataTransfer)) return;
		if (o.accept && !o.accept(ev)) {
			el.removeClass('is-drop-target');
			return;
		}
		ev.preventDefault();
		if (ev.dataTransfer) ev.dataTransfer.dropEffect = 'copy';
		el.setAttr('data-drop-label', o.label);
		el.addClass('is-drop-target');
	};
	const leave = () => {
		depth = Math.max(0, depth - 1);
		if (!depth) clear();
	};
	const drop = async (ev: DragEvent) => {
		if (!accepts(ev.dataTransfer) || (o.accept && !o.accept(ev))) {
			clear();
			return;
		}
		ev.preventDefault();
		ev.stopPropagation();
		clear();
		const dt = ev.dataTransfer;
		if (!dt) return;
		el.addClass('is-importing');
		try {
			const files = await ws.media.fromTransfer(dt, o.sourcePath?.());
			if (files.length) o.onImages(o.single ? files.slice(0, 1) : files);
		} finally {
			el.removeClass('is-importing');
		}
	};
	el.addEventListener('dragenter', enter);
	el.addEventListener('dragover', over);
	el.addEventListener('dragleave', leave);
	// The handlers run async work; listeners get plain functions that start it.
	const dropNow = (e: DragEvent): void => void drop(e);
	el.addEventListener('drop', dropNow);
	return () => {
		el.removeEventListener('dragenter', enter);
		el.removeEventListener('dragover', over);
		el.removeEventListener('dragleave', leave);
		el.removeEventListener('drop', dropNow);
	};
}

/** Accept pasted images while focus is inside `el`. */
export function imagePasteTarget(el: HTMLElement, ws: WorldsmithContext, onImages: (files: TFile[]) => void, sourcePath?: () => string | undefined): () => void {
	const paste = async (ev: ClipboardEvent) => {
		const dt = ev.clipboardData;
		if (!dt) return;
		const hasImage = Array.from(dt.files ?? []).some((f) => f.type.startsWith('image/'));
		if (!hasImage) return;
		ev.preventDefault();
		const files = await ws.media.fromTransfer(dt, sourcePath?.());
		if (files.length) onImages(files);
	};
	const pasteNow = (e: ClipboardEvent): void => void paste(e);
	el.addEventListener('paste', pasteNow);
	return () => el.removeEventListener('paste', pasteNow);
}
