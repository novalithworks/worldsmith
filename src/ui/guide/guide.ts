import { EDITION } from '../../app/edition';
import { Notice } from 'obsidian';
import type { WorldsmithContext } from '../../app/context';
import type { WorldSession } from '../../services/WorldSession';
import type { Route } from '../../state/route';
import { ROUTES } from '../../state/route';
import { openCreateEntity } from '../actions';
import { button, cx, icon } from '../components/dom';

/**
 * Getting started (0.21): a quiet card on a new world's Home with seven optional first steps.
 * Each step ticks itself off from what's actually in the world (no progress to save or lose),
 * every button opens the real feature, steps can be done in any order, and the card can be
 * hidden at any time and brought back from Help. Existing worlds never get it unasked.
 */

export interface GuideStep {
	id: string;
	icon: string;
	title: string;
	body: string;
	done: boolean;
	actions: Array<{ label: string; run: () => void }>;
}

/** The steps for a world, ticked from its data. */
export function guideSteps(ws: WorldsmithContext, s: WorldSession, navigate: (r: Route) => void, backupsMade: boolean): GuideStep[] {
	const live = [...s.entities.values()].filter((e) => !e.trashedAt);
	const firstType = s.schemas.get('character') ? 'character' : (s.schemas.list()[0]?.id ?? null);
	const anyEntry = live[0];
	const withNote = live.some((e) => e.nativeNote || e.linkedNote);
	const adopted = live.some((e) => e.linkedNote && !e.nativeNote);
	const customized = s.stores.layouts.size > 0 || s.schemas.list().some((t) => (t.rev ?? 0) > 1);
	const creative = s.stores.maps.size > 0 || s.stores.writingProjects.size > 0 || s.stores.calendars.size > 1;
	const openFirst = () => (anyEntry ? navigate(ROUTES.entity(anyEntry.id)) : openCreateEntity(ws, { typeId: firstType }));
	return [
		{
			id: 'entry',
			icon: 'user-plus',
			title: 'Create your first entry',
			body: 'Characters, places, factions and more each have their own type. An entry is one of them, with fields you fill in on its page.',
			done: live.length > 0,
			actions: [
				{ label: firstType === 'character' ? 'New character' : 'New entry', run: () => openCreateEntity(ws, { typeId: firstType }) },
				...(s.schemas.get('location') ? [{ label: 'New location', run: () => openCreateEntity(ws, { typeId: 'location' }) }] : []),
			],
		},
		{
			id: 'connect',
			icon: 'waypoints',
			title: 'Connect two entries',
			body: 'Connections say how entries relate: a mentor, a homeland, a rival. Add one from an entry’s Connections panel; it shows on both pages.',
			done: s.stores.edges.size > 0,
			actions: [{ label: anyEntry ? 'Open an entry' : 'New entry', run: openFirst }],
		},
		{
			id: 'note',
			icon: 'file-text',
			title: 'Give an entry its own note',
			body: 'Press Note on an entry’s page. A native note is an ordinary Obsidian note that stays in step with the entry: its fields become Properties, and you write freely below.',
			done: withNote,
			actions: [{ label: anyEntry ? 'Open an entry' : 'New entry', run: openFirst }],
		},
		{
			id: 'adopt',
			icon: 'file-input',
			title: 'Bring in a note you already have',
			body: 'Drag notes from the file explorer onto a type’s page (or use Add existing note there). Each becomes an entry, and the note stays exactly as it is.',
			done: adopted,
			actions: firstType ? [{ label: `Open ${s.schemas.get(firstType)?.plural ?? 'entries'}`, run: () => navigate(ROUTES.database(firstType)) }] : [],
		},
		{
			id: 'customize',
			icon: 'paintbrush',
			title: 'Make it yours',
			body: 'Type Studio changes what a type holds (fields, sections, choices). Layout Studio changes how its pages look. Both are optional; the defaults work.',
			done: customized,
			actions: [
				{ label: 'Type Studio', run: () => navigate(ROUTES.typeStudio()) },
				{ label: 'Layout Studio', run: () => navigate(ROUTES.layoutStudio()) },
			],
		},
		// The creative tools come with Pro; the free edition's guide leaves this step out (0.30).
		...(EDITION === 'pro'
			? [
				{
					id: 'create',
					icon: 'map',
					title: 'Try a creative tool',
					body: 'Pin entries on a map, place events on a timeline with your own calendar, or plan and write your story in the Writing Studio.',
					done: creative,
					actions: [
						{ label: 'Maps', run: () => navigate(ROUTES.maps()) },
						{ label: 'Timeline', run: () => navigate(ROUTES.timeline()) },
						{ label: 'Writing Studio', run: () => navigate(ROUTES.writing()) },
					],
				},
				]
			: []),
		{
			id: 'safe',
			icon: 'life-buoy',
			title: 'Keep it safe',
			body: 'Worldsmith backs up your world every hour. Make one yourself any time, and export the world to move it to another vault.',
			done: backupsMade,
			actions: [
				{ label: 'Backups & recovery', run: () => navigate({ name: 'backups', params: {} }) },
				{ label: 'Import & export', run: () => navigate({ name: 'transfer', params: {} }) },
			],
		},
	];
}

