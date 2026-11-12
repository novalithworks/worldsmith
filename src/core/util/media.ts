import type { BannerRef, GalleryItem, ImageRef } from '../types';

/** File extensions Worldsmith treats as images (Obsidian can display all of these). */
export const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'avif'] as const;
const IMAGE_EXT = new Set<string>(IMAGE_EXTENSIONS);

export const MIN_ZOOM = 1;
export const MAX_ZOOM = 4;
export const BANNER_MIN = 100;
export const BANNER_MAX = 480;
export const BANNER_PRESETS = { compact: 140, standard: 210, tall: 300 } as const;

export function extensionOf(path: string): string {
	const name = path.split('/').pop() ?? path;
	const i = name.lastIndexOf('.');
	return i > 0 ? name.slice(i + 1).toLowerCase() : '';
}

export function isImagePath(path: string): boolean {
	return IMAGE_EXT.has(extensionOf(path));
}

export function fileNameOf(path: string): string {
	return path.split('/').pop() ?? path;
}

export function baseNameOf(path: string): string {
	return fileNameOf(path).replace(/\.[^.]+$/, '');
}

export function folderOf(path: string): string {
	const i = path.lastIndexOf('/');
	return i === -1 ? '' : path.slice(0, i);
}

const clamp = (v: unknown, lo: number, hi: number): number | undefined =>
	typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : undefined;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Validate an image reference read from disk or produced by the UI. Unknown keys are kept
 * (future fields survive older versions); known ones are clamped to sane ranges. Returns
 * null if there's no usable path.
 */
export function normalizeRef<T extends ImageRef>(raw: unknown): T | null {
	if (!isObj(raw) || typeof raw.path !== 'string' || !raw.path) return null;
	const out: Record<string, unknown> = { ...raw };
	for (const [k, lo, hi] of [
		['focalX', 0, 1],
		['focalY', 0, 1],
		['zoom', MIN_ZOOM, MAX_ZOOM],
		['height', BANNER_MIN, BANNER_MAX],
	] as const) {
		if (k in out) {
			const v = clamp(out[k], lo, hi);
			if (v === undefined) delete out[k];
			else out[k] = v;
		}
	}
	if ('fit' in out && out.fit !== 'cover' && out.fit !== 'contain') delete out.fit;
	if ('caption' in out && typeof out.caption !== 'string') delete out.caption;
	return out as unknown as T;
}

export function normalizeGallery(raw: unknown): GalleryItem[] {
	if (!Array.isArray(raw)) return [];
	const seen = new Set<string>();
	const out: GalleryItem[] = [];
	for (const it of raw) {
		const r = normalizeRef<GalleryItem>(it);
		if (!r || typeof r.id !== 'string' || seen.has(r.id)) continue;
		seen.add(r.id);
		out.push(r);
	}
	return out;
}

/** CSS for showing a ref inside a clipping frame: focal point + zoom + fit. */
export function refStyle(ref: ImageRef): { objectFit: string; objectPosition: string; transform: string; transformOrigin: string } {
	const fx = (ref.focalX ?? 0.5) * 100;
	const fy = (ref.focalY ?? 0.5) * 100;
	const z = ref.zoom && ref.zoom > 1 ? ref.zoom : 1;
	return {
		objectFit: ref.fit ?? 'cover',
		objectPosition: `${fx}% ${fy}%`,
		transform: z > 1 ? `scale(${Math.round(z * 1000) / 1000})` : '',
		transformOrigin: `${fx}% ${fy}%`,
	};
}

/**
 * If `path` is `from` or inside folder `from`, return the path it moves to; else null.
 * Used to follow file and folder renames.
 */
export function movedPath(path: string, from: string, to: string): string | null {
	if (path === from) return to;
	if (path.startsWith(`${from}/`)) return to + path.slice(from.length);
	return null;
}

/** Safe file name for something imported from outside the vault. */
export function importName(name: string, fallbackExt = 'png'): string {
	let base = baseNameOf(name).replace(/[\\/:*?"<>|#^[\]]+/g, ' ').replace(/\s+/g, ' ').trim();
	if (!base) base = 'Image';
	if (base.length > 80) base = base.slice(0, 80).trim();
	let ext = extensionOf(name);
	if (!IMAGE_EXT.has(ext)) ext = fallbackExt;
	return `${base}.${ext}`;
}

/** Map a MIME type (from a download or a pasted blob) to an image extension. */
export function extensionForMime(mime: string | null | undefined): string | null {
	const m = (mime ?? '').toLowerCase().split(';')[0]?.trim();
	switch (m) {
		case 'image/png':
			return 'png';
		case 'image/jpeg':
		case 'image/jpg':
			return 'jpg';
		case 'image/gif':
			return 'gif';
		case 'image/webp':
			return 'webp';
		case 'image/svg+xml':
			return 'svg';
		case 'image/bmp':
			return 'bmp';
		case 'image/avif':
			return 'avif';
		default:
			return null;
	}
}

/** First path not taken: "Art/map.png", "Art/map 2.png", "Art/map 3.png"… */
export function dedupePath(path: string, taken: (p: string) => boolean): string {
	if (!taken(path)) return path;
	const dir = folderOf(path);
	const base = baseNameOf(path);
	const ext = extensionOf(path);
	for (let n = 2; n < 10000; n++) {
		const p = `${dir ? `${dir}/` : ''}${base} ${n}${ext ? `.${ext}` : ''}`;
		if (!taken(p)) return p;
	}
	return `${dir ? `${dir}/` : ''}${base} ${Date.now()}${ext ? `.${ext}` : ''}`;
}

export type { BannerRef };
