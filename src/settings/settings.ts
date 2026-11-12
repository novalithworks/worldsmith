import { DEFAULT_DATA_FOLDER, LEGACY_DATA_FOLDER, SETTINGS_VERSION } from '../app/constants';

/**
 * Device/vault preferences, persisted with Obsidian's loadData/saveData. World content
 * never goes here — it lives in the data folder.
 */
/** Details layout: labels above values in two columns, or label beside value. */
export type DetailsLayout = 'grid' | 'rows';

export interface WorldsmithSettings {
	settingsVersion: number;
	dataFolder: string;
	notesFolder: string;
	appearance: {
		density: 'compact' | 'comfortable' | 'spacious';
		/** The Modern Codex design (2026), or the design Worldsmith had before it. */
		look: 'codex' | 'classic';
		/** Codex colours: Worldsmith's bronze, or the colours of the Obsidian theme. */
		palette: 'bronze' | 'theme';
		/** Title font: the built-in book serif, the theme's fonts, or fonts named below. */
		fontMode: 'codex' | 'theme' | 'custom';
		displayFont: string;
		bodyFont: string;
		maxWidth: number;
		fullWidth: boolean;
		animations: boolean;
		/** Labels Obsidian shows when the pointer rests on buttons, cards and widgets. */
		tooltips: boolean;
		cardImage: 'portrait' | 'banner';
		/** How entry pages lay out their details, unless a page chooses otherwise. */
		detailsLayout: DetailsLayout;
		/** Per-type defaults ("worldId:typeId" → layout), set from the Details block's switch. */
		detailsLayoutByType: Record<string, DetailsLayout>;
		/** Per-entry choices (entry id → layout), set from the Details block's switch. */
		detailsLayoutByEntry: Record<string, DetailsLayout>;
	};
	database: {
		/** Per type: last chosen view kind. */
		viewKind: Record<string, 'cards' | 'table' | 'list'>;
		sort: Record<string, { by: string; dir: 'asc' | 'desc' }>;
	};
	sidebarCollapsed: Record<string, boolean>;
	/** Sidebar width in pixels (dragged from its edge), and whether it's hidden on wide panes. */
	sidebarWidth: number;
	sidebarHidden: boolean;
	/** Show the "Dashboards" section in the sidebar (Home is always there). */
	showDashboards: boolean;
	/** First day of the week in calendars and "this week": 1 = Monday, 0 = Sunday. */
	weekStart: 0 | 1;
	/** Images added from outside the vault (drop, paste, upload, link). */
	media: {
		/** Vault folder for imported images. */
		folder: string;
		/** Follow Obsidian's "Default location for new attachments" instead. */
		useAttachmentFolder: boolean;
	};
	/** The Writing Studio's page (WS3). */
	writing: WritingSettings;
	/** Native notes (0.17). */
	nativeNotes: NativeNoteSettings;
	/** Backups & recovery (0.20). */
	backups: BackupSettings;
	/** First steps (0.21): worlds that show the getting-started guide on their dashboard. */
	guide: GuideSettings;
	/** WS5 (0.22): show Writing Studio scenes with an in-story date on the Timeline page. */
	timelineScenes: boolean;
	debug: boolean;
}

export interface BackupSettings {
	/** Make backups of the open world on a schedule. */
	auto: boolean;
	/** Minutes between automatic backups (one is skipped when nothing changed). */
	intervalMinutes: number;
	/** Automatic backups kept per world (the newest). */
	keepAuto: number;
	/** Manual backups kept per world (the newest). */
	keepManual: number;
	/** Automatic backups also hold images (more disk space). Manual backups always do. */
	autoImages: boolean;
}

export interface GuideSettings {
	/** World ids whose dashboard shows the getting-started guide (new worlds; or chosen in Help). */
	worlds: string[];
}

export function mergeGuide(raw: unknown): GuideSettings {
	const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<GuideSettings>;
	return { worlds: Array.isArray(r.worlds) ? r.worlds.filter((x): x is string => typeof x === 'string').slice(0, 200) : [] };
}

export const DEFAULT_BACKUPS: BackupSettings = { auto: true, intervalMinutes: 60, keepAuto: 10, keepManual: 20, autoImages: false };

export function mergeBackups(raw: unknown): BackupSettings {
	const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<BackupSettings>;
	const num = (v: unknown, def: number, min: number, max: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : def);
	return {
		auto: r.auto !== false,
		intervalMinutes: num(r.intervalMinutes, DEFAULT_BACKUPS.intervalMinutes, 5, 7 * 24 * 60),
		keepAuto: num(r.keepAuto, DEFAULT_BACKUPS.keepAuto, 1, 100),
		keepManual: num(r.keepManual, DEFAULT_BACKUPS.keepManual, 1, 200),
		autoImages: r.autoImages === true,
	};
}

