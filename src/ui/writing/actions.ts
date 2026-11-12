import { CompileModal } from './compileModal';
import { holdSession } from './session';
import { EmbeddedEditor } from '../editor/EmbeddedEditor';
import { Menu, Notice, Platform, TFile, type App, type WorkspaceLeaf } from 'obsidian';
import type { ManuscriptItem, ManuscriptKind, WritingProject } from '../../core/types';
import type { WritingUndo } from '../../services/writing/WritingService';
import { subMenu } from '../actions';
import { confirmModal, promptModal } from '../components/modals';
import { actionNotice } from '../components/notice';
import { busyScenes, ImportFolderModal, MoveToModal, NewProjectModal, NoteChoiceModal, ProjectDetailsModal, SplitModal } from './dialogs';
import type { Studio } from './kit';
import { deviceMemory } from './device';
import { binderModel, CAN_HOLD, itemWord, stepTarget, type BinderModel } from './model';
import { SaveTemplateModal, StatusesModal, ThreadsModal, WhenModal } from './planDialogs';

/*
 * What can be done to projects, parts, chapters and scenes, shared by every studio screen
 * (menus, buttons, the binder's keys). All of it goes through session.writing, and every
 * change offers Undo.
 */

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** A notice with Undo for a studio change. */
export function undoNotice(st: Studio, message: string, undo: WritingUndo): void {
	actionNotice(message, {
		label: 'Undo',
		run: () => {
			// Undoing a split or merge moves text back between notes: that isn't writing.
			if (undo.kind !== 'records') holdSession(undo.projectId, null);
			void st.w.undo(undo).then(
				(r) => {
					if (r.unlinked.length) new Notice(`Another scene uses ${r.unlinked.length === 1 ? 'that note' : 'those notes'} now, so the scene came back without one: ${r.unlinked.join(', ')}`, 9000);
				},
				(e) => new Notice(errorText(e)),
			);
		},
	});
}

// ── notes ────────────────────────────────────────────────────────────────────

/** The tab the studio last opened a note in (reused, so notes don't pile up in new splits). */
let besideLeaf: WorkspaceLeaf | null = null;

/** Open a scene's note in a normal Obsidian tab beside the studio (a new tab on phones). */
/** What the next Manuscript page should do with its scene: start writing in it, or show its details (taken once). */
let intent: { sceneId: string; kind: 'write' | 'details' } | null = null;
export function takeIntent(sceneId: string): 'write' | 'details' | null {
	const k = intent?.sceneId === sceneId ? intent.kind : null;
	intent = null;
	return k;
}

/**
 * "Continue writing": the scene on the studio's Manuscript page, in the studio's own editor,
 * with the cursor on the page (never a normal note tab; only the Manuscript's own fallback,
 * when this Obsidian can't hold the editor, offers one).
 */
export function continueWriting(st: Studio, projectId: string, sceneId: string): void {
	intent = { sceneId, kind: 'write' };
	st.go({ project: projectId, view: 'manuscript', item: sceneId });
}

/** "Scene details": the scene on the Manuscript page with the inspector open on its Scene tab. */
export function sceneDetails(st: Studio, projectId: string, sceneId: string): void {
	const mem = deviceMemory(st.ws.app);
	mem.setSplit(projectId, { ...mem.split(projectId), side: 'inspector', tab: 'scene' });
	intent = { sceneId, kind: 'details' };
	st.go({ project: projectId, view: 'manuscript', item: sceneId });
}

export async function openNote(app: App, path: string, newTab = false): Promise<void> {
	const f = app.vault.getAbstractFileByPath(path);
	if (!(f instanceof TFile)) {
		new Notice(`“${path}” wasn’t found.`);
		return;
	}
	const alive = besideLeaf && app.workspace.getLeavesOfType('markdown').includes(besideLeaf);
	const leaf = !newTab && alive && besideLeaf ? besideLeaf : Platform.isMobile || newTab ? app.workspace.getLeaf('tab') : app.workspace.getLeaf('split', 'vertical');
	if (!newTab) besideLeaf = leaf;
	await leaf.openFile(f, { active: true });
}

