import { Notice, type MarkdownPostProcessorContext, type Plugin } from 'obsidian';
import type { WorldsmithApp } from '../../app/WorldsmithApp';
import { ROUTES } from '../../state/route';
import { NoteConflictModal } from './conflicts';
import { NoteStyles } from './noteStyles';
import { createNativeNote } from './noteActions';
import { WorldsmithView } from '../views/WorldsmithView';

export const INTRO_NOTICE = 'New in 0.17: native notes. Open an entry and press the Note button.';

/**
 * Native notes in Obsidian itself (0.17): their look, the "Open in Worldsmith" link
 * (obsidian://worldsmith, a local protocol handler — nothing leaves the device) and a small
 * sync line in Reading view. All optional: without them the notes are plain Markdown.
 */
export function registerNotesUi(plugin: Plugin, ws: WorldsmithApp): NoteStyles {
	const styles = new NoteStyles(ws);
	ws.noteStyles = styles;
	plugin.register(styles.register());
	// Migration safety copies older than 30 days are confirmed on their own.
	const expire = ws.events.on('world:loaded', () => void ws.noteMigrations.expire().catch((e) => console.warn('[Worldsmith] could not check note migrations', e)));
	plugin.register(() => expire.dispose());

	// Once, after updating: where the new notes are (stored in the plugin's data).
	const intro = () => {
		if (ws.settings.nativeNotes.introShown || !ws.worlds.session) return;
		ws.settings.nativeNotes.introShown = true;
		void ws.saveSettings();
		new Notice(INTRO_NOTICE, 15000);
	};
	const introSub = ws.events.on('world:loaded', intro);
	plugin.register(() => introSub.dispose());
	intro();

	// Command palette: the entry open in the active Worldsmith pane.
	const activeEntry = () => {
		const view = plugin.app.workspace.getActiveViewOfType(WorldsmithView);
		const id = view?.route.name === 'entity' ? view.route.params?.id : undefined;
		return typeof id === 'string' ? (ws.worlds.session?.entities.get(id) ?? null) : null;
	};
	plugin.addCommand({
		id: 'create-native-note',
		name: 'Create native note for this entry',
		checkCallback: (checking) => {
			const e = activeEntry();
			if (!e || (e.nativeNote && e.nativeNote.status !== 'missing')) return false;
			if (!checking) void createNativeNote(ws, e);
			return true;
		},
	});
	plugin.addCommand({
		id: 'open-native-note',
		name: 'Open the native note of this entry',
		checkCallback: (checking) => {
			const e = activeEntry();
			if (!e?.nativeNote || e.nativeNote.status === 'missing') return false;
			if (!checking) void ws.nativeNotes.open(e);
			return true;
		},
	});

	// From any note that belongs to an entry (native, adopted, or extra) back to the entry (0.21).
	const entryOfNote = (path: string | undefined) => {
		const s = ws.worlds.session;
		if (!s || !path) return null;
		for (const e of s.entities.values()) {
			if (e.trashedAt) continue;
			if (e.nativeNote?.path === path || e.linkedNote?.path === path || e.moreNotes.some((n) => n.path === path)) return e;
		}
		return null;
	};
	plugin.addCommand({
		id: 'open-entry-of-note',
		name: 'Open this note’s entry',
		checkCallback: (checking) => {
			const e = entryOfNote(plugin.app.workspace.getActiveFile()?.path);
			if (!e) return false;
			if (!checking) void ws.open({ name: 'entity', params: { id: e.id } });
			return true;
		},
	});
	plugin.registerEvent(
		plugin.app.workspace.on('file-menu', (menu, file) => {
			const e = entryOfNote(file?.path);
			if (!e) return;
			menu.addItem((i) => i.setTitle(`Open “${e.name}” in Worldsmith`).setIcon('globe-2').setSection('open').onClick(() => void ws.open({ name: 'entity', params: { id: e.id } })));
		}),
	);

	plugin.registerObsidianProtocolHandler('worldsmith', (params) => {
		void (async () => {
			await ws.ensureStarted();
			const entry = typeof params.entry === 'string' ? params.entry : null;
			const world = typeof params.world === 'string' ? params.world : null;
			if (world && ws.worlds.session?.worldId !== world) {
				if (!ws.worlds.manifest()?.worlds.some((w) => w.id === world)) {
					new Notice('That note belongs to a world that isn’t in this vault.');
					return;
				}
				await ws.worlds.switchWorld(world);
			}
			const s = ws.worlds.session;
			if (entry && s?.entities.get(entry)) await ws.open(ROUTES.entity(entry));
			else if (entry) new Notice('That entry isn’t in this world any more.');
			else await ws.open(ROUTES.dashboard());
		})();
	});

	// Reading view: the footer link shows whether the note is in step with its entry.
	plugin.registerMarkdownPostProcessor((el: HTMLElement, ctx: MarkdownPostProcessorContext) => {
		if (!ws.settings.nativeNotes.readingExtras) return;
		const link = el.querySelector<HTMLAnchorElement>('a[href^="obsidian://worldsmith"]');
		if (!link) return;
		const entity = ws.nativeNotes.entryOf(ctx.sourcePath);
		if (!entity) return;
		const st = ws.nativeNotes.state(entity);
		const conflicts = entity.nativeNote?.conflicts ?? [];
		const span = createSpan({ cls: `ws-nn-status${conflicts.length ? ' is-conflict' : ''}` });
		span.setText(st.status === 'missing' ? '' : conflicts.length ? `· ${conflicts.length === 1 ? '1 item needs' : `${conflicts.length} items need`} a decision` : '· In sync with Worldsmith');
		if (conflicts.length) span.addEventListener('click', () => new NoteConflictModal(ws, entity, conflicts).open());
		link.insertAdjacentElement('afterend', span);
	});
	return styles;
}
