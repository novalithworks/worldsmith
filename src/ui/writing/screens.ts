import { Menu, Notice, setTooltip } from 'obsidian';
import type { ManuscriptItem, ProjectKind, WritingProject } from '../../core/types';
import { PROJECT_KINDS } from '../../core/types';
import { relativeTime } from '../../core/util/strings';
import { button, cx, icon } from '../components/dom';
import { continueWriting, findAgain, importFolder, newProject, projectMenu, sceneDetails, toggleArchive } from './actions';
import { bar, caps, cover, dot, fmt, head, hint, KIND_ICON, ornament, panel, statusPill, type Studio } from './kit';
import { binderModel, count, excerptOf, greeting, itemWord, kindLabel, kindPlural, projectStatus, sortProjects, statusOf, type ProjectSort, chapterOf as chapterNode } from './model';
import { dayKey, lastDays, projectedFinish, streaks } from '../../services/writing/progress';
import { numberWords } from '../../services/writing/compile';
import { avatar } from '../components/avatar';
import { arcPeople } from '../../services/writing/world';

/*
 * The studio screens outside the manuscript (WS2): the home desk, the projects library, a
 * project's overview with its Contents page, and the project's trash.
 */

/** When a project's writing last changed: its newest scene note, else the project record. */
function lastEdited(st: Studio, p: WritingProject): number {
	const v = st.w.vault;
	let t = 0;
	if (v) for (const s of st.w.scenes(p.id)) if (s.notePath) t = Math.max(t, v.file(s.notePath)?.mtime ?? 0);
	return t || p.updatedAt;
}

/** The scene edited most recently, among projects in the studio. */
function recentScene(st: Studio): { scene: ManuscriptItem; project: WritingProject; mtime: number } | null {
	const v = st.w.vault;
	if (!v) return null;
	let best: { scene: ManuscriptItem; project: WritingProject; mtime: number } | null = null;
	for (const p of st.w.projects()) {
		for (const s of st.w.scenes(p.id)) {
			const f = s.notePath ? v.file(s.notePath) : null;
			if (f && (!best || f.mtime > best.mtime)) best = { scene: s, project: p, mtime: f.mtime };
		}
	}
	return best;
}


const wordsText = (st: Studio, p: WritingProject): string => (st.w.words.isWarm(p.id) ? fmt(st.w.wordCount(p.id)) : '…');

// ── home ─────────────────────────────────────────────────────────────────────