export function createNote(st: Studio, scene: ManuscriptItem): void {
	void st.w.createNote(scene.id).then(
		(path) => path && new Notice(`Made a new note for “${scene.title}”: ${path}`),
		(e) => new Notice(`The note couldn’t be made: ${errorText(e)}`),
	);
}

/** Look for a missing note again: one match in the project folder is linked; otherwise the person chooses. */
export function findAgain(st: Studio, scene: ManuscriptItem): void {
	let candidates: string[] = [];
	try {
		candidates = st.w.rematchCandidates(scene.id);
	} catch (e) {
		new Notice(errorText(e));
		return;
	}
	const folder = st.w.project(scene.projectId)?.folder ?? '';
	const inProject = candidates.filter((c) => folder && (c === folder || c.startsWith(`${folder}/`)));
	if (candidates.length === 1 && inProject.length === 1) {
		const u = st.w.relink(scene.id, candidates[0]!);
		undoNotice(st, `Found it: “${candidates[0]}”.`, u);
		return;
	}
	if (!candidates.length) new Notice(`No note named “${scene.notePath?.split('/').pop() ?? ''}” was found. Choose the note yourself.`);
	new NoteChoiceModal(st, scene, candidates).open();
}

export function chooseNote(st: Studio, scene: ManuscriptItem): void {
	let candidates: string[] = [];
	try {
		candidates = scene.notePath ? st.w.rematchCandidates(scene.id) : [];
	} catch {
		/* no vault yet */
	}
	new NoteChoiceModal(st, scene, candidates).open();
}

// ── projects ─────────────────────────────────────────────────────────────────

export const newProject = (st: Studio): void => new NewProjectModal(st).open();
export const importFolder = (st: Studio, projectId?: string): void => new ImportFolderModal(st, { projectId }).open();

export async function renameProject(st: Studio, p: WritingProject): Promise<void> {
	const name = await promptModal(st.ws.app, { title: 'Rename project', label: 'Title', value: p.name, confirmLabel: 'Rename' });
	if (name === null || !name.trim() || name.trim() === p.name) return;
	const { before, after } = st.w.renameProject(p.id, name);
	actionNotice(`Renamed to “${name.trim()}”.`, { label: 'Undo', run: () => st.w.restoreProject(before, after) });
}

export function toggleArchive(st: Studio, p: WritingProject): void {
	if (p.archivedAt === null) {
		st.w.archiveProject(p.id);
		actionNotice(`Archived “${p.name}”. Its notes and scenes are kept as they are.`, { label: 'Undo', run: () => void st.w.unarchiveProject(p.id) });
	} else {
		st.w.unarchiveProject(p.id);
		new Notice(`“${p.name}” is back in the studio.`);
	}
}

export function projectMenu(st: Studio, p: WritingProject, opts: { inProject?: boolean } = {}): Menu {
	const m = new Menu();
	if (!opts.inProject) {
		m.addItem((i) => i.setTitle('Open').setIcon('book-open').onClick(() => st.go({ project: p.id, view: 'overview' })));
		m.addItem((i) => i.setTitle('Open in new tab').setIcon('file-plus-2').onClick(() => st.go({ project: p.id, view: 'overview' }, 'tab')));
		m.addSeparator();
	}
	m.addItem((i) => i.setTitle('Rename…').setIcon('pencil').onClick(() => void renameProject(st, p)));
	m.addItem((i) => i.setTitle('Details and word goal…').setIcon('settings-2').onClick(() => new ProjectDetailsModal(st, p).open()));
	// WS7: compile the open project (the dialog works on the project the studio shows).
	if (st.project?.id === p.id) m.addItem((i) => i.setTitle('Compile…').setIcon('file-output').onClick(() => new CompileModal(st).open()));
	m.addItem((i) => i.setTitle('Import notes into it…').setIcon('file-input').onClick(() => importFolder(st, p.id)));
	m.addSeparator();
	m.addItem((i) => i.setTitle('Scene statuses…').setIcon('circle-dot').onClick(() => new StatusesModal(st, p).open()));
	m.addItem((i) => i.setTitle('Plot threads…').setIcon('spline').onClick(() => new ThreadsModal(st, p).open()));
	m.addItem((i) => i.setTitle('Save as a template…').setIcon('bookmark-plus').onClick(() => new SaveTemplateModal(st, p).open()));
	m.addSeparator();
	m.addItem((i) => i.setTitle('Trash').setIcon('trash').onClick(() => st.go({ project: p.id, view: 'trash' })));
	m.addSeparator();
	m.addItem((i) => i.setTitle(p.archivedAt === null ? 'Archive' : 'Unarchive').setIcon(p.archivedAt === null ? 'archive' : 'archive-restore').onClick(() => toggleArchive(st, p)));
	return m;
}

