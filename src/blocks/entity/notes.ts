import { Component, Keymap, MarkdownRenderer, Notice, TFile, setTooltip } from 'obsidian';
import type { EntityRecord } from '../../core/types';
import { relativeTime } from '../../core/util/strings';
import { blockActions } from '../../layouts/renderer/LayoutRenderer';
import { button, cx, emptyState, icon } from '../../ui/components/dom';
import { NotePickerModal } from '../../ui/components/modals';
import type { BlockDefinition, BlockRenderContext } from '../BlockRegistry';
import { currentEntity, watchEntity } from '../util';
import { createEntryNote } from '../../ui/notes/noteActions';
import { NotePane } from '../../ui/notes/notePane';

/** Debounced repaint, released with the block. */
function debounced(ctx: BlockRenderContext, fn: () => void, ms = 250): () => void {
	let t: number | null = null;
	ctx.component.register(() => {
		if (t !== null) window.clearTimeout(t);
	});
	return () => {
		if (t !== null) window.clearTimeout(t);
		t = window.setTimeout(() => {
			t = null;
			fn();
		}, ms);
	};
}

const stripFrontmatter = (md: string) => md.replace(/^---\n[\s\S]*?\n---\n?/, '');

/** Plain text around the first link to one of `targets` in a note. */
function excerpt(md: string, targets: string[]): string {
	const lines = stripFrontmatter(md).split('\n');
	const lower = targets.map((t) => t.toLowerCase());
	const line = lines.find((l) => {
		const ll = l.toLowerCase();
		return lower.some((t) => ll.includes(`[[${t}`) || ll.includes(`[[${t}|`) || ll.includes(`(${encodeURI(t)}`));
	});
	if (!line) return '';
	const clean = line
		.replace(/!?\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]+))?\]\]/g, (_m, a: string, b?: string) => b ?? a.split('/').pop() ?? a)
		.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
		.replace(/[*_`>#]+/g, '')
		.replace(/^\s*[-+]\s+/, '')
		.trim();
	return clean.length > 180 ? `${clean.slice(0, 177)}…` : clean;
}

// ── Note backlinks ─────────────────────────────────────────────────────────────

export const noteBacklinksBlock: BlockDefinition = {
	id: 'note-backlinks',
	name: 'Note backlinks',
	icon: 'link-2',
	category: 'Connections',
	description: 'Your Obsidian notes that link to this entry — chapters, session notes, drafts.',
	hint: 'Notes that link here',
	surfaces: ['entity'],
	frame: 'card',
	defaultSize: { w: 4, h: 1 },
	defaultConfig: { limit: 10, excerpts: true },
	configFields: [
		{ id: 'limit', type: 'number', label: 'Most shown', config: { min: 1, max: 50 } },
		{ id: 'excerpts', type: 'boolean', label: 'Show the line that links here' },
	],
	title: () => 'Mentioned in',
	render(ctx) {
		const app = ctx.app;
		if (!ctx.entity) return;
		const root = ctx.el.createDiv({ cls: 'ws-backlinks' });
		let token = 0;
		const paint = async () => {
			const my = ++token;
			const e = currentEntity(ctx);
			if (!e) return;
			const notePath = e.linkedNote?.path ?? null;
			const names = [e.name, ...e.aliases].filter(Boolean);
			const targets = [...names, ...(notePath ? [notePath.replace(/\.md$/, ''), (notePath.split('/').pop() ?? '').replace(/\.md$/, '')] : [])];
			const mc = app.metadataCache as unknown as { resolvedLinks?: Record<string, Record<string, number>>; unresolvedLinks?: Record<string, Record<string, number>> };
			const sources = new Set<string>();
			if (notePath) {
				for (const [src, dests] of Object.entries(mc.resolvedLinks ?? {})) if (src !== notePath && dests[notePath]) sources.add(src);
			}
			const lowerNames = names.map((n) => n.toLowerCase());
			for (const [src, dests] of Object.entries(mc.unresolvedLinks ?? {})) {
				if (src === notePath) continue;
				if (Object.keys(dests).some((d) => lowerNames.includes(d.toLowerCase()))) sources.add(src);
			}
			const files = [...sources]
				.map((p) => app.vault.getFileByPath(p))
				.filter((f): f is TFile => !!f)
				.sort((a, b) => (b.stat?.mtime ?? 0) - (a.stat?.mtime ?? 0));
			const limit = Math.max(1, typeof ctx.config.limit === 'number' ? ctx.config.limit : 10);
			const lines = new Map<string, string>();
			if (ctx.config.excerpts !== false) {
				await Promise.all(
					files.slice(0, limit).map(async (f) => {
						try {
							lines.set(f.path, excerpt(await app.vault.cachedRead(f), targets));
						} catch {
							/* unreadable: no excerpt */
						}
					}),
				);
			}
			if (my !== token) return;
			root.empty();
			ctx.setTitle(files.length ? `Mentioned in · ${files.length}` : 'Mentioned in');
			if (!files.length) {
				const link = `[[${notePath ? (notePath.split('/').pop() ?? '').replace(/\.md$/, '') : e.name}]]`;
				const empty = emptyState(root, { icon: 'link-2', title: 'No notes link here yet', body: `Write ${link} in any note and it shows up here.`, compact: true });
				button(empty, {
					label: 'Copy link',
					icon: 'copy',
					variant: 'ghost',
					size: 'sm',
					onClick: () => {
						void navigator.clipboard?.writeText(link);
						new Notice(`Copied ${link}`);
					},
				});
				return;
			}
			for (const f of files.slice(0, limit)) {
				const row = root.createEl('button', { cls: 'ws-backlink', attr: { type: 'button', 'data-path': f.path } });
				icon(row, 'file-text', 'ws-backlink__icon');
				const t = row.createDiv({ cls: 'ws-backlink__text' });
				const head = t.createDiv({ cls: 'ws-backlink__head' });
				head.createSpan({ cls: 'ws-backlink__name', text: f.basename });
				head.createSpan({ cls: 'ws-backlink__when', text: relativeTime(f.stat?.mtime ?? Date.now()) });
				const line = lines.get(f.path);
				if (line) t.createDiv({ cls: 'ws-backlink__line', text: line });
				else t.createDiv({ cls: 'ws-backlink__path', text: f.parent?.path && f.parent.path !== '/' ? f.parent.path : 'Vault root' });
				setTooltip(row, `Open ${f.path}`, { delay: 500 });
				row.addEventListener('click', (ev) => void app.workspace.getLeaf(Keymap.isModEvent(ev) ? 'split' : 'tab').openFile(f));
			}
			if (files.length > limit) root.createDiv({ cls: 'ws-backlinks__more', text: `+${files.length - limit} more` });
		};
		void paint();
		const later = debounced(ctx, () => void paint(), 400);
		ctx.component.registerEvent(app.metadataCache.on('resolved', later));
		ctx.component.registerEvent(app.vault.on('rename', later));
		ctx.component.registerEvent(app.vault.on('delete', later));
		watchEntity(ctx, () => later(), (k) => k === 'name' || k === 'aliases' || k === 'linkedNote');
	},
};

// ── Embedded note ──────────────────────────────────────────────────────────────

const HEIGHTS: Record<string, number> = { short: 220, medium: 420, tall: 720 };

export const embeddedNoteBlock: BlockDefinition = {
	id: 'embedded-note',
	name: 'Embedded note',
	icon: 'file-text',
	category: 'Writing',
	description: 'Shows the entry’s linked note — or any note you choose — right on the page.',
	hint: 'A note, shown on the page',
	surfaces: ['entity'],
	frame: 'card',
	defaultSize: { w: 8, h: 1 },
	defaultConfig: { source: 'linked', file: null, height: 'medium', editable: false },
	configFields: [
		{ id: 'source', type: 'select', label: 'Show', config: { options: [{ id: 'linked', label: 'This entry’s linked note' }, { id: 'file', label: 'A note I choose' }] } },
		{ id: 'file', type: 'file', label: 'Note (when “a note I choose”)' },
		{ id: 'height', type: 'select', label: 'Height', config: { options: [{ id: 'short', label: 'Short' }, { id: 'medium', label: 'Medium' }, { id: 'tall', label: 'Tall' }, { id: 'full', label: 'Whole note' }] } },
		{ id: 'editable', type: 'boolean', label: 'Edit the note right here', description: 'Uses Obsidian’s own editor; typing saves to the note.' },
	],
	title: (ctx) => {
		const p = ctx.config.source === 'file' && ctx.config.file && typeof (ctx.config.file as { path?: unknown }).path === 'string' ? (ctx.config.file as { path: string }).path : ctx.entity?.linkedNote?.path;
		return p ? (p.split('/').pop() ?? p).replace(/\.md$/, '') : 'Note';
	},
	render(ctx) {
		const app = ctx.app;
		if (!ctx.entity) return;
		const root = ctx.el.createDiv({ cls: 'ws-embed' });
		const actions = blockActions(ctx.el);
		let scope: Component | null = null;
		let expanded = false;
		/** The editor, when the widget edits the note in place (0.18). */
		let pane: NotePane | null = null;
		const dropPane = () => {
			if (!pane) return;
			ctx.component.removeChild(pane);
			pane = null;
			root.empty();
		};
		const pathFor = (e: EntityRecord): string | null => {
			if (ctx.config.source === 'file') {
				const f = ctx.config.file as { path?: unknown } | null;
				return f && typeof f.path === 'string' ? f.path : null;
			}
			return e.linkedNote?.path ?? null;
		};
		if (actions) {
			button(actions, {
				icon: 'external-link',
				variant: 'quiet',
				size: 'sm',
				tooltip: 'Open the note',
				onClick: () => {
					const e = currentEntity(ctx);
					const p = e ? pathFor(e) : null;
					const f = p ? app.vault.getFileByPath(p) : null;
					if (f) void app.workspace.getLeaf('tab').openFile(f);
				},
			});
		}
		let token = 0;
		const paint = async () => {
			const my = ++token;
			const e = currentEntity(ctx);
			if (!e) return;
			const path = pathFor(e);
			const file = path ? app.vault.getFileByPath(path) : null;
			// Edit in place: one editor for the widget's life; it follows the path and is never
			// rebuilt while the person types (the note's own changes don't repaint it).
			if (ctx.config.editable === true && path && (!file || file.extension === 'md')) {
				if (scope) {
					ctx.component.removeChild(scope);
					scope = null;
				}
				if (!pane) {
					root.empty();
					const hh = HEIGHTS[ctx.config.height as string] ?? 900;
					pane = new NotePane(ctx.ws, root, { entityId: ctx.config.source === 'file' ? null : e.id, height: hh, readOnly: !!ctx.editing });
					ctx.component.addChild(pane);
				}
				root.addClass('is-editable');
				ctx.setTitle((path.split('/').pop() ?? path).replace(/\.md$/, ''));
				await pane.show(path);
				return;
			}
			dropPane();
			root.removeClass('is-editable');
			let md = '';
			if (file && file.extension === 'md') {
				try {
					md = stripFrontmatter(await app.vault.cachedRead(file));
					// The card's title already names the note; drop a leading "# Same name".
					const first = /^\s*#\s+(.+)\n?/.exec(md);
					if (first && first[1]?.trim().toLowerCase() === file.basename.toLowerCase()) md = md.slice(first[0].length);
				} catch {
					md = '';
				}
			}
			if (my !== token) return;
			if (scope) ctx.component.removeChild(scope);
			scope = new Component();
			ctx.component.addChild(scope);
			root.empty();
			ctx.setTitle(path ? (path.split('/').pop() ?? path).replace(/\.md$/, '') : 'Embedded note');
			if (!path) {
				if (ctx.config.source === 'file') {
					emptyState(root, { icon: 'file-text', title: 'Choose a note', body: 'Pick the note in this widget’s settings (Customize → gear).', compact: true });
					return;
				}
				const empty = emptyState(root, { icon: 'file-plus', title: 'No linked note yet', body: 'Keep long-form writing in a regular note; it shows here.', compact: true });
				const row = empty.createDiv({ cls: 'ws-embed__actions' });
				button(row, { label: 'Create note', icon: 'file-plus', variant: 'ghost', size: 'sm', onClick: () => void createEntryNote(ctx.ws, e) });
				button(row, { label: 'Link existing', icon: 'link', variant: 'ghost', size: 'sm', onClick: () => new NotePickerModal(app, (f) => ctx.ws.linkedNotes.link(e, f)).open() });
				return;
			}
			if (!file) {
				emptyState(root, { icon: 'file-x', title: 'Note not found', body: `“${path}” was moved or deleted.`, compact: true });
				return;
			}
			if (file.extension !== 'md') {
				emptyState(root, { icon: 'file-x', title: 'Not a note', body: `${file.name} isn’t a Markdown note.`, compact: true });
				return;
			}
			if (!md.trim()) {
				emptyState(root, { icon: 'file-text', title: 'This note is empty', compact: true });
				return;
			}
			const h = HEIGHTS[ctx.config.height as string];
			const body = root.createDiv({ cls: cx('ws-embed__body markdown-rendered', !!h && !expanded && 'is-clamped') });
			if (h && !expanded) body.style.maxHeight = `${h}px`;
			await MarkdownRenderer.render(app, md, body, file.path, scope);
			if (my !== token) return;
			if (h) {
				window.requestAnimationFrame(() => {
					if (!body.isConnected || body.scrollHeight <= h + 8) {
						body.removeClass('is-clamped');
						return;
					}
					const more = root.createEl('button', { cls: 'ws-link-btn ws-embed__more', text: expanded ? 'Show less' : 'Show all', attr: { type: 'button' } });
					more.addEventListener('click', () => {
						expanded = !expanded;
						void paint();
					});
				});
			}
		};
		void paint();
		const later = debounced(ctx, () => void paint(), 300);
		const mine = (p: string) => {
			const e = currentEntity(ctx);
			return !!e && pathFor(e) === p;
		};
		ctx.component.registerEvent(app.vault.on('modify', (f) => mine(f.path) && !pane && later()));
		ctx.component.registerEvent(app.vault.on('create', (f) => mine(f.path) && later()));
		ctx.component.registerEvent(app.vault.on('rename', (f, old) => (mine(f.path) || mine(old)) && later()));
		ctx.component.registerEvent(app.vault.on('delete', (f) => mine(f.path) && later()));
		watchEntity(ctx, () => later(), (k) => k === 'linkedNote');
	},
};
