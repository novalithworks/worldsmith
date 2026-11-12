import type { EventBus } from '../core/events/EventBus';
import type { WorldsmithEvents } from '../core/events/events';
import type { EntityRecord, GalleryItem, ImageRef, MapDoc, World } from '../core/types';
import { fileNameOf, isImagePath, movedPath } from '../core/util/media';
import type { EntityRepository } from '../data/repositories/EntityRepository';
import type { SchemaRepository } from '../data/repositories/SchemaRepository';
import type { FieldTypeRegistry } from '../fields/FieldTypeRegistry';

export type MediaRole = 'portrait' | 'banner' | 'symbol' | 'gallery' | 'field' | 'world-banner' | 'page-banner' | 'map';

/** One place a vault file is used. */
export interface MediaUsage {
	path: string;
	role: MediaRole;
	/** Absent for the world banner and page banners. */
	entityId?: string;
	/** Page banners: the page ("tasks", "dashboard:<id>", "type:<typeId>"); maps: "map:<id>". */
	page?: string;
	fieldId?: string;
	/** Gallery item id (entity gallery or a gallery field). */
	itemId?: string;
	/** False for "Vault file" fields: they can point at any file. */
	image: boolean;
}

export const ROLE_LABELS: Record<MediaRole, string> = {
	portrait: 'Portrait',
	banner: 'Banner',
	symbol: 'Emblem',
	gallery: 'Gallery',
	field: 'Field',
	'world-banner': 'World banner',
	'page-banner': 'Page banner',
	map: 'Map',
};

/** What MediaRefs needs from the world's maps (0.11). */
export interface MapImages {
	list(): MapDoc[];
	update(id: string, patch: Partial<MapDoc>): unknown;
}

const isRef = (v: unknown): v is ImageRef => typeof v === 'object' && v !== null && typeof (v as ImageRef).path === 'string';

/**
 * Every reference from the world to vault files — portraits, banners, emblems, galleries,
 * media fields and the world banner — kept as an in-memory index.
 *
 * It answers "where is this image used?", finds references whose file is gone, and
 * rewrites references when files move (`rename`) or when the user relinks a missing image
 * (`relink`). It never deletes a reference on its own: a missing file stays referenced so
 * it comes back if the file reappears (undo, sync, plugin re-enabled).
 */
export class MediaRefs {
	private cache: MediaUsage[] | null = null;
	private readonly offs: Array<() => void> = [];

	constructor(
		private readonly entities: EntityRepository,
		private readonly schemas: SchemaRepository,
		private readonly fieldTypes: FieldTypeRegistry,
		private readonly getWorld: () => World,
		private readonly updateWorld: (patch: Partial<World>) => void,
		events: EventBus<WorldsmithEvents>,
		private readonly maps?: () => MapImages,
	) {
		const dirty = () => (this.cache = null);
		this.offs.push(events.on('doc:saved', ({ kind }) => kind === 'map' && dirty()).dispose);
		this.offs.push(events.on('doc:deleted', ({ kind }) => kind === 'map' && dirty()).dispose);
		for (const ev of ['entity:created', 'entity:deleted', 'entity:updated', 'schema:updated', 'schema:created', 'schema:deleted'] as const) {
			this.offs.push(events.on(ev as 'entity:created', dirty).dispose);
		}
		this.offs.push(events.on('world:updated', ({ keys }) => (keys.includes('banner') || keys.includes('pageBanners')) && dirty()).dispose);
	}

	dispose(): void {
		for (const off of this.offs.splice(0)) off();
	}

	private mediaFields(typeId: string) {
		const schema = this.schemas.get(typeId);
		if (!schema) return [];
		const out: Array<{ id: string; shape: 'ref' | 'refs'; image: boolean }> = [];
		for (const f of schema.fields) {
			const m = this.fieldTypes.for(f).media;
			if (m) out.push({ id: f.id, shape: m.shape, image: m.images });
		}
		return out;
	}

	/** References held by one entity. */
	usagesOf(e: EntityRecord): MediaUsage[] {
		const out: MediaUsage[] = [];
		const m = e.media;
		if (m.portrait) out.push({ path: m.portrait.path, role: 'portrait', entityId: e.id, image: true });
		if (m.banner) out.push({ path: m.banner.path, role: 'banner', entityId: e.id, image: true });
		if (m.symbol) out.push({ path: m.symbol.path, role: 'symbol', entityId: e.id, image: true });
		for (const g of m.gallery) out.push({ path: g.path, role: 'gallery', entityId: e.id, itemId: g.id, image: true });
		for (const f of this.mediaFields(e.typeId)) {
			const v = e.values[f.id];
			if (f.shape === 'ref' && isRef(v)) out.push({ path: v.path, role: 'field', entityId: e.id, fieldId: f.id, image: f.image && isImagePath(v.path) });
			if (f.shape === 'refs' && Array.isArray(v)) {
				for (const it of v) {
					if (isRef(it)) out.push({ path: it.path, role: 'field', entityId: e.id, fieldId: f.id, itemId: (it as GalleryItem).id, image: f.image && isImagePath(it.path) });
				}
			}
		}
		return out;
	}