// ── parts, chapters and scenes ───────────────────────────────────────────────

/** Where a new item of `kind` goes, near the selected item. */
export function placeNear(m: BinderModel, near: ManuscriptItem | null, kind: ManuscriptKind): { parentId: string | null; index?: number } {
	if (!near) return { parentId: null };
	const n = m.nodes.get(near.id);
	if (!n) return { parentId: null };
	// Inside the selected part or chapter when it can hold it, at the end.
	if (n.kind !== 'scene' && CAN_HOLD[n.kind].includes(kind)) return { parentId: n.id };
	// Otherwise right after the selected item (or the enclosing one that can be its sibling).
	let cur = n;
	for (let guard = 0; guard < 64; guard++) {
		const parentKind = cur.parentId === null ? 'root' : (m.nodes.get(cur.parentId)?.kind ?? 'root');
		if (CAN_HOLD[parentKind].includes(kind)) return { parentId: cur.parentId, index: (m.kids.get(cur.parentId) ?? []).indexOf(cur.id) + 1 };
		const up = cur.parentId ? m.nodes.get(cur.parentId) : undefined;
		if (!up) break;
		cur = up;
	}
	return { parentId: null };
}

/** Ask for a title, then add a part, chapter or scene (a scene gets a new empty note). */
export async function createItem(st: Studio, projectId: string, kind: ManuscriptKind, near: ManuscriptItem | null, onMade?: (item: ManuscriptItem) => void): Promise<void> {
	const word = itemWord(kind);
	const title = await promptModal(st.ws.app, {
		title: `New ${word.toLowerCase()}`,
		label: 'Title',
		placeholder: `${word} title`,
		confirmLabel: kind === 'scene' ? 'Add scene and note' : `Add ${word.toLowerCase()}`,
	});
	if (title === null) return;
	const m = binderModel(st.w.tree(projectId));
	const at = placeNear(m, near, kind);
	try {
		const res = await st.w.create(projectId, { kind, title: title.trim() || undefined, parentId: at.parentId, index: at.index });
		onMade?.(res.item);
		undoNotice(st, kind === 'scene' && res.item.notePath ? `Added “${res.item.title}” with a new note, ${res.item.notePath}.` : `Added “${res.item.title}”.`, res.undo);
	} catch (e) {
		new Notice(errorText(e));
	}
}

export async function renameItem(st: Studio, it: ManuscriptItem): Promise<void> {
	const name = await promptModal(st.ws.app, { title: `Rename ${itemWord(it.kind).toLowerCase()}`, label: 'Title', value: it.title, confirmLabel: 'Rename' });
	if (name === null || !name.trim() || name.trim() === it.title) return;
	const u = st.w.rename(it.id, name);
	undoNotice(st, it.kind === 'scene' && it.notePath ? `Renamed to “${name.trim()}”. The note keeps its file name.` : `Renamed to “${name.trim()}”.`, u);
}

export function trashItem(st: Studio, it: ManuscriptItem): void {
	const u = st.w.trash(it.id);
	const inside = it.kind === 'scene' ? '' : ' and what’s in it';
	undoNotice(st, `Moved “${it.title}”${inside} to the studio’s trash. ${it.kind === 'scene' ? 'Its note stays' : 'The notes stay'} in your vault.`, u);
}

