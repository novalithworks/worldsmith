import type { FeatureId } from '../core/features';
import { promptModal } from '../ui/components/modals';
import { insertLinkAt } from '../ui/writing/toolbar';
import { Notice, type Command, type Plugin } from 'obsidian';
import { ROUTES } from '../state/route';
import { openCreateEntity, openNewType, openSearch } from '../ui/actions';
import { ReportModal } from '../ui/components/modals';
import { NewTaskModal } from '../ui/tasks/TaskModal';
import { customizePage } from '../ui/views/routes/entityPage';
import { customizeDashboard } from '../ui/views/routes/dashboardPage';
import { openNewDashboard } from '../ui/dashboards/DashboardModal';
import { DashboardSuggestModal } from '../ui/dashboards/DashboardSuggestModal';
import { WorldsmithView } from '../ui/views/WorldsmithView';
import { buildStyleReport } from './diagnostics';
import type { WorldsmithApp } from './WorldsmithApp';

/** Command palette entries. IDs are stable — never rename them after release. */
/** Commands that belong to a part a world can switch off (0.29): hidden while it's off. */
const COMMAND_FEATURE: Record<string, FeatureId> = {
	'open-tasks': 'tasks',
	'new-task': 'tasks',
	'new-dashboard': 'dashboards',
	'open-a-dashboard': 'dashboards',
	'open-media': 'media',
	'find-missing-images': 'media',
	'open-calendars': 'calendars',
	'open-timeline': 'timeline',
	'open-maps': 'maps',
	'open-trees': 'trees',
	'open-graph': 'graph',
	'mark-passage': 'writing',
};

/** A command that only shows while its part is on. */
function gated(c: Command, isOn: () => boolean): Command {
	const out: Command = { ...c };
	if (c.callback) {
		const run = c.callback;
		delete out.callback;
		out.checkCallback = (checking) => {
			if (!isOn()) return false;
			if (!checking) run();
			return true;
		};
	} else if (c.checkCallback) {
		const inner = c.checkCallback;
		out.checkCallback = (checking) => isOn() && inner(checking) !== false;
	}
	if (c.editorCallback) {
		const run = c.editorCallback;
		delete out.editorCallback;
		out.editorCheckCallback = (checking, ed, view) => {
			if (!isOn()) return false;
			if (!checking) void run(ed, view);
			return true;
		};
	} else if (c.editorCheckCallback) {
		const inner = c.editorCheckCallback;
		out.editorCheckCallback = (checking, ed, view) => isOn() && inner(checking, ed, view) !== false;
	}
	return out;
}

export function registerCommands(plugin: Plugin, ws: WorldsmithApp): void {
	// Commands of switchable parts check that part first (0.29).
	const add = plugin.addCommand.bind(plugin);
	const gatedAdd = (c: Command) => {
		const f = COMMAND_FEATURE[c.id];
		return add(f ? gated(c, () => ws.features.isOn(f)) : c);
	};
	// Registered through a small stand-in (never by replacing the plugin's own method).
	const proxy = new Proxy(plugin, {
		get(target, key, receiver) {
			if (key === 'addCommand') return gatedAdd;
			const v = Reflect.get(target, key, receiver) as unknown;
			return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(target) : v;
		},
	});
	registerAll(proxy, ws);
}

