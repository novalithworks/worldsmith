import { insertRegion, normalizeText, parseNote, regionBlock, removeRegion, renameFrontMatterKeys, replaceRegionContent, setFrontMatter, hashText, hashView, type ParsedNote, type Region } from './format';

/**
 * Reconciling one native note with its entry (0.17), pure.
 *
 * Every owned value has a three-way comparison: what the note says, what Worldsmith has,
 * and what both last agreed (`base`). One side moved → it wins. Both moved differently →
 * a conflict: nothing is written for that value until someone decides. Generated (view)
 * sections are rewritten only when they still match what Worldsmith last wrote.
 */

export type Decision = 'same' | 'pull' | 'push' | 'conflict';

/** Three-way decision on canonical texts. `base` undefined = never agreed before. */
export function decide(note: string, ws: string, base: string | undefined): Decision {
	if (note === ws) return 'same';
	if (base === undefined) return note === '' ? 'push' : ws === '' ? 'pull' : 'conflict';
	if (note === base) return 'push';
	if (ws === base) return 'pull';
	return 'conflict';
}

export interface PropSpec {
	/** `p:<fieldId>` (or `p:__aliases`, `p:__tags`, `p:__status`). */
	id: string;
	/** Front-matter key. */
	key: string;
	label: string;
	/** The value Worldsmith would write. */
	ws: unknown;
	/** Canonical text of Worldsmith's value. */
	wsCanon: string;
	/** Canonical text of a raw note value. */
	canon(raw: unknown): string;
	/** Display text of a raw note value (for the conflict dialog). */
	show(raw: unknown): string;
	wsShow: string;
	bareDate?: boolean;
}

export interface RegionSpec {
	/** Region id in the note (`ws-summary`, a field id, a section id). */
	id: string;
	kind: 'field' | 'view';
	label: string;
	/** Field sections: Worldsmith's text; view sections: the whole generated content. */
	ws: string;
	/** Content to write for a text (field: heading + text; view: the text itself). */
	build(text: string): string;
	/** A field section's text from its content (view sections: the content). */
	read(content: string): string;
	/** Optional trailing note on the start marker. */
	note?: string;
	/** Placed at the end of the note when nothing before it exists (the footer). */
	atEnd?: boolean;
	/** Only added when it has text (unplaced long fields). */
	optional?: boolean;
	/** Field sections: the label of the managed heading (kept as `h:<id>` once written). */
	heading?: string;
}

/**
 * The hash of what Worldsmith has for a region, as the note would read it back. For a field
 * section that is its text written and read again (an open code block gets closed, for
 * instance), so a value and the section it produces always compare equal.
 */
export function wsHashOf(spec: RegionSpec): string {
	return spec.kind === 'field' ? hashText(spec.read(spec.build(spec.ws))) : hashText(spec.ws);
}

export interface PlanInput {
	text: string;
	/** Keys Worldsmith always sets (identity). A function receives the current raw value. */
	/** A value, or a function of the raw value. */
	fixed: Array<{ key: string; value: unknown }>;
	props: PropSpec[];
	regions: RegionSpec[];
	base: Record<string, string>;
	detached: string[];
	/** Parse front matter YAML (Obsidian's parseYaml in the app). */
	parseYaml(yaml: string): Record<string, unknown>;
	/** Decisions made in the conflict dialog, by key. */
	resolve?: Record<string, 'note' | 'ws'>;
	/** View regions in the note that the template no longer has: removed if unedited. */
	removeUnknownViews?: boolean;
}

export interface PlanConflict {
	key: string;
	label: string;
	note: string;
	ws: string;
}

export interface PlanOutput {
	text: string;
	changed: boolean;
	/** Property values to take into Worldsmith: raw note values by spec id. */
	pulls: Array<{ id: string; raw: unknown }>;
	/** Field-section texts to take into Worldsmith, by region id. */
	regionPulls: Array<{ id: string; text: string }>;
	base: Record<string, string>;
	conflicts: PlanConflict[];
	broken: string[];
	/** Sections the person removed (markers deleted); never put back without asking. */
	removed: string[];
	/** Hand-edited view sections restored on request: their edited text, kept below. */
	kept: Array<{ id: string; text: string }>;
}