export function duplicateItem(st: Studio, it: ManuscriptItem): void {
	void st.w.duplicate(it.id).then(
		(res) => undoNotice(st, res.notes.length ? `Copied “${it.title}” with ${res.notes.length === 1 ? 'a copy of its note' : `copies of ${res.notes.length} notes`}.` : `Copied “${it.title}”.`, res.undo),
		(e) => new Notice(errorText(e)),
	);
}

export function moveStep(st: Studio, it: ManuscriptItem, dir: -1 | 1): void {
	const t = stepTarget(binderModel(st.w.tree(it.projectId)), it.id, dir);
	if (!t) return;
	try {
		const u = st.w.move(it.id, t);
		const parent = t.parentId !== it.parentId && t.parentId ? st.w.item(t.parentId) : null;
		undoNotice(st, parent ? `Moved “${it.title}” into “${parent.title}”.` : `Moved “${it.title}” ${dir < 0 ? 'up' : 'down'}.`, u);
	} catch (e) {
		new Notice(errorText(e));
	}
}

/** The scene right after this one in reading order (Merge with next). */
export function nextScene(st: Studio, it: ManuscriptItem): ManuscriptItem | null {
	const order = st.w.scenes(it.projectId);
	const i = order.findIndex((s) => s.id === it.id);
	return i >= 0 ? (order[i + 1] ?? null) : null;
}

export async function mergeWithNext(st: Studio, it: ManuscriptItem): Promise<void> {
	const next = nextScene(st, it);
	if (!next || busyScenes.has(it.id) || busyScenes.has(next.id)) return;
	const ok = await confirmModal(st.ws.app, {
		title: `Merge “${it.title}” with “${next.title}”?`,
		body: `The text of “${next.title}” is added to the end of “${it.title}”. Its own note is left exactly as it is, and its scene goes to the studio’s trash, so you can undo this.`,
		confirmLabel: 'Merge scenes',
	});
	if (!ok) return;
	busyScenes.add(it.id);
	busyScenes.add(next.id);
	try {
		// What's typed in the studio but not saved yet goes in too.
		await EmbeddedEditor.saveOpen([it.notePath, next.notePath]);
		// The merged text isn't new writing: the session keeps these notes' words as they are.
		holdSession(it.projectId, [it.notePath, next.notePath]);
		const res = await st.w.merge(it.id, next.id);
		undoNotice(st, `Merged “${next.title}” into “${it.title}”.`, res.undo);
	} catch (e) {
		new Notice(errorText(e));
	} finally {
		busyScenes.delete(it.id);
		busyScenes.delete(next.id);
		st.repaint();
	}
}

export function setStatus(st: Studio, it: ManuscriptItem, status: string): void {
	if (it.status === status) return;
	const res = st.w.update(it.id, { status });
	const label = st.w.project(it.projectId)?.statuses.find((s) => s.id === status)?.label ?? status;
	undoNotice(st, `“${it.title}” is now ${label}.`, res.undo);
}

export function toggleThread(st: Studio, it: ManuscriptItem, threadId: string): void {
	const cur = st.w.item(it.id) ?? it;
	const on = !cur.threads.includes(threadId);
	const label = st.w.project(it.projectId)?.threads.find((t) => t.id === threadId)?.label ?? 'the thread';
	const u = st.w.toggleThread(it.id, threadId, on);
	undoNotice(st, on ? `“${it.title}” is now in “${label}”.` : `“${it.title}” is no longer in “${label}”.`, u);
}

/**
 * The menu of a part, chapter or scene (right-click, the "…" button, or the context-menu
 * key): open, rename, status, copy, move, split, merge, collapse, trash.
 */