export function renderHome(st: Studio, el: HTMLElement): void {
	const projects = st.w.projects();
	const wrap = el.createDiv({ cls: 'ws-wr-home' });
	const hello = wrap.createDiv({ cls: 'ws-wr-hello' });
	const author = projects.map((p) => p.author?.trim()).find(Boolean);
	hello.createEl('h1', { cls: 'ws-wr-hello__title', text: `${greeting(new Date())}${author ? `, ${author.split(/\s+/)[0]}` : ''}.` });
	if (!projects.length) {
		renderEmptyDesk(st, wrap);
		return;
	}
	// Today, the streak and the week, across every book.
	const todayKey = dayKey();
	const allDays: Record<string, number> = {};
	for (const p of projects) for (const [k, n] of Object.entries(p.days ?? {})) allDays[k] = (allDays[k] ?? 0) + n;
	const today = projects.reduce((n, p) => n + st.w.wordsToday(p.id), 0);
	allDays[todayKey] = today;
	const goal = projects.reduce((n, p) => n + (p.dailyGoal ?? 0), 0) || null;
	const sk = streaks(allDays, goal, todayKey);
	const left = goal ? goal - today : 0;
	const line = goal ? (left > 0 ? `You are ${fmt(left)} words from today’s goal` : 'You’ve met today’s goal') : `${count(projects.length, 'project')} in ${st.s.world.name}`;
	hello.createEl('p', { cls: 'ws-wr-hello__line', text: `${line}${sk.current > 0 ? `, and ${numberWords(sk.current).toLowerCase()} day${sk.current === 1 ? '' : 's'} into your streak` : ''}.` });
	const grid = wrap.createDiv({ cls: 'ws-wr-home__grid' });
	const main = grid.createDiv({ cls: 'ws-wr-home__main' });
	const recent = recentScene(st);
	if (recent) continueSpread(st, main, recent);
	const tools = head(main, { title: 'Writing projects', sub: `${count(projects.length, 'project')} in ${st.s.world.name}` });
	button(tools, { label: 'All projects', variant: 'ghost', size: 'sm', onClick: () => st.go({ view: 'projects' }) });
	button(tools, { label: 'New project', icon: 'plus', variant: 'primary', size: 'sm', onClick: () => newProject(st) });
	const cards = main.createDiv({ cls: 'ws-wr-cards' });
	for (const p of projects) projectCard(st, cards, p);

	const side = grid.createDiv({ cls: 'ws-wr-home__side' });
	const tiles = side.createDiv({ cls: 'ws-wr-tiles' });
	const total = projects.reduce((n, p) => n + st.w.wordCount(p.id), 0);
	const warm = projects.every((p) => st.w.words.isWarm(p.id));
	const week = lastDays(allDays, todayKey, 7).reduce((n, d) => n + d.words, 0);
	const monthPrefix = todayKey.slice(0, 8);
	const month = Object.entries(allDays).reduce((n, [k, v]) => (k.startsWith(monthPrefix) ? n + v : n), 0);
	const completed = projects.filter((p) => projectStatus(p, st.w.scenes(p.id))?.done).length;
	const tile = (n: string, l: string, deco: (t: HTMLElement) => void = () => {}) => {
		const t = tiles.createDiv({ cls: 'ws-wr-tile' });
		deco(t);
		t.createDiv({ cls: 'ws-wr-tile__n', text: n });
		t.createDiv({ cls: 'ws-wr-tile__l', text: l });
	};
	tile(fmt(Math.max(0, today)), 'words today', (t) => miniRing(t, goal ? today / goal : 0));
	tile(String(sk.current), sk.current === 1 ? 'day streak' : 'day streak', (t) => icon(t, 'flame', sk.current > 0 ? 'ws-wr-tile__flame is-lit' : 'ws-wr-tile__flame'));
	tile(fmt(week), goal ? `this week · goal ${fmt(goal * 7)}` : 'this week');
	tile(fmt(month), 'this month');
	tile(warm ? fmt(total) : '…', 'total words');
	tile(`${projects.length - completed} · ${completed}`, 'active · completed');

	// Upcoming goals: finish dates first, then word goals on their way.
	const goals = side.createEl('section', { cls: 'ws-wr-panel ws-wr-goals' });
	goals.createDiv({ cls: 'ws-wr-panel__head' }).createEl('h3', { cls: 'ws-wr-panel__title', text: 'Upcoming goals' });
	const glist = goals.createDiv({ cls: 'ws-wr-goals__list' });
	let any = false;
	for (const p of projects) {
		if (!p.wordTarget) continue;
		const words = st.w.wordCount(p.id);
		const row = glist.createDiv({ cls: 'ws-wr-goal' });
		miniRing(row, words / p.wordTarget);
		const tx = row.createDiv({ cls: 'ws-wr-goal__text' });
		const finish = projectedFinish(words, p.wordTarget, p.days ?? {}, todayKey);
		tx.createDiv({ cls: 'ws-wr-goal__title', text: p.deadline ? `Finish ${p.name}` : `${fmt(p.wordTarget)} words in ${p.name}` });
		tx.createDiv({ cls: 'ws-wr-goal__sub', text: p.deadline ? `${fmt(Math.max(0, p.wordTarget - words))} words · by ${shortDay(p.deadline)}` : finish ? `on pace for ${shortDay(finish)}` : `${fmt(words)} so far` });
		any = true;
	}
	if (!any) glist.createDiv({ cls: 'ws-wr-muted ws-wr-goals__none', text: 'Give a project a word goal or a finish date (in its details) and it shows here.' });

	const qa = panel(side, 'Quick actions');
	const q = qa.createDiv({ cls: 'ws-wr-quick' });
	const quick = (label: string, ic: string, run: () => void) => {
		const b = q.createEl('button', { cls: 'ws-wr-quick__item', attr: { type: 'button' } });
		icon(b, ic);
		b.createSpan({ text: label });
		b.addEventListener('click', run);
	};
	const book = recent?.project ?? projects[0]!;
	quick('New project', 'book-plus', () => newProject(st));
	if (recent) quick('Continue writing', 'corner-down-right', () => continueWriting(st, recent.project.id, recent.scene.id));
	quick('Open outline', 'list-tree', () => st.go({ project: book.id, view: 'outline' }));
	quick('Story board', 'layout-grid', () => st.go({ project: book.id, view: 'corkboard' }));
	quick('Import a folder', 'folder-input', () => importFolder(st));
	quick('All projects', 'library', () => st.go({ view: 'projects' }));
	const archived = st.w.projects({ archived: true }).length;
	if (archived) hint(side, `${count(archived, 'archived project')} hidden. Find ${archived === 1 ? 'it' : 'them'} under Projects › Archived.`, 'archive');
}

/** "24 Nov" (with the year when it isn't this year). */
function shortDay(key: string): string {
	const [y, m, d] = key.split('-').map(Number) as [number, number, number];
	const dt = new Date(y, m - 1, d);
	return dt.toLocaleDateString(undefined, { day: 'numeric', month: 'short', ...(y !== new Date().getFullYear() ? { year: 'numeric' } : {}) });
}