export interface NativeNoteSettings {
	/** Renaming an entry renames its native note too (D4). */
	renameWithEntry: boolean;
	/**
	 * The note styling as an Obsidian CSS snippet, so notes stay styled with Worldsmith off.
	 * 'ask' = ask once when the first native note is made.
	 */
	snippet: 'ask' | 'on' | 'off';
	/** File name the snippet was written under (another file had the usual name). */
	snippetName: string;
	/** Small Reading-view extras: sync status line on Worldsmith notes. */
	readingExtras: boolean;
	/** A note created from the entry page's Note button is a native note (0.17.1). Off = a plain linked note. */
	newNotesNative: boolean;
	/** The one-time “New in 0.17: native notes” notice was shown. */
	introShown: boolean;
}

export const DEFAULT_NATIVE_NOTES: NativeNoteSettings = { renameWithEntry: true, snippet: 'ask', snippetName: 'worldsmith-notes', readingExtras: true, newNotesNative: true, introShown: false };

/** The page you write on: warm paper, the theme's own colours, or a dark page. */
export type WritingSurface = 'paper' | 'theme' | 'dark';
/** The text's font: the bundled book serif, the theme's text font, or one named here. */
export type WritingFont = 'book' | 'theme' | 'custom';

export interface WritingSettings {
	surface: WritingSurface;
	/** How wide the text runs, in characters. */
	pageWidth: number;
	lineHeight: number;
	/** Text size in pixels. */
	fontSize: number;
	font: WritingFont;
	customFont: string;
	/** Keep the line being typed in the middle of the page. */
	typewriter: boolean;
	/** Fade every paragraph but the one being written. */
	dimOthers: boolean;
}

export const WRITING_LIMITS = {
	pageWidth: { min: 40, max: 110, step: 2 },
	lineHeight: { min: 1.2, max: 2.4, step: 0.05 },
	fontSize: { min: 13, max: 28, step: 1 },
} as const;

export const DEFAULT_WRITING: WritingSettings = {
	surface: 'paper',
	pageWidth: 68,
	lineHeight: 1.7,
	fontSize: 18,
	font: 'book',
	customFont: '',
	typewriter: false,
	dimOthers: false,
};

export const DEFAULT_SETTINGS: WorldsmithSettings = {
	settingsVersion: SETTINGS_VERSION,
	dataFolder: DEFAULT_DATA_FOLDER,
	notesFolder: 'Worldsmith',
	appearance: {
		density: 'comfortable',
		look: 'codex',
		// 0.30.5: by default Worldsmith follows the Obsidian theme (its colours and fonts), at full
		// width; the bronze palette and book serif stay a choice in Appearance.
		palette: 'theme',
		fontMode: 'theme',
		displayFont: '',
		bodyFont: '',
		maxWidth: 1180,
		fullWidth: true,
		animations: true,
		tooltips: true,
		cardImage: 'portrait',
		detailsLayout: 'grid',
		detailsLayoutByType: {},
		detailsLayoutByEntry: {},
	},
	database: { viewKind: {}, sort: {} },
	sidebarCollapsed: {},
	sidebarWidth: 252,
	sidebarHidden: false,
	showDashboards: true,
	weekStart: 1,
	media: { folder: 'Worldsmith/Images', useAttachmentFolder: false },
	writing: { ...DEFAULT_WRITING },
	nativeNotes: { ...DEFAULT_NATIVE_NOTES },
	backups: { ...DEFAULT_BACKUPS },
	guide: { worlds: [] },
	timelineScenes: true,
	debug: false,
};

/**
 * Merge stored data over defaults, tolerating missing/old keys, and apply one-time
 * upgrades. `upgraded` tells the caller to persist the result.
 */
