/**
 * Native notes (0.17): an entry's own Markdown note in the vault. Once an entry has one,
 * the note is the home of its short facts (Properties) and its long writing (body
 * sections). Worldsmith keeps the last values it agreed with the note in `values` and
 * `description` as before, so every reader (search, databases, dashboards) is unchanged.
 */
export interface NativeNote {
	/** Vault path of the note. The note is also the entry's main linked note. */
	path: string;
	/** Per-entry template override; absent = the type's template. */
	templateId?: string;
	/**
	 * What Worldsmith and the note last agreed, per key: `p:<fieldId>` (a property's
	 * canonical text), `f:<regionId>` (hash of a field section's text) and `v:<regionId>`
	 * (hash of a generated view section as Worldsmith wrote it), `w:<regionId>` (the same,
	 * with every wikilink as one token: links Obsidian rewrites aren't edits), `k:p:<fieldId>`
	 * (the property key last written, so a renamed field moves its property) and
	 * `h:<regionId>` (the label of the managed heading last written in a field section).
	 */
	base: Record<string, string>;
	status: NativeNoteStatus;
	/** Values both sides changed since they last agreed; nothing is written until decided. */
	conflicts?: NoteConflict[];
	/** View sections the person chose to keep as they edited them (never rewritten). */
	detached?: string[];
	/** Fast start-up skip: the file's mtime and hash when Worldsmith last reconciled. */
	mtime?: number;
	fileHash?: string;
	createdAt: number;
}

export type NativeNoteStatus = 'ok' | 'missing' | 'conflict';

export interface NoteConflict {
	/** `p:<fieldId>` / `f:<regionId>` (values) or `v:<regionId>` (a hand-edited view section). */
	key: string;
	label: string;
	/** Display text of each side. */
	note: string;
	ws: string;
	at: number;
}

/** A section of a note template. */
export type NoteSectionKind =
	| 'banner'
	| 'infocard'
	| 'title'
	| 'summary'
	| 'facts'
	| 'schemaSections'
	| 'field'
	| 'connections'
	| 'children'
	| 'gallery'
	| 'separator'
	| 'heading'
	| 'footer';

export interface NoteSection {
	id: string;
	kind: NoteSectionKind;
	title?: string;
	/** Field ids (facts, infocard) or the one long-text field (field). */
	fields?: string[];
	/** Collapsible: none, open, closed (callout fold markers). */
	fold?: 'none' | 'open' | 'closed';
	hidden?: boolean;
	/** Connections: show every connection as a table too. */
	table?: boolean;
}

export type NoteStyle = 'dossier' | 'chronicle' | 'fieldguide' | 'atlas' | 'plain';
export type NoteAccent = 'bronze' | 'crimson' | 'verdigris' | 'violet' | 'azure' | 'theme';

export interface NoteAppearance {
	style: NoteStyle;
	accent: NoteAccent;
	titleFont: 'codex' | 'theme';
	portrait: 'right' | 'left' | 'none';
	density: 'detailed' | 'compact';
	headings: 'ornament' | 'rule' | 'plain';
	/** Fold the Properties panel away in Reading view (it stays in editing mode). */
	hideProperties: boolean;
}

export interface NoteTemplate {
	v: number;
	id: string;
	name: string;
	icon: string;
	description: string;
	/** Set on the six built-ins (virtual, read-only); people customise a copy. */
	builtIn?: boolean;
	sections: NoteSection[];
	appearance: NoteAppearance;
	createdAt: number;
	updatedAt: number;
	rev: number;
}

/** world.json: which template each type uses (absent = the built-in that fits). */
export interface NoteTemplateConfig {
	byType: Record<string, string>;
}