/** A small ring (progress toward something). */
function miniRing(parent: HTMLElement, ratio: number): void {
	const r = Math.max(0, Math.min(1, ratio));
	const NS = 'http://www.w3.org/2000/svg';
	const svg = activeDocument.createElementNS(NS, 'svg');
	svg.setAttribute('viewBox', '0 0 36 36');
	svg.setAttribute('class', 'ws-wr-ring ws-wr-minring');
	svg.setAttribute('aria-hidden', 'true');
	const C = 2 * Math.PI * 14;
	for (const [cls, dash] of [['ws-wr-ring__track', `${C} ${C}`], ['ws-wr-ring__fill', `${C * r} ${C}`]] as const) {
		const c = activeDocument.createElementNS(NS, 'circle');
		c.setAttribute('cx', '18');
		c.setAttribute('cy', '18');
		c.setAttribute('r', '14');
		c.setAttribute('class', cls);
		c.setAttribute('stroke-dasharray', dash);
		c.setAttribute('transform', 'rotate(-90 18 18)');
		svg.appendChild(c);
	}
	parent.appendChild(svg);
}

/** "Chapter One · Scene Two" for the spread's kicker. */
function placeInWords(st: Studio, scene: ManuscriptItem): string {
	const m = binderModel(st.w.tree(scene.projectId));
	const ch = chapterNode(m, scene.id);
	const chNo = ch ? m.chapterNo.get(ch.id) : undefined;
	const all = st.w.scenes(scene.projectId);
	const inCh = ch ? all.filter((x) => chapterNode(m, x.id)?.id === ch.id) : all;
	const sNo = inCh.findIndex((x) => x.id === scene.id) + 1;
	return [chNo ? `Chapter ${numberWords(chNo)}` : '', sNo ? `Scene ${numberWords(sNo)}` : ''].filter(Boolean).join(' · ');
}

function renderEmptyDesk(st: Studio, wrap: HTMLElement): void {
	const sheet = wrap.createDiv({ cls: 'ws-wr-paper ws-wr-emptydesk' });
	caps(sheet, 'Your writing desk', 'ws-wr-paper__eyebrow');
	ornament(sheet);
	sheet.createEl('h2', { cls: 'ws-wr-paper__title', text: 'Begin a book, a story or a script' });
	sheet.createEl('p', { text: 'A writing project is a folder of ordinary notes in your vault: each note is a scene. Worldsmith keeps everything around them — the order, the parts and chapters, each scene’s status and your word goal — and never changes your notes.' });
	sheet.createEl('p', { text: 'Start an empty project (or one from a structure such as three acts), or link a folder of notes you already have.' });
	const row = sheet.createDiv({ cls: 'ws-wr-emptydesk__actions' });
	button(row, { label: 'New project', icon: 'book-plus', variant: 'primary', onClick: () => newProject(st) });
	button(row, { label: 'Import a folder', icon: 'file-input', variant: 'ghost', onClick: () => importFolder(st) });
}

function continueSpread(st: Studio, parent: HTMLElement, r: { scene: ManuscriptItem; project: WritingProject; mtime: number }): void {
	const book = parent.createDiv({ cls: 'ws-wr-spread' });
	const left = book.createDiv({ cls: 'ws-wr-spread__page ws-wr-spread__page--l' });
	caps(left, 'Where you left off');
	const prose = left.createEl('p', { cls: 'ws-wr-spread__prose', text: '…' });
	const right = book.createDiv({ cls: 'ws-wr-spread__page ws-wr-spread__page--r' });
	caps(right, placeInWords(st, r.scene) || r.project.name);
	right.createEl('h3', { cls: 'ws-wr-spread__title', text: r.scene.title });
	const words = st.w.words.words(r.scene.notePath);
	right.createDiv({ cls: 'ws-wr-spread__meta', text: `${words !== null ? `${count(words, 'word')} · ` : ''}edited ${relativeTime(r.mtime)}` });
	// Who's in it: their portraits.
	const people = [...new Set([...(r.scene.pov ? [r.scene.pov] : []), ...r.scene.cast])].map((id) => st.s.entities.get(id)).filter((e): e is NonNullable<typeof e> => !!e && !e.trashedAt);
	if (people.length) {
		const faces = right.createDiv({ cls: 'ws-wr-spread__cast' });
		for (const e of people.slice(0, 6)) {
			const a = avatar(faces, st.ws.app, e, st.s.schemas.get(e.typeId), { size: 'sm' });
			a.setAttr('title', e.name);
		}
	}
	const row = right.createDiv({ cls: 'ws-wr-spread__actions' });
	button(row, { label: 'Continue writing', icon: 'feather', variant: 'primary', size: 'sm', cls: 'ws-wr-continue', onClick: () => continueWriting(st, r.project.id, r.scene.id) });
	button(row, { label: 'Scene details', variant: 'quiet', size: 'sm', cls: 'ws-wr-scenedetails', onClick: () => sceneDetails(st, r.project.id, r.scene.id) });
	const v = st.w.vault;
	if (v && r.scene.notePath) {
		void v.cachedRead(r.scene.notePath).then(
			(text) => prose.setText(excerptOf(text, 300) || 'This scene has no words yet.'),
			() => prose.setText(''),
		);
	}
}