	/** All references in the world. Trashed entries are included only when asked. */
	all(includeTrashed = false): MediaUsage[] {
		if (!this.cache) {
			const out: MediaUsage[] = [];
			const banner = this.getWorld().banner;
			if (banner) out.push({ path: banner.path, role: 'world-banner', image: true });
			for (const [page, b] of Object.entries(this.getWorld().pageBanners ?? {})) out.push({ path: b.path, role: 'page-banner', page, image: true });
			for (const e of this.entities.values()) out.push(...this.usagesOf(e));
			for (const m of this.maps?.().list() ?? []) if (m.image) out.push({ path: m.image.path, role: 'map', page: `map:${m.id}`, image: true });
			this.cache = out;
		}
		if (includeTrashed) return this.cache;
		return this.cache.filter((u) => !u.entityId || !this.entities.get(u.entityId)?.trashedAt);
	}

	/** path → usages, for image references (not "Vault file" fields). */
	byPath(includeTrashed = false): Map<string, MediaUsage[]> {
		const map = new Map<string, MediaUsage[]>();
		for (const u of this.all(includeTrashed)) {
			if (!u.image) continue;
			const l = map.get(u.path) ?? [];
			l.push(u);
			map.set(u.path, l);
		}
		return map;
	}

	usagesOfPath(path: string): MediaUsage[] {
		return this.all().filter((u) => u.path === path);
	}

	/** References whose file doesn't exist. `exists` is the vault lookup. */
	missing(exists: (path: string) => boolean): Map<string, MediaUsage[]> {
		const map = new Map<string, MediaUsage[]>();
		for (const u of this.all()) {
			if (exists(u.path)) continue;
			const l = map.get(u.path) ?? [];
			l.push(u);
			map.set(u.path, l);
		}
		return map;
	}

	/**
	 * For a missing path, the files elsewhere in the vault with the same file name — the
	 * usual result of a move done while Worldsmith wasn't watching.
	 */
	candidates(path: string, allPaths: readonly string[]): string[] {
		const name = fileNameOf(path).toLowerCase();
		return allPaths.filter((p) => p !== path && fileNameOf(p).toLowerCase() === name);
	}

	/**
	 * Follow a file or folder move: every reference to `from` (or inside folder `from`) now
	 * points at the new place. Focal point, zoom, captions etc. are kept. Returns how many
	 * references changed.
	 */
	rename(from: string, to: string): number {
		if (!from || from === to) return 0;
		return this.rewrite((p) => movedPath(p, from, to));
	}

	/** Point every reference to exactly `from` at `to` (relinking a missing image). */
	relink(from: string, to: string): number {
		if (!from || from === to) return 0;
		return this.rewrite((p) => (p === from ? to : null));
	}

	private rewrite(map: (path: string) => string | null): number {
		let n = 0;
		const fix = <T extends ImageRef>(r: T | null | undefined): T | null | undefined => {
			if (!r) return r;
			const to = map(r.path);
			if (to === null) return r;
			n++;
			return { ...r, path: to };
		};
		const world = this.getWorld();
		if (world.banner) {
			const b = fix(world.banner);
			if (b !== world.banner) this.updateWorld({ banner: b ?? null });
		}
		const pages = this.getWorld().pageBanners ?? {};
		let pagesChanged = false;
		const nextPages: typeof pages = {};
		for (const [k, b] of Object.entries(pages)) {
			const f = fix(b);
			if (f !== b) pagesChanged = true;
			if (f) nextPages[k] = f;
		}
		if (pagesChanged) this.updateWorld({ pageBanners: nextPages });
		const maps = this.maps?.();
		for (const m of maps?.list() ?? []) {
			const img = fix(m.image);
			if (img && img !== m.image) maps!.update(m.id, { image: img });
		}
		for (const e of [...this.entities.values()]) {
			const before = n;
			const m = e.media;
			const media = {
				...m,
				portrait: fix(m.portrait) ?? null,
				banner: fix(m.banner) ?? null,
				symbol: fix(m.symbol) ?? null,
				gallery: m.gallery.map((g) => fix(g) as GalleryItem),
			};
			const values: Record<string, unknown> = {};
			for (const f of this.mediaFields(e.typeId)) {
				const v = e.values[f.id];
				if (f.shape === 'ref' && isRef(v)) {
					const nv = fix(v);
					if (nv !== v) values[f.id] = nv;
				} else if (f.shape === 'refs' && Array.isArray(v)) {
					const k = n;
					const nv = (v as unknown[]).map((it) => (isRef(it) ? fix(it) : it));
					if (n !== k) values[f.id] = nv;
				}
			}
			if (n === before) continue;
			const mediaChanged = media.portrait !== m.portrait || media.banner !== m.banner || media.symbol !== m.symbol || media.gallery.some((g, i) => g !== m.gallery[i]);
			this.entities.update(e.id, {
				...(mediaChanged ? { media } : {}),
				...(Object.keys(values).length ? { values } : {}),
			});
		}
		this.cache = null;
		return n;
	}
}