function registerAll(plugin: Plugin, ws: WorldsmithApp): void {
	const ready = () => !!ws.worlds.session;

	plugin.addCommand({ id: 'open', name: 'Open', callback: () => void ws.open(ROUTES.dashboard()) });
	plugin.addCommand({ id: 'open-dashboard', name: 'Open world dashboard', callback: () => void ws.open(ROUTES.dashboard()) });
	plugin.addCommand({ id: 'open-features', name: 'Open Features (choose what this world uses)', callback: () => void ws.open(ROUTES.features()) });

	const createFor: Array<[string, string]> = [
		['character', 'Create character'],
		['location', 'Create location'],
		['creature', 'Create creature'],
		['magic', 'Create magic system'],
		['faction', 'Create faction'],
		['event', 'Create historical event'],
	];
	for (const [typeId, name] of createFor) {
		plugin.addCommand({
			id: `create-${typeId}`,
			name,
			checkCallback: (checking) => {
				const ok = ready() && !!ws.worlds.session?.schemas.get(typeId);
				if (ok && !checking) openCreateEntity(ws, { typeId });
				return ok;
			},
		});
	}
	plugin.addCommand({
		id: 'create-entity',
		name: 'Create entity…',
		checkCallback: (checking) => {
			if (ready() && !checking) openCreateEntity(ws);
			return ready();
		},
	});
	plugin.addCommand({
		id: 'new-entity-type',
		name: 'Create entity type…',
		checkCallback: (checking) => {
			if (ready() && !checking) openNewType(ws);
			return ready();
		},
	});
	plugin.addCommand({
		id: 'search',
		name: 'Search entries',
		checkCallback: (checking) => {
			if (ready() && !checking) openSearch(ws);
			return ready();
		},
	});
	plugin.addCommand({ id: 'open-type-studio', name: 'Open Type Studio', callback: () => void ws.open(ROUTES.typeStudio()) });
	plugin.addCommand({ id: 'open-tasks', name: 'Open Tasks', callback: () => void ws.open(ROUTES.tasks()) });
	plugin.addCommand({
		id: 'new-task',
		name: 'New task…',
		checkCallback: (checking) => {
			const s = ws.worlds.session;
			if (s && !checking) new NewTaskModal({ ws, session: s, navigate: (r) => void ws.open(r) }).open();
			return !!s;
		},
	});
	plugin.addCommand({
		id: 'customize-page',
		name: 'Customize this page’s layout',
		checkCallback: (checking) => {
			const view = plugin.app.workspace.getActiveViewOfType(WorldsmithView);
			const pageEl = view?.route.name === 'entity' ? view.contentEl.querySelector<HTMLElement>('.ws-page--entity') : null;
			if (!pageEl) return false;
			if (!checking) customizePage(pageEl);
			return true;
		},
	});
	plugin.addCommand({
		id: 'customize-dashboard',
		name: 'Customize this dashboard',
		checkCallback: (checking) => {
			const view = plugin.app.workspace.getActiveViewOfType(WorldsmithView);
			const el = view?.route.name === 'dashboard' ? view.contentEl : null;
			if (!el?.querySelector('.ws-page--dashboard')) return false;
			if (!checking) customizeDashboard(el);
			return true;
		},
	});
	plugin.addCommand({
		id: 'new-dashboard',
		name: 'New dashboard…',
		checkCallback: (checking) => {
			const s = ws.worlds.session;
			if (s && !checking) openNewDashboard(ws, s, (r) => void ws.open(r));
			return !!s;
		},
	});
	plugin.addCommand({
		id: 'open-a-dashboard',
		name: 'Open a dashboard…',
		checkCallback: (checking) => {
			const s = ws.worlds.session;
			if (s && !checking) new DashboardSuggestModal(ws.app, s, (id) => void ws.open(ROUTES.dashboard(id))).open();
			return !!s;
		},
	});
	plugin.addCommand({ id: 'open-media', name: 'Open media library', callback: () => void ws.open(ROUTES.media()) });
	plugin.addCommand({ id: 'find-missing-images', name: 'Find missing images', callback: () => void ws.open(ROUTES.media('missing')) });
	plugin.addCommand({ id: 'open-calendars', name: 'Open Calendars', callback: () => void ws.open(ROUTES.calendars()) });
	plugin.addCommand({ id: 'open-timeline', name: 'Open Timeline', callback: () => void ws.open(ROUTES.timeline()) });
	plugin.addCommand({ id: 'open-health', name: 'Open World health', callback: () => void ws.open(ROUTES.health()) });
	plugin.addCommand({ id: 'open-maps', name: 'Open Maps', callback: () => void ws.open(ROUTES.maps()) });
	plugin.addCommand({ id: 'open-trees', name: 'Open Trees', callback: () => void ws.open(ROUTES.trees()) });
	plugin.addCommand({ id: 'open-graph', name: 'Open Graph', callback: () => void ws.open(ROUTES.graph()) });
	plugin.addCommand({ id: 'open-relationships', name: 'Open Relationships', callback: () => void ws.open(ROUTES.relationships()) });
	plugin.addCommand({ id: 'open-search', name: 'Open search page', callback: () => void ws.open(ROUTES.search()) });
	plugin.addCommand({ id: 'open-trash', name: 'Open trash', callback: () => void ws.open(ROUTES.trash()) });
	plugin.addCommand({
		id: 'style-report',
		name: 'Diagnose display problems (style report)',
		callback: () => {
			const r = buildStyleReport(ws.app);
			const intro = r.hits
				? `Found ${r.hits} rule${r.hits === 1 ? '' : 's'} from your theme, snippets or other plugins that style ${r.scope}. Copy this report and share it to get the conflict fixed.`
				: `Nothing outside Worldsmith styles ${r.scope}. Copy the report if something still looks wrong.`;
			new ReportModal(ws.app, 'Worldsmith style report', intro, r.text).open();
		},
	});
	plugin.addCommand({
		id: 'reload-world',
		name: 'Reload world from disk',
		callback: async () => {
			await ws.worlds.reload();
			new Notice('Worldsmith reloaded from disk.');
		},
	});
	plugin.addCommand({ id: 'open-help', name: 'Open help', callback: () => void ws.open({ name: 'help' }) });
	// 0.28: mark a passage of a scene for revision, with a note.
	plugin.addCommand({
		id: 'mark-passage',
		name: 'Mark passage for revision',
		editorCheckCallback: (checking, editor, view) => {
			const s = ws.worlds.session;
			const scene = view.file ? s?.writing.sceneByPath(view.file.path) : undefined;
			const quote = editor.getSelection().trim();
			if (!s || !scene || !quote) return false;
			if (!checking)
				void promptModal(ws.app, { title: 'Mark this passage', label: 'Your note', placeholder: 'Ten in chapter 2. Pick one.', confirmLabel: 'Mark passage' }).then((note) => {
					if (note === null) return;
					s.writing.addMark(scene.projectId, { sceneId: scene.id, quote, note });
					new Notice('Passage marked. It’s listed on the project’s Revision page.');
				});
			return true;
		},
	});
	// WS5: a link to an entry (or any note) at the cursor, in any note.
	plugin.addCommand({
		id: 'insert-entry-link',
		name: 'Insert link to a world entry',
		editorCheckCallback: (checking, editor, view) => {
			const s = ws.worlds.session;
			if (!s) return false;
			if (!checking) insertLinkAt(ws, s, editor, view.file?.path ?? '');
			return true;
		},
	});
	plugin.addCommand({
		id: 'open-backups',
		name: 'Open Backups & recovery',
		checkCallback: (checking) => {
			if (ws.worlds.session && !checking) void ws.open({ name: 'backups' });
			return !!ws.worlds.session;
		},
	});
	plugin.addCommand({
		id: 'backup-now',
		name: 'Back up the current world',
		checkCallback: (checking) => {
			const s = ws.worlds.session;
			if (s && !checking) {
				// A verified backup (0.20): success is shown only after it was read back and checked.
				void ws.backups
					.create('manual')
					.then(() => new Notice('Backup made and verified. See Backups & recovery.'))
					.catch((e) => new Notice(e instanceof Error ? e.message : String(e), 12000));
			}
			return !!s;
		},
	});
}