function projectCard(st: Studio, parent: HTMLElement, p: WritingProject): void {
	const card = parent.createDiv({ cls: 'ws-wr-card', attr: { tabindex: '0', role: 'link', 'data-project': p.id } });
	cover(card, p, 'card');
	const t = card.createDiv({ cls: 'ws-wr-card__text' });
	t.createDiv({ cls: 'ws-wr-card__title', text: p.name });
	const scenes = st.w.scenes(p.id);
	t.createDiv({ cls: 'ws-wr-card__sub', text: `${kindLabel(p.kind)} · ${count(scenes.length, 'scene')}` });
	if (p.description) t.createDiv({ cls: 'ws-wr-card__desc', text: p.description });
	const stRow = t.createDiv({ cls: 'ws-wr-card__status' });
	statusPill(stRow, projectStatus(p, scenes));
	stRow.createSpan({ cls: 'ws-wr-muted', text: relativeTime(lastEdited(st, p)) });
	const words = st.w.wordCount(p.id);
	const warm = st.w.words.isWarm(p.id);
	if (p.wordTarget) bar(t, words / p.wordTarget);
	const w = t.createDiv({ cls: 'ws-wr-card__words' });
	w.createSpan({ text: p.wordTarget ? `${warm ? fmt(words) : '…'} / ${fmt(p.wordTarget)}` : `${warm ? fmt(words) : '…'} words` });
	if (p.wordTarget && warm) w.createSpan({ cls: 'ws-wr-muted', text: `${Math.round((words / p.wordTarget) * 100)}%` });
	const foot = t.createDiv({ cls: 'ws-wr-card__foot' });
	const world = foot.createSpan({ cls: 'ws-wr-muted ws-wr-card__folder', attr: { title: p.folder ? `Notes in ${p.folder}` : 'Notes at the top of the vault' } });
	icon(world, st.s.world.icon || 'globe-2');
	world.createSpan({ text: st.s.world.name });
	button(foot, { label: 'Continue', icon: 'corner-down-right', variant: 'ghost', size: 'sm', cls: 'ws-wr-card__continue', onClick: (e) => (e.stopPropagation(), st.go({ project: p.id, view: 'manuscript' })) });
	const open = (evt: MouseEvent | KeyboardEvent) => st.go({ project: p.id, view: 'overview' }, evt.metaKey || evt.ctrlKey ? 'tab' : false);
	card.addEventListener('click', open);
	card.addEventListener('keydown', (e) => e.key === 'Enter' && open(e));
	card.addEventListener('contextmenu', (e) => {
		e.preventDefault();
		projectMenu(st, p).showAtMouseEvent(e);
	});
}

// ── projects library ─────────────────────────────────────────────────────────

const SORTS: Array<[ProjectSort, string]> = [
	['edited', 'Last edited'],
	['title', 'Title'],
	['words', 'Most words'],
	['created', 'Newest'],
];

export interface LibraryState {
	filter: ProjectKind | 'all' | 'archived';
	sort: ProjectSort;
}

