import type { ImageRef } from './media';
import type { SemanticColor } from './ids';

/**
 * Family trees, relationship graphs and maps (Milestone 10, part 2). Each is a document of
 * its own in `trees/`, `graphs/` or `maps/`, so a world can keep as many as it likes.
 */

interface DocBase {
	v: number;
	id: string;
	name: string;
	description: string;
	icon: string;
	createdAt: number;
	updatedAt: number;
	rev: number;
}

// ── Trees ───────────────────────────────────────────────────────────────────────

export type TreeKind = 'family' | 'hierarchy';
export type TreeDirection = 'down' | 'up' | 'right';
export type TreeCardStyle = 'portrait' | 'compact' | 'name';
export type TreeColorBy = 'type' | 'status' | 'generation' | 'none';
export type TreeLines = 'curved' | 'square' | 'straight';
export type CanvasBackground = 'plain' | 'dots' | 'grid' | 'parchment';

export interface TreeDoc extends DocBase {
	kind: TreeKind;
	/** The person a family tree is drawn around, or the top of a hierarchy. */
	rootId: string | null;
	/** Hierarchy without a root entry: every top-level entry of this type. */
	typeId: string | null;
	/** Generations shown above (family) and below the root. */
	up: number;
	down: number;
	direction: TreeDirection;
	card: TreeCardStyle;
	colorBy: TreeColorBy;
	lines: TreeLines;
	background: CanvasBackground;
	show: { photos: boolean; dates: boolean; type: boolean; partners: boolean; siblings: boolean; status: boolean };
	/** Relationship kinds read as parent → child (the connection goes from the parent). */
	parentKinds: string[];
	/** Relationship kinds read as partners (spouses, lovers). */
	partnerKinds: string[];
	/** Hierarchy entries folded shut. */
	collapsed: string[];
}

// ── Relationship graphs ───────────────────────────────────────────────────────────

export type GraphLabels = 'always' | 'hover' | 'never';
export type GraphColorBy = 'type' | 'status' | 'none';

export interface GraphDoc extends DocBase {
	/** Empty = every type / kind / tag. */
	types: string[];
	kinds: string[];
	tags: string[];
	/** Only what's around this entry, up to `depth` steps away. */
	focusId: string | null;
	depth: number;
	hideIsolated: boolean;
	showSecret: boolean;
	/** Children are drawn joined to their parent entry. */
	showParents: boolean;
	labels: GraphLabels;
	edgeLabels: boolean;
	colorBy: GraphColorBy;
	/** Bigger dots for entries with more connections. */
	sizeByLinks: boolean;
	photos: boolean;
	/** 0.5–2: how far apart entries settle. */
	spacing: number;
	background: CanvasBackground;
	/** Entries placed by hand: id → [x, y]. */
	pinned: Record<string, [number, number]>;
	/** Dragging a dot pins it where it's dropped (0.12; off: it settles back in). */
	pinOnDrag: boolean;
}

// ── Maps ────────────────────────────────────────────────────────────────────────

export type MapPinSize = 's' | 'm' | 'l';
export type MapLineStyle = 'solid' | 'dashed' | 'dotted';
export type MapLabels = 'always' | 'hover' | 'zoom';
export type MapBackdrop = 'parchment' | 'plain' | 'night' | 'sea';

export interface MapLayer {
	id: string;
	name: string;
	visible: boolean;
	color?: SemanticColor | null;
}

interface MapItemBase {
	id: string;
	/** Linked entry (a city, a battle, a character's home). */
	entityId: string | null;
	label: string;
	note: string;
	layerId: string | null;
	color: SemanticColor | null;
}

/** A point; x and y are 0–1 across the map. */
export interface MapPin extends MapItemBase {
	x: number;
	y: number;
	icon: string | null;
	size: MapPinSize | null;
	/** Opening the pin opens this map (a city map inside a kingdom map). */
	mapId: string | null;
}

/** An area: a kingdom, a forest, a sea. */
export interface MapRegion extends MapItemBase {
	points: Array<[number, number]>;
	opacity: number;
	style: MapLineStyle;
}

/** A line: a road, a river, a journey. */
export interface MapPath extends MapItemBase {
	points: Array<[number, number]>;
	style: MapLineStyle;
	width: number;
	arrow: boolean;
}

export interface MapDoc extends DocBase {
	image: ImageRef | null;
	/** Shape of a map without an image (or before the image is measured): width ÷ height. */
	aspect: number;
	backdrop: MapBackdrop;
	/** The entry this map shows (a kingdom, a city). */
	entityId: string | null;
	pins: MapPin[];
	regions: MapRegion[];
	paths: MapPath[];
	layers: MapLayer[];
	/** Distances: the map's full width is `width` units. */
	scale: { width: number; unit: string } | null;
	grid: { show: boolean; kind: 'square' | 'hex'; cells: number; opacity: number };
	labels: MapLabels;
	pinSize: MapPinSize;
	/** A compass rose in the corner. */
	compass: boolean;
}

/** Which kind of thing on a map. */
export type MapItemKind = 'pin' | 'region' | 'path';