export function planReconcile(input: PlanInput): PlanOutput {
	const out: PlanOutput = { text: input.text, changed: false, pulls: [], regionPulls: [], base: { ...input.base }, conflicts: [], broken: [], removed: [], kept: [] };
	let text = input.text;
	const resolve = input.resolve ?? {};

	// ── front matter ──
	let p = parseNote(text);
	out.broken = p.broken;
	let fm: Record<string, unknown> = {};
	if (p.frontMatter) {
		try {
			fm = input.parseYaml(p.frontMatter.yaml) ?? {};
		} catch {
			// Front matter that doesn't parse is never written: the person fixes it first.
			out.broken.push('front-matter');
			return { ...out, text: input.text };
		}
		if (typeof fm !== 'object' || Array.isArray(fm)) fm = {};
	}
	// A field renamed in Type Studio: its property line follows (the value stays as it is, so
	// an edit made in the note under the old name is still compared, never lost).
	// Renames happen at once, so two fields that swap names swap their lines. A line whose
	// field couldn't move it (its new name is a property of the person's own) stays that
	// field's: another field now called like it never takes its value.
	const prevOf = (id: string) => input.base[`k:${id}`];
	const leaving = new Map<string, string>(); // old key still in the note → the field that wrote it
	for (const s of input.props) {
		const prev = prevOf(s.id);
		if (prev && prev !== s.key && prev in fm) leaving.set(prev, s.id);
	}
	const renames: Array<{ from: string; to: string }> = [];
	const moved = new Set<string>();
	const targets = new Set<string>();
	for (const s of input.props) {
		const prev = prevOf(s.id);
		if (!prev || leaving.get(prev) !== s.id) continue;
		const free = !(s.key in fm) || (leaving.has(s.key) && leaving.get(s.key) !== s.id);
		if (free && !targets.has(s.key)) {
			renames.push({ from: prev, to: s.key });
			moved.add(s.id);
			targets.add(s.key);
		}
	}
	/** The field whose line is still at this key although it was renamed away (not moved). */
	const heldBy = (key: string): string | null => {
		const id = leaving.get(key);
		return id && !moved.has(id) ? id : null;
	};
	if (renames.length) {
		text = renameFrontMatterKeys(text, renames);
		p = parseNote(text);
		try {
			fm = (p.frontMatter ? input.parseYaml(p.frontMatter.yaml) : {}) ?? {};
		} catch {
			fm = {};
		}
		if (typeof fm !== 'object' || Array.isArray(fm)) fm = {};
	}
	const sets: Array<{ key: string; value: unknown; bareDate?: boolean }> = [];
	for (const f of input.fixed) {
		const cur = fm[f.key];
		const want = typeof f.value === 'function' ? (f.value as (raw: unknown) => unknown)(cur) : f.value;
		if (JSON.stringify(cur ?? null) !== JSON.stringify(want ?? null) || (want === undefined && f.key in fm)) sets.push({ key: f.key, value: want });
	}
	for (const s of input.props) {
		const has = s.key in fm;
		const raw = fm[s.key];
		const note = has ? s.canon(raw) : '';
		const holder = heldBy(s.key);
		if (holder && holder !== s.id) {
			// That line is another field's old value: never taken as this field's. Nothing is
			// written over it unless the person decides.
			if (s.wsCanon !== '' && resolve[s.id] === 'ws') sets.push({ key: s.key, value: s.ws, bareDate: s.bareDate });
			else if (s.wsCanon !== '' && resolve[s.id] !== 'note') out.conflicts.push({ key: s.id, label: s.label, note: s.show(raw), ws: s.wsShow });
			else if (resolve[s.id] === 'note') out.pulls.push({ id: s.id, raw });
			continue;
		}
		// Empty fields aren't written (the Properties panel stays readable; adding the key in
		// Obsidian fills the field). A key deleted while it had a value is written back, so
		// nothing is lost by accident; clearing the value is how a field is emptied.
		let d: Decision = has ? decide(note, s.wsCanon, input.base[s.id]) : s.wsCanon === '' ? 'same' : 'push';
		if (d === 'conflict' && resolve[s.id]) d = resolve[s.id] === 'note' ? 'pull' : 'push';
		if (d === 'push') {
			sets.push({ key: s.key, value: s.ws, bareDate: s.bareDate });
			out.base[s.id] = s.wsCanon;
		} else if (d === 'pull') {
			out.pulls.push({ id: s.id, raw: has ? raw : null });
			out.base[s.id] = note;
		} else if (d === 'same') out.base[s.id] = note;
		else out.conflicts.push({ key: s.id, label: s.label, note: s.show(raw), ws: s.wsShow });
		// A field whose old line couldn't move keeps that line as its own until it can.
		if (!s.id.startsWith('p:__')) out.base[`k:${s.id}`] = heldBy(prevOf(s.id) ?? '') === s.id ? prevOf(s.id)! : s.key;
	}
	if (sets.length) text = setFrontMatter(text, sets);

	// ── regions ──
	p = parseNote(text);
	const byId = new Map(p.regions.map((r) => [r.id, r]));
	const broken = new Set(p.broken);
	const want = new Set(input.regions.map((r) => r.id));
	const order = input.regions;
	const present = (id: string) => byId.has(id);
	for (let i = 0; i < order.length; i++) {
		const spec = order[i]!;
		if (broken.has(spec.id)) continue;
		const key = `${spec.kind === 'field' ? 'f' : 'v'}:${spec.id}`;
		const region = byId.get(spec.id);
		const wsHash = wsHashOf(spec);
		const headKey = `h:${spec.id}`;
		const headWritten = () => {
			if (spec.heading !== undefined) out.base[headKey] = spec.heading;
		};
		if (!region) {
			if (input.base[key] !== undefined && resolve[key] !== 'ws') {
				out.removed.push(spec.id);
				continue;
			}
			if (spec.optional && !normalizeText(spec.ws)) continue;
			const block = regionBlock(spec.kind, spec.id, spec.build(spec.ws), p.eol, spec.note);
			const prev = [...order.slice(0, i)].reverse().find((r) => present(r.id));
			const next = order.slice(i + 1).find((r) => present(r.id));
			text = insertRegion(text, block, spec.atEnd ? 'end' : prev ? { after: byId.get(prev.id)! } : next ? { before: byId.get(next.id)! } : 'top');
			p = parseNote(text);
			byId.clear();
			for (const r of p.regions) byId.set(r.id, r);
			out.base[key] = wsHash;
			if (spec.kind === 'view') out.base[`w:${spec.id}`] = hashView(spec.ws);
			else headWritten();
			continue;
		}
		if (spec.kind === 'field') {
			const noteText = spec.read(region.content);
			const noteHash = hashText(noteText);
			// Never agreed before (a linked note's own section): an empty side takes the other.
			let d: Decision = input.base[key] === undefined && noteHash !== wsHash ? (!normalizeText(noteText) ? 'push' : !normalizeText(spec.ws) ? 'pull' : 'conflict') : decide(noteHash, wsHash, input.base[key]);
			if (d === 'conflict' && resolve[key]) d = resolve[key] === 'note' ? 'pull' : 'push';
			if (d === 'push') {
				text = replace(text, region, spec.build(spec.ws));
				out.base[key] = wsHash;
				headWritten();
			} else if (d === 'pull' || d === 'same') {
				if (d === 'pull') out.regionPulls.push({ id: spec.id, text: noteText });
				out.base[key] = noteHash;
				// The managed heading follows the label from Type Studio (only when that changes
				// nothing else: the text read back must stay the same).
				const fixedHead = spec.build(noteText);
				if (normalizeText(fixedHead) === normalizeText(region.content)) headWritten();
				else if (hashText(spec.read(fixedHead)) === noteHash) {
					text = replace(text, region, fixedHead);
					headWritten();
				}
			} else out.conflicts.push({ key, label: spec.label, note: noteText, ws: spec.ws });
		} else {
			const noteHash = hashText(region.content);
			const lkey = `w:${spec.id}`;
			if (noteHash === wsHash) {
				out.base[key] = wsHash;
				out.base[lkey] = hashView(spec.ws);
				continue;
			}
			// Unedited: exactly what Worldsmith wrote, or that with only link targets moved
			// (Obsidian updates links when a note is renamed).
			// Never agreed before (a note linked again, or linked fresh with old markers in it):
			// anything beyond moved links is the person's, and is never overwritten silently.
			const edited = input.base[key] === undefined ? hashView(region.content) !== hashView(spec.ws) : noteHash !== input.base[key] && hashView(region.content) !== input.base[lkey];
			if (!edited || resolve[key] === 'ws') {
				if (edited) out.kept.push({ id: spec.id, text: region.content });
				text = replace(text, region, spec.build(spec.ws));
				out.base[key] = wsHash;
				out.base[lkey] = hashView(spec.ws);
				if (edited) text = keepBelow(text, spec.id, region.content);
			} else if (input.detached.includes(spec.id) || resolve[key] === 'note') {
				// Kept as the person edited it; never rewritten.
			} else out.conflicts.push({ key, label: spec.label, note: region.content, ws: spec.ws });
		}
		p = parseNote(text);
		byId.clear();
		for (const r of p.regions) byId.set(r.id, r);
	}
	// View sections the template no longer has: removed when unedited.
	if (input.removeUnknownViews) {
		for (const r of [...p.regions]) {
			if (r.kind !== 'view' || want.has(r.id)) continue;
			const key = `v:${r.id}`;
			const base = input.base[key];
			if (base !== undefined && (hashText(r.content) === base || hashView(r.content) === input.base[`w:${r.id}`])) {
				const cur = parseNote(text).regions.find((x) => x.id === r.id);
				if (cur) text = removeRegion(text, cur);
				delete out.base[key];
				delete out.base[`w:${r.id}`];
			}
		}
	}
	out.text = text;
	out.changed = text !== input.text;
	return out;
}

function replace(text: string, region: Region, content: string): string {
	const cur = parseNote(text).regions.find((r) => r.id === region.id);
	return cur ? replaceRegionContent(text, cur, content) : text;
}

/** The person's edited text goes just below the region, as ordinary text of theirs. */
function keepBelow(text: string, id: string, edited: string): string {
	const cur = parseNote(text).regions.find((r) => r.id === id);
	if (!cur) return text;
	const eol = text.includes('\r\n') ? '\r\n' : '\n';
	const body = edited.replace(/\r?\n/g, eol);
	return text.slice(0, cur.outerEnd) + eol + eol + body + text.slice(cur.outerEnd);
}

export type { ParsedNote };