export function renderLibrary(st: Studio, el: HTMLElement, state: LibraryState): void {
	const wrap = el.createDiv({ cls: 'ws-wr-library' });
	const tools = head(wrap, { eyebrow: 'The shelf', title: 'Writing projects', sub: `Every book, story and script in ${st.s.world.name}.` });
	button(tools, { label: 'Import notes', icon: 'file-input', variant: 'ghost', size: 'sm', onClick: () => importFolder(st) });
	button(tools, { label: 'New project', icon: 'plus', variant: 'primary', size: 'sm', onClick: () => newProject(st) });
	const active = st.w.projects();
	const archived = st.w.projects({ archived: true });
	const bar0 = wrap.createDiv({ cls: 'ws-wr-filters', attr: { role: 'toolbar', 'aria-label': 'Filter projects' } });
	const chip = (id: LibraryState['filter'], label: string, n: number) => {
		const c = bar0.createEl('button', { cls: cx('ws-wr-chip', state.filter === id && 'is-active'), attr: { type: 'button', 'aria-pressed': String(state.filter === id), 'data-filter': id } });
		c.createSpan({ text: label });
		c.createSpan({ cls: 'ws-wr-chip__n', text: String(n) });
		c.addEventListener('click', () => {
			state.filter = id;
			st.repaint();
		});
	};
	chip('all', 'All', active.length);
	for (const k of PROJECT_KINDS) {
		const n = active.filter((p) => p.kind === k).length;
		if (n) chip(k, kindPlural(k), n);
	}
	chip('archived', 'Archived', archived.length);
	bar0.createDiv({ cls: 'ws-wr-spacer' });
	button(bar0, {
		label: SORTS.find(([id]) => id === state.sort)?.[1] ?? 'Sort',
		icon: 'arrow-down-up',
		variant: 'ghost',
		size: 'sm',
		cls: 'ws-wr-sort',
		onClick: (evt) => {
			const m = new Menu();
			for (const [id, label] of SORTS)
				m.addItem((i) =>
					i
						.setTitle(label)
						.setChecked(state.sort === id)
						.onClick(() => {
							state.sort = id;
							st.repaint();
						}),
				);
			m.showAtMouseEvent(evt);
		},
	});
	const list = state.filter === 'archived' ? archived : state.filter === 'all' ? active : active.filter((p) => p.kind === state.filter);
	if (!list.length) {
		const e = wrap.createDiv({ cls: 'ws-wr-none' });
		e.setText(state.filter === 'archived' ? 'No archived projects. Archiving hides a project from the studio without changing anything in it.' : active.length ? 'No projects of this kind.' : 'No writing projects yet.');
		if (!active.length && state.filter !== 'archived') {
			const row = e.createDiv({ cls: 'ws-wr-none__actions' });
			button(row, { label: 'New project', icon: 'plus', variant: 'primary', size: 'sm', onClick: () => newProject(st) });
			button(row, { label: 'Import a folder', icon: 'file-input', variant: 'ghost', size: 'sm', onClick: () => importFolder(st) });
		}
	} else {
		const rows = sortProjects(
			list.map((project) => ({ project, edited: lastEdited(st, project), words: st.w.wordCount(project.id) })),
			state.sort,
		);
		const tbl = wrap.createDiv({ cls: 'ws-wr-table', attr: { role: 'table', 'aria-label': 'Writing projects' } });
		const hr = tbl.createDiv({ cls: 'ws-wr-table__row ws-wr-table__row--head', attr: { role: 'row' } });
		for (const c of ['Project', 'Type', 'Status', 'Progress', 'Deadline', 'World', 'Edited', '']) hr.createSpan({ cls: 'ws-wr-table__cell', text: c, attr: { role: 'columnheader' } });
		for (const r of rows) {
			const p = r.project;
			const scenes = st.w.scenes(p.id);
			const row = tbl.createDiv({ cls: cx('ws-wr-table__row', p.archivedAt !== null && 'is-archived'), attr: { role: 'row', tabindex: '0', 'data-project': p.id } });
			const c1 = row.createDiv({ cls: 'ws-wr-table__cell ws-wr-table__proj', attr: { role: 'cell' } });
			cover(c1, p, 'mini');
			const t = c1.createDiv();
			t.createDiv({ cls: 'ws-wr-table__title', text: p.name });
			t.createDiv({ cls: 'ws-wr-muted', text: p.series || [kindLabel(p.kind), count(scenes.length, 'scene')].join(' · ') });
			row.createSpan({ cls: 'ws-wr-table__cell', text: kindLabel(p.kind), attr: { role: 'cell', 'data-label': 'Kind' } });
			statusPill(row.createSpan({ cls: 'ws-wr-table__cell', attr: { role: 'cell', 'data-label': 'Status' } }), projectStatus(p, scenes));
			const pc = row.createDiv({ cls: 'ws-wr-table__cell ws-wr-table__prog', attr: { role: 'cell', 'data-label': 'Progress' } });
			if (p.wordTarget) bar(pc, r.words / p.wordTarget);
			pc.createSpan({ cls: 'ws-wr-muted', text: p.wordTarget ? `${wordsText(st, p)} / ${fmt(p.wordTarget)}` : `${wordsText(st, p)} words` });
			// 0.28: when it's due, and which world it belongs to.
			const done = p.wordTarget && r.words >= p.wordTarget;
			row.createSpan({ cls: 'ws-wr-table__cell ws-wr-table__deadline', text: done ? 'Done' : p.deadline ? shortDay(p.deadline) : '—', attr: { role: 'cell', 'data-label': 'Deadline' } });
			row.createSpan({ cls: 'ws-wr-table__cell ws-wr-muted', text: st.s.world.name, attr: { role: 'cell', 'data-label': 'World' } });
			row.createSpan({ cls: 'ws-wr-table__cell ws-wr-muted', text: relativeTime(r.edited), attr: { role: 'cell', 'data-label': 'Edited' } });
			const more = row.createDiv({ cls: 'ws-wr-table__cell ws-wr-table__more', attr: { role: 'cell' } });
			button(more, {
				icon: 'more-horizontal',
				variant: 'quiet',
				size: 'sm',
				tooltip: 'Project menu',
				cls: 'ws-wr-rowmenu',
				onClick: (evt) => {
					evt.stopPropagation();
					projectMenu(st, p).showAtMouseEvent(evt);
				},
			});
			const open = (evt: MouseEvent | KeyboardEvent) => st.go({ project: p.id, view: 'overview' }, evt.metaKey || evt.ctrlKey ? 'tab' : false);
			row.addEventListener('click', open);
			row.addEventListener('keydown', (e) => e.key === 'Enter' && e.target === row && open(e));
			row.addEventListener('contextmenu', (e) => {
				e.preventDefault();
				projectMenu(st, p).showAtMouseEvent(e);
			});
		}
	}
	hint(wrap, 'Each project is a folder of ordinary Markdown notes in your vault. Worldsmith keeps the order, the chapters and the statuses, and never changes the notes.');
}