export function guideOn(ws: WorldsmithContext, worldId: string): boolean {
	return ws.settings.guide.worlds.includes(worldId);
}

export async function setGuide(ws: WorldsmithContext, worldId: string, on: boolean): Promise<void> {
	const list = ws.settings.guide.worlds.filter((id) => id !== worldId);
	if (on) list.push(worldId);
	ws.settings.guide.worlds = list;
	await ws.saveSettings();
	ws.events.emit('guide:changed', { worldId, on });
}

/** The card on Home. Repaints itself when the world changes, so ticks appear as you go. */
export function renderGuide(parent: HTMLElement, ws: WorldsmithContext, s: WorldSession, navigate: (r: Route) => void, onHide: () => void, register: (fn: () => void) => void): HTMLElement {
	const card = parent.createEl('section', { cls: 'ws-guide' });
	let open = new Set<string>();
	const paint = async () => {
		const backups = await ws.backups.list(s.worldId).catch(() => []);
		const steps = guideSteps(ws, s, navigate, backups.length > 0);
		const done = steps.filter((x) => x.done).length;
		card.empty();
		const head = card.createDiv({ cls: 'ws-guide__head' });
		const t = head.createDiv({ cls: 'ws-guide__heading' });
		t.createDiv({ cls: 'ws-guide__title', text: done === steps.length ? 'You’ve tried everything' : 'Getting started' });
		t.createDiv({ cls: 'ws-guide__sub', text: done === steps.length ? 'Hide this guide whenever you like; Help has more.' : `${done} of ${steps.length} · in any order, all optional` });
		const bar = head.createDiv({ cls: 'ws-guide__bar', attr: { role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': String(steps.length), 'aria-valuenow': String(done), 'aria-label': 'Getting started progress' } });
		bar.createDiv({ cls: 'ws-guide__fill' }).style.width = `${Math.round((done / steps.length) * 100)}%`;
		button(head, { label: 'Help', icon: 'circle-help', variant: 'ghost', size: 'sm', cls: 'ws-guide__help', onClick: () => navigate({ name: 'help', params: {} }) });
		button(head, {
			icon: 'x',
			variant: 'quiet',
			size: 'sm',
			ariaLabel: 'Hide the getting-started guide',
			tooltip: 'Hide this guide (Help can bring it back)',
			cls: 'ws-guide__hide',
			onClick: () => void (async () => {
				await setGuide(ws, s.worldId, false);
				new Notice('Guide hidden. Open Help to bring it back.');
				onHide();
			})(),
		});
		// The first unfinished step starts open; any step opens on click.
		if (!open.size) {
			const first = steps.find((x) => !x.done);
			if (first) open = new Set([first.id]);
		}
		const list = card.createEl('ol', { cls: 'ws-guide__steps' });
		for (const st of steps) {
			const li = list.createEl('li', { cls: cx('ws-guide__step', st.done && 'is-done', open.has(st.id) && 'is-open'), attr: { 'data-step': st.id } });
			const row = li.createEl('button', { cls: 'ws-guide__row', attr: { type: 'button', 'aria-expanded': String(open.has(st.id)) } });
			const mark = row.createSpan({ cls: 'ws-guide__mark' });
			icon(mark, st.done ? 'check' : st.icon);
			row.createSpan({ cls: 'ws-guide__step-title', text: st.title });
			if (st.done) row.createSpan({ cls: 'ws-guide__done', text: 'Done' });
			row.addEventListener('click', () => {
				if (open.has(st.id)) open.delete(st.id);
				else open.add(st.id);
				void paint();
			});
			if (open.has(st.id)) {
				const body = li.createDiv({ cls: 'ws-guide__body' });
				body.createDiv({ cls: 'ws-guide__text', text: st.body });
				const a = body.createDiv({ cls: 'ws-guide__actions' });
				for (const act of st.actions) button(a, { label: act.label, variant: 'ghost', size: 'sm', onClick: act.run });
			}
		}
	};
	void paint();
	// Ticks follow the world: new entries, notes linked, connections, backups.
	let t: number | null = null;
	const later = () => {
		if (t !== null) window.clearTimeout(t);
		t = window.setTimeout(() => {
			t = null;
			if (card.isConnected) void paint();
		}, 250);
	};
	const subs = [s.events.on('entity:created', later), s.events.on('entity:deleted', later), s.events.on('entity:updated', later), s.events.on('edge:created', later), s.events.on('edge:deleted', later)];
	const offB = ws.backups.onChange(later);
	register(() => {
		subs.forEach((d) => d.dispose());
		offB();
		if (t !== null) window.clearTimeout(t);
	});
	return card;
}