export function itemMenu(st: Studio, it: ManuscriptItem, opts: { onSelect?: (id: string) => void } = {}): Menu {
	const p = st.w.project(it.projectId);
	const m = new Menu();
	const busy = busyScenes.has(it.id);
	if (it.kind === 'scene') {
		const state = st.w.noteState(it.id);
		if (state === 'ok' && it.notePath) {
			const path = it.notePath;
			m.addItem((i) => i.setTitle('Open note').setIcon('feather').onClick(() => void openNote(st.ws.app, path)));
			m.addItem((i) => i.setTitle('Open note in new tab').setIcon('file-plus-2').onClick(() => void openNote(st.ws.app, path, true)));
		} else if (state === 'missing') {
			m.addItem((i) => i.setTitle('Find the note again').setIcon('search').onClick(() => findAgain(st, it)));
		} else if (state === 'none') {
			m.addItem((i) => i.setTitle('Create note').setIcon('file-plus').onClick(() => createNote(st, it)));
		}
		m.addSeparator();
	} else {
		m.addItem((i) => i.setTitle('New scene inside…').setIcon('square-plus').onClick(() => void createItem(st, it.projectId, 'scene', it, (x) => opts.onSelect?.(x.id))));
		if (it.kind === 'part') m.addItem((i) => i.setTitle('New chapter inside…').setIcon('bookmark-plus').onClick(() => void createItem(st, it.projectId, 'chapter', it, (x) => opts.onSelect?.(x.id))));
		m.addSeparator();
	}
	m.addItem((i) => i.setTitle('Rename…').setIcon('pencil').onClick(() => void renameItem(st, it)));
	if (it.kind === 'scene' && p) {
		const sub = subMenu(m, 'Status', 'circle-dot');
		for (const s of p.statuses) sub.addItem((i) => i.setTitle(s.label).setChecked(it.status === s.id).onClick(() => setStatus(st, it, s.id)));
		if (sub === m) m.addSeparator();
		// WS4: plot threads and when it happens in the story.
		const th = subMenu(m, 'Plot threads', 'spline');
		for (const t of p.threads) th.addItem((i) => i.setTitle(t.label).setChecked(it.threads.includes(t.id)).onClick(() => toggleThread(st, it, t.id)));
		th.addItem((i) => i.setTitle(p.threads.length ? 'Edit plot threads…' : 'New plot thread…').setIcon('pencil').onClick(() => new ThreadsModal(st, p, { addOne: !p.threads.length }).open()));
		if (th === m) m.addSeparator();
		m.addItem((i) => i.setTitle('In-story date…').setIcon('calendar-clock').onClick(() => new WhenModal(st, it).open()));
	}
	m.addSeparator();
	m.addItem((i) => i.setTitle('Duplicate').setIcon('copy').onClick(() => duplicateItem(st, it)));
	m.addItem((i) => i.setTitle('Move to…').setIcon('move').onClick(() => new MoveToModal(st, it).open()));
	const model = binderModel(st.w.tree(it.projectId));
	const up = stepTarget(model, it.id, -1);
	const down = stepTarget(model, it.id, 1);
	m.addItem((i) => i.setTitle('Move up').setIcon('arrow-up').setDisabled(!up).onClick(() => moveStep(st, it, -1)));
	m.addItem((i) => i.setTitle('Move down').setIcon('arrow-down').setDisabled(!down).onClick(() => moveStep(st, it, 1)));
	if (it.kind === 'scene') {
		m.addSeparator();
		const canSplit = st.w.noteState(it.id) === 'ok' && !busy;
		m.addItem((i) => i.setTitle('Split…').setIcon('scissors').setDisabled(!canSplit).onClick(() => new SplitModal(st, it, (c) => opts.onSelect?.(c.id)).open()));
		const next = nextScene(st, it);
		m.addItem((i) => i.setTitle(next ? `Merge with “${next.title}”` : 'Merge with next').setIcon('merge').setDisabled(!next || busy).onClick(() => void mergeWithNext(st, it)));
	} else {
		m.addItem((i) => i.setTitle(it.collapsed ? 'Expand' : 'Collapse').setIcon(it.collapsed ? 'chevrons-up-down' : 'chevrons-down-up').onClick(() => st.w.setCollapsed(it.id, !it.collapsed)));
	}
	m.addSeparator();
	m.addItem((i) => i.setTitle('Move to trash').setIcon('trash-2').setWarning(true).onClick(() => trashItem(st, it)));
	return m;
}