// ── overview ─────────────────────────────────────────────────────────────────

export function renderOverview(st: Studio, el: HTMLElement): void {
	const p = st.project!;
	const wrap = el.createDiv({ cls: 'ws-wr-overview' });
	if (p.archivedAt !== null) archivedBanner(st, wrap, p);
	const scenes = st.w.scenes(p.id);
	const m = binderModel(st.w.tree(p.id));
	const hero = wrap.createDiv({ cls: 'ws-wr-ovhero' });
	cover(hero, p, 'hero');
	const t = hero.createDiv({ cls: 'ws-wr-ovhero__text' });
	caps(t, [kindLabel(p.kind), p.genre, p.series].filter(Boolean).join(' · '), 'ws-wr-ovhero__kind');
	t.createEl('h1', { cls: 'ws-wr-ovhero__title', text: p.name });
	if (p.tagline) t.createEl('p', { cls: 'ws-wr-ovhero__tagline', text: `“${p.tagline.replace(/^[“"]|[”"]$/g, '')}”` });
	else if (p.description) t.createEl('p', { cls: 'ws-wr-ovhero__desc', text: p.description });
	const nums = t.createDiv({ cls: 'ws-wr-ovnums' });
	const num = (n: string, l: string) => {
		const c = nums.createDiv({ cls: 'ws-wr-ovnums__item' });
		c.createDiv({ cls: 'ws-wr-ovnums__n', text: n });
		c.createDiv({ cls: 'ws-wr-ovnums__l', text: l });
	};
	const warm = st.w.words.isWarm(p.id);
	const words = st.w.wordCount(p.id);
	num(warm ? fmt(words) : '…', 'words');
	num(fmt(m.chapterNo.size), m.chapterNo.size === 1 ? 'chapter' : 'chapters');
	num(fmt(scenes.length), scenes.length === 1 ? 'scene' : 'scenes');
	if (p.wordTarget) num(warm ? `${Math.round((words / p.wordTarget) * 100)}%` : '…', `of ${fmt(p.wordTarget)}`);
	const finish = projectedFinish(words, p.wordTarget, p.days ?? {}, dayKey());
	if (finish || p.deadline) num(shortDay(finish ?? p.deadline!), finish ? 'estimated finish' : 'finish by');
	const tools = hero.createDiv({ cls: 'ws-wr-ovhero__tools' });
	const last = recentScene(st);
	button(tools, { label: 'Continue writing', icon: 'feather', variant: 'primary', size: 'sm', cls: 'ws-wr-ov-continue', onClick: () => (last && last.project.id === p.id ? continueWriting(st, p.id, last.scene.id) : st.go({ project: p.id, view: 'manuscript' })) });
	button(tools, { icon: 'more-horizontal', variant: 'quiet', size: 'sm', tooltip: 'Project menu', cls: 'ws-wr-projmenu', onClick: (evt) => projectMenu(st, p, { inProject: true }).showAtMouseEvent(evt) });
	wrap.createDiv({ cls: 'ws-wr-ovrule', attr: { 'aria-hidden': 'true' } });

	const split = wrap.createDiv({ cls: 'ws-wr-ovsplit' });
	contents(st, split, p, m);
	const side = split.createDiv({ cls: 'ws-wr-ovside' });
	const prog = panel(side, 'Draft progress', 'ws-wr-progress');
	if (!scenes.length) prog.createDiv({ cls: 'ws-wr-muted', text: 'No scenes yet.' });
	else {
		const stack = prog.createDiv({ cls: 'ws-wr-stack', attr: { role: 'img', 'aria-label': p.statuses.map((s) => `${s.label}: ${scenes.filter((x) => x.status === s.id).length}`).join(', ') } });
		const counts = p.statuses.map((s) => ({ s, n: scenes.filter((x) => x.status === s.id).length }));
		const other = scenes.filter((x) => !p.statuses.some((s) => s.id === x.status)).length;
		for (const { s, n } of counts) if (n) stack.createDiv({ cls: `ws-wr-stack__seg ws-tint--${s.color}` }).style.flex = String(n);
		if (other) stack.createDiv({ cls: 'ws-wr-stack__seg ws-tint--gray' }).style.flex = String(other);
		const leg = prog.createDiv({ cls: 'ws-wr-legend' });
		for (const { s, n } of counts) {
			const l = leg.createDiv({ cls: 'ws-wr-legend__item' });
			dot(l, s);
			l.createSpan({ text: s.label });
			l.createSpan({ cls: 'ws-wr-muted', text: String(n) });
		}
		const done = counts.filter((c) => c.s.done).reduce((a, c) => a + c.n, 0);
		prog.createDiv({ cls: 'ws-wr-progress__sum', text: `${fmt(done)} of ${count(scenes.length, 'scene')} complete.` });
	}
	// Plot threads: a coloured chip, what kind of thread, how many scenes.
	if (p.threads.length) {
		const pt = panel(side, 'Plot threads', 'ws-wr-ovthreads');
		for (const th of p.threads) {
			const r = pt.createDiv({ cls: 'ws-wr-ovthread' });
			r.createSpan({ cls: cx('ws-wr-ovthread__chip', `ws-tint--${th.color ?? 'gray'}`), text: th.label });
			const n = scenes.filter((x) => x.threads.includes(th.id)).length;
			r.createSpan({ cls: 'ws-wr-muted ws-wr-ovthread__n', text: [th.description && th.description.length <= 24 ? th.description : '', count(n, 'scene')].filter(Boolean).join(' · ') });
		}
	}
	// Main cast: the people of the book's scenes, most present first.
	const people = arcPeople(scenes).map((x) => st.s.entities.get(x.id)).filter((e): e is NonNullable<typeof e> => !!e && !e.trashedAt).slice(0, 8);
	if (people.length) {
		const mc = panel(side, 'Main cast', 'ws-wr-ovcast');
		const row = mc.createDiv({ cls: 'ws-wr-ovcast__row' });
		for (const e of people) {
			const b = row.createEl('button', { cls: 'ws-wr-ovcast__who', attr: { type: 'button', title: `Open ${e.name}` } });
			avatar(b, st.ws.app, e, st.s.schemas.get(e.typeId), { shape: 'arch', size: 'md' });
			b.createSpan({ cls: 'ws-wr-ovcast__name', text: e.name.split(' ')[0] ?? e.name });
			b.addEventListener('click', () => void st.ws.open({ name: 'entity', params: { id: e.id } }, { newLeaf: 'tab' }));
		}
	}
	// Notes behind the scenes: only when something needs fixing.
	const missing = st.w.missingNotes(p.id);
	const without = scenes.filter((s) => !s.notePath).length;
	const trashedN = st.w.trashed(p.id).length;
	if (!missing.length && !without && !trashedN) return;
	const notes = panel(side, 'Notes in your vault', 'ws-wr-notes');
	const linked = scenes.length - without - missing.length;
	const line = (ic: string, text: string, cls?: string) => {
		const r = notes.createDiv({ cls: cx('ws-wr-noteline', cls) });
		icon(r, ic);
		r.createSpan({ text });
		return r;
	};
	line('folder', p.folder || 'Top of the vault');
	line('file-check', `${count(linked, 'scene')} with ${linked === 1 ? 'its' : 'their'} note`);
	if (without) line('file-question', `${count(without, 'scene')} without a note yet`);
	if (missing.length) {
		const r = line('alert-triangle', `${count(missing.length, 'note')} not found (renamed or moved while Obsidian was closed?)`, 'is-warn');
		button(r, {
			label: 'Find them again',
			variant: 'ghost',
			size: 'sm',
			onClick: () => {
				const rep = st.w.rematchAll(p.id);
				const left = rep.ambiguous.length + rep.notFound.length;
				const first = rep.ambiguous[0] ?? rep.notFound[0];
				if (rep.fixed.length) new Notice(`Found ${count(rep.fixed.length, 'note')} again in the project folder.`);
				if (left && first) {
					const sc = st.w.item(first);
					if (sc) findAgain(st, sc);
				}
			},
		});
	}
	const trashed = st.w.trashed(p.id).length;
	if (trashed) {
		const r = line('trash', `${count(trashed, 'item')} in the studio’s trash`);
		button(r, { label: 'Open', variant: 'ghost', size: 'sm', onClick: () => st.go({ project: p.id, view: 'trash' }) });
	}
}

