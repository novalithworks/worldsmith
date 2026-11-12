/** References to vault files used as images. Paths are vault-relative. */
export interface ImageRef {
	path: string;
	fit?: 'cover' | 'contain';
	/** Focal point, 0–1 on each axis. Used as object-position. */
	focalX?: number;
	focalY?: number;
	/** 1 = fit the frame; up to 4. Scales around the focal point. */
	zoom?: number;
	caption?: string;
}

export interface BannerRef extends ImageRef {
	/** Rendered height in px. */
	height?: number;
}

export interface GalleryItem extends ImageRef {
	id: string;
	primary?: boolean;
}

export interface EntityMedia {
	/** Lucide icon id used in chips, sidebar and placeholders. */
	icon?: string | null;
	portrait?: ImageRef | null;
	banner?: BannerRef | null;
	symbol?: ImageRef | null;
	gallery: GalleryItem[];
}