export function mergeSettings(raw: unknown): WorldsmithSettings & { upgraded?: boolean } {
	const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Partial<WorldsmithSettings>;
	const version = typeof r.settingsVersion === 'number' ? r.settingsVersion : 1;
	let dataFolder = typeof r.dataFolder === 'string' && r.dataFolder.trim() ? r.dataFolder : DEFAULT_DATA_FOLDER;
	// v1 → v2: the old default dot-folder becomes the Sync-friendly default.
	if (version < 2 && dataFolder === LEGACY_DATA_FOLDER) dataFolder = DEFAULT_DATA_FOLDER;
	const merged = {
		...DEFAULT_SETTINGS,
		...r,
		settingsVersion: SETTINGS_VERSION,
		dataFolder,
		appearance: {
			...DEFAULT_SETTINGS.appearance,
			...(r.appearance ?? {}),
			tooltips: r.appearance?.tooltips !== false,
			look: r.appearance?.look === 'classic' ? 'classic' : 'codex',
			palette: r.appearance?.palette === 'bronze' || r.appearance?.palette === 'theme' ? r.appearance.palette : DEFAULT_SETTINGS.appearance.palette,
			// v2 → v3: the old default ("theme") becomes the new design's book serif.
			fontMode: fontModeOf(r.appearance?.fontMode, version),
			detailsLayout: r.appearance?.detailsLayout === 'rows' ? 'rows' : 'grid',
			detailsLayoutByType: layoutMap(r.appearance?.detailsLayoutByType),
			detailsLayoutByEntry: layoutMap(r.appearance?.detailsLayoutByEntry),
		},
		database: {
			viewKind: { ...(r.database?.viewKind ?? {}) },
			sort: { ...(r.database?.sort ?? {}) },
		},
		sidebarCollapsed: { ...(r.sidebarCollapsed ?? {}) },
		sidebarWidth: clampSidebar(r.sidebarWidth),
		sidebarHidden: r.sidebarHidden === true,
		showDashboards: r.showDashboards !== false,
		weekStart: r.weekStart === 0 ? 0 : 1,
		media: {
			folder: typeof r.media?.folder === 'string' ? r.media.folder : DEFAULT_SETTINGS.media.folder,
			useAttachmentFolder: r.media?.useAttachmentFolder === true,
		},
		writing: mergeWriting(r.writing),
		nativeNotes: mergeNativeNotes(r.nativeNotes),
		backups: mergeBackups((r as { backups?: unknown }).backups),
		guide: mergeGuide((r as { guide?: unknown }).guide),
		timelineScenes: (r as { timelineScenes?: unknown }).timelineScenes !== false,
	};
	return raw !== null && raw !== undefined && version < SETTINGS_VERSION ? { ...merged, upgraded: true } : merged;
}

export const SIDEBAR_MIN = 200;
export const SIDEBAR_MAX = 420;
export function clampSidebar(raw: unknown): number {
	const n = typeof raw === 'number' && Number.isFinite(raw) ? Math.round(raw) : 252;
	return Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, n));
}

function fontModeOf(raw: unknown, version: number): 'codex' | 'theme' | 'custom' {
	if (raw === 'custom') return 'custom';
	if (raw === 'codex') return 'codex';
	// v2 → v3: the old default ("theme") became the book serif; a fresh install follows the theme (0.30.5).
	if (raw === 'theme') return version >= 3 ? 'theme' : 'codex';
	return DEFAULT_SETTINGS.appearance.fontMode;
}

function layoutMap(raw: unknown): Record<string, DetailsLayout> {
	if (typeof raw !== 'object' || raw === null) return {};
	return Object.fromEntries(Object.entries(raw).filter(([, v]) => v === 'grid' || v === 'rows'));
}

/** The Writing Studio's settings from stored data: anything missing or odd falls back to the default. */
export function mergeWriting(raw: unknown): WritingSettings {
	const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Partial<Record<keyof WritingSettings, unknown>>;
	const d = DEFAULT_WRITING;
	const L = WRITING_LIMITS;
	// Keys this version doesn't know (a newer version's) are kept as they are.
	return {
		...(r as Record<string, unknown>),
		surface: r.surface === 'theme' || r.surface === 'dark' ? r.surface : 'paper',
		pageWidth: clampNum(r.pageWidth, L.pageWidth.min, L.pageWidth.max, d.pageWidth, 0),
		lineHeight: clampNum(r.lineHeight, L.lineHeight.min, L.lineHeight.max, d.lineHeight, 2),
		fontSize: clampNum(r.fontSize, L.fontSize.min, L.fontSize.max, d.fontSize, 0),
		font: r.font === 'theme' || r.font === 'custom' ? r.font : 'book',
		customFont: typeof r.customFont === 'string' ? r.customFont.trim().slice(0, 120) : '',
		typewriter: r.typewriter === true,
		dimOthers: r.dimOthers === true,
	};
}

function clampNum(raw: unknown, min: number, max: number, fallback: number, digits: number): number {
	if (typeof raw !== 'number' || !Number.isFinite(raw)) return fallback;
	const f = 10 ** digits;
	return Math.min(max, Math.max(min, Math.round(raw * f) / f));
}

export function mergeNativeNotes(raw: unknown): NativeNoteSettings {
	const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Partial<Record<keyof NativeNoteSettings, unknown>>;
	const name = typeof r.snippetName === 'string' && /^[\w .-]{1,80}$/.test(r.snippetName) ? r.snippetName : DEFAULT_NATIVE_NOTES.snippetName;
	return {
		...(r as Record<string, unknown>),
		renameWithEntry: r.renameWithEntry !== false,
		snippet: r.snippet === 'on' || r.snippet === 'off' ? r.snippet : 'ask',
		snippetName: name,
		readingExtras: r.readingExtras !== false,
		newNotesNative: r.newNotesNative !== false,
		introShown: r.introShown === true,
	};
}