function archivedBanner(st: Studio, parent: HTMLElement, p: WritingProject): void {
	const b = hint(parent, 'This project is archived: it is hidden from the studio home. Nothing in it changed.', 'archive', 'ws-wr-hint--warn');
	button(b, { label: 'Unarchive', variant: 'ghost', size: 'sm', onClick: () => toggleArchive(st, p) });
}

/** The Atelier "Contents" page: parts, numbered chapters with a dotted leader, scenes with status and words. */
function contents(st: Studio, parent: HTMLElement, p: WritingProject, m: ReturnType<typeof binderModel>): void {
	const toc = parent.createDiv({ cls: 'ws-wr-paper ws-wr-toc' });
	caps(toc, 'Contents', 'ws-wr-toc__head');
	ornament(toc);
	const tree = st.w.tree(p.id);
	if (!tree.length) {
		toc.createEl('p', { cls: 'ws-wr-toc__empty', text: 'Nothing here yet. Add a chapter or a scene in the manuscript, or import a folder of notes.' });
		const row = toc.createDiv({ cls: 'ws-wr-toc__actions' });
		button(row, { label: 'Open manuscript', icon: 'feather', variant: 'primary', size: 'sm', onClick: () => st.go({ project: p.id, view: 'manuscript' }) });
		button(row, { label: 'Import notes', icon: 'file-input', variant: 'ghost', size: 'sm', onClick: () => importFolder(st, p.id) });
		return;
	}
	const open = (id: string) => st.go({ project: p.id, view: 'manuscript', item: id });
	const sceneRow = (s: ManuscriptItem, nested: boolean) => {
		const r = toc.createEl('button', { cls: cx('ws-wr-toc__scene', nested && 'is-nested'), attr: { type: 'button', 'data-id': s.id } });
		dot(r, statusOf(p, s.status));
		r.createSpan({ cls: 'ws-wr-toc__stitle', text: s.title });
		const pov = s.pov ? st.s.entities.get(s.pov) : undefined;
		r.createSpan({ cls: 'ws-wr-toc__pov', text: pov && !pov.trashedAt ? (pov.name.split(' ')[0] ?? pov.name) : '' });
		const n = st.w.words.words(s.notePath);
		r.createSpan({ cls: 'ws-wr-toc__words', text: n ? fmt(n) : '—' });
		r.addEventListener('click', () => open(s.id));
	};
	const walk = (nodes: ReturnType<typeof st.w.tree>) => {
		for (const n of nodes) {
			const it = n.item;
			if (it.kind === 'part') {
				const r = toc.createEl('button', { cls: 'ws-wr-toc__part', text: it.title, attr: { type: 'button', 'data-id': it.id } });
				r.addEventListener('click', () => open(it.id));
				walk(n.children);
			} else if (it.kind === 'chapter') {
				const r = toc.createEl('button', { cls: 'ws-wr-toc__row', attr: { type: 'button', 'data-id': it.id } });
				r.createSpan({ cls: 'ws-wr-toc__num', text: String(m.chapterNo.get(it.id) ?? '') });
				r.createSpan({ cls: 'ws-wr-toc__title', text: it.title });
				r.createSpan({ cls: 'ws-wr-toc__dots', attr: { 'aria-hidden': 'true' } });
				const dots = r.createSpan({ cls: 'ws-wr-toc__status' });
				const kids = n.children.filter((c) => c.item.kind === 'scene').map((c) => c.item);
				for (const s of kids.slice(0, 12)) dot(dots, statusOf(p, s.status));
				r.createSpan({ cls: 'ws-wr-toc__words', text: fmt(st.w.wordCount(it.id)) });
				r.addEventListener('click', () => open(it.id));
				for (const c of kids) sceneRow(c, true);
			} else sceneRow(it, false);
		}
	};
	walk(tree);
}

// ── trash ────────────────────────────────────────────────────────────────────

export function renderTrash(st: Studio, el: HTMLElement): void {
	const p = st.project!;
	const wrap = el.createDiv({ cls: 'ws-wr-trash' });
	const tools = head(wrap, { eyebrow: p.name, title: 'Trash', sub: 'Parts, chapters and scenes taken out of the manuscript. Their notes are still in your vault.' });
	button(tools, { label: 'Back to the manuscript', icon: 'arrow-left', variant: 'ghost', size: 'sm', onClick: () => st.go({ project: p.id, view: 'manuscript' }) });
	const items = st.w.trashed(p.id);
	if (!items.length) {
		wrap.createDiv({ cls: 'ws-wr-none', text: 'The trash is empty.' });
		return;
	}
	const list = wrap.createDiv({ cls: 'ws-wr-trashlist' });
	for (const it of items) {
		const row = list.createDiv({ cls: 'ws-wr-trashrow', attr: { 'data-id': it.id } });
		icon(row, KIND_ICON[it.kind], 'ws-wr-trashrow__icon');
		const t = row.createDiv({ cls: 'ws-wr-trashrow__text' });
		t.createDiv({ cls: 'ws-wr-trashrow__title', text: it.title });
		const merged = (it as ManuscriptItem & { mergedInto?: string }).mergedInto;
		const into = merged ? st.w.item(merged) : undefined;
		const parent = it.parentId ? st.w.item(it.parentId) : undefined;
		const bits = [itemWord(it.kind), into ? `merged into “${into.title}”` : parent ? `was in “${parent.title}”` : '', it.trashedAt ? `removed ${relativeTime(it.trashedAt)}` : '', it.notePath ? `note: ${it.notePath}` : ''].filter(Boolean);
		t.createDiv({ cls: 'ws-wr-muted', text: bits.join(' · ') });
		const restore = button(row, {
			label: 'Restore',
			icon: 'undo-2',
			variant: 'ghost',
			size: 'sm',
			cls: 'ws-wr-restore',
			onClick: () => {
				try {
					const r = st.w.restore(it.id);
					const msg = r.unlinked.length ? ` Another scene uses its note now, so it came back without one.` : '';
					new Notice(`Restored “${it.title}”.${msg}`);
				} catch (e) {
					new Notice(e instanceof Error ? e.message : String(e));
				}
			},
		});
		setTooltip(restore, 'Put it back where it was', { delay: 400 });
	}
}

