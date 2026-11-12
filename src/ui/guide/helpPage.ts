import type { RouteDefinition } from '../views/routes/RouteRegistry';
import type { Route } from '../../state/route';
import { ROUTES } from '../../state/route';
import { button, icon } from '../components/dom';
import { guideOn, setGuide } from './guide';

/**
 * Help (0.21): how Worldsmith works, in short sections, offline. Each section has buttons to the
 * real feature. Opens without a world (from the welcome screen) and brings the getting-started
 * guide back.
 */

interface Topic {
	id: string;
	icon: string;
	title: string;
	paras: string[];
	links?: Array<{ label: string; route: Route; needsWorld?: boolean }>;
}

const TERMS: Array<[string, string]> = [
	['World', 'Everything for one setting or story: its entries, types, maps, timeline and writing. You can have several worlds and switch between them from the top of the sidebar.'],
	['Entry', 'One character, place, faction, event… Its page holds fields you fill in, connections, pictures and tasks. Entries live in Worldsmith’s own files.'],
	['Type', 'A kind of entry (Character, Location…) and the fields it has. Worldsmith comes with 17; change them or add your own in Type Studio.'],
	['Native note', 'An ordinary Obsidian note that belongs to an entry and stays in step with it. Press Note on an entry to make one.'],
	['Adopted note', 'A note you already had, turned into an entry. Worldsmith links to it where it is and never writes into it.'],
	['Properties', 'The fields at the top of a note in Obsidian. In a native note, an entry’s short fields (age, status…) are Properties: change one in either place and the other follows.'],
	['Freeform writing', 'Everything you write in the body of a note. In a native note, long fields (biography…) are sections you can edit in either place; anything else you write is yours alone.'],
	['Connection', 'A link between two entries with a meaning (mentor, homeland, rival), shown on both pages and in the graph and family trees.'],
	['Wikilink', 'An ordinary [[link]] in a note. It stays a normal Obsidian link; Worldsmith doesn’t turn it into a connection by itself.'],
];

const TOPICS: Topic[] = [
	{
		id: 'start',
		icon: 'sparkles',
		title: 'Creating a world and entries',
		paras: [
			'Create a world from the welcome screen, or with New world… in the world menu (click the world’s name at the top of the sidebar). It starts with ready-made types.',
			'Create an entry with the + button at the top of the sidebar, or New … on a type’s page. Fill in its fields right on its page; everything saves as you go.',
		],
		links: [{ label: 'Open Home', route: ROUTES.dashboard(), needsWorld: true }],
	},
	{
		id: 'notes',
		icon: 'file-text',
		title: 'Your notes and Worldsmith',
		paras: [
			'Native note: on an entry’s page press Note. The note’s Properties and sections stay in step with the entry, both ways; write anything else freely. With Worldsmith off, it’s still an ordinary note.',
			'Notes you already have: drag them from Obsidian’s file explorer onto a type’s page (a whole folder works too), or use the Add existing note button there. Each becomes an entry, and the note isn’t moved or changed. Every entry with a note has a Page | Note switch.',
			'From a note to its entry: the command “Open this note’s entry in Worldsmith”, or the file menu (… on a note’s tab).',
		],
	},
	{
		id: 'connections',
		icon: 'waypoints',
		title: 'Connections',
		paras: [
			'On an entry’s page, use the Connections panel to link it to another entry and choose what the link means. It shows on both entries.',
			'Relationships lists the kinds of connection; add your own there (e.g. “sworn enemy of”). The graph and family trees draw connections for you.',
		],
		links: [
			{ label: 'Relationships', route: ROUTES.relationships(), needsWorld: true },
			{ label: 'Graph', route: ROUTES.graph(), needsWorld: true },
		],
	},
	{
		id: 'customize',
		icon: 'paintbrush',
		title: 'Customizing types, pages and dashboards',
		paras: [
			'Type Studio: what a type holds — fields, sections, choices, icons and colours.',
			'Layout Studio: how a type’s pages look — move, resize and add widgets. Any entry can also have a layout of its own (Customize on its page).',
			'Dashboards: Home and any dashboards you add are made of widgets; press Customize to arrange them.',
		],
		links: [
			{ label: 'Type Studio', route: ROUTES.typeStudio(), needsWorld: true },
			{ label: 'Layout Studio', route: ROUTES.layoutStudio(), needsWorld: true },
		],
	},
	{
		id: 'visual',
		icon: 'map',
		title: 'Maps, timelines and calendars',
		paras: [
			'Maps: add a map with its own picture, then pin entries on it. Pins can open nested maps (a city inside a kingdom).',
			'Calendars: set up your world’s own months, weeks and eras. Timeline: events and dated entries in order, in that calendar.',
		],
		links: [
			{ label: 'Maps', route: ROUTES.maps(), needsWorld: true },
			{ label: 'Timeline', route: ROUTES.timeline(), needsWorld: true },
			{ label: 'Calendars', route: ROUTES.calendars(), needsWorld: true },
		],
	},
	{
		id: 'writing',
		icon: 'feather',
		title: 'The Writing Studio',
		paras: [
			'Start a project, add parts, chapters and scenes, and write each scene in its own note (Manuscript). The Story board shows scenes as cards, an outline, a status board, a timeline or a table; the Plot tab holds plot threads and story structures.',
			'Who and where: in a scene’s inspector, choose its point of view, who’s in it and where it happens from your world (names found in the text are suggested). Boards can show one character’s scenes; an entry’s page lists the scenes it appears in; dated scenes appear on the Timeline. The Arcs tab follows one character through the book.',
			'Progress: set a daily goal and a finish date in the project’s details. The Overview shows today’s words, your streak, the last 30 days and what’s needed each day; the manuscript has a today counter and timed sprints.',
			'Revising: snapshots keep copies of a scene (one is taken automatically each day you open it); Compare shows what changed, and Restore goes back without losing your current text. Revision passes track one read-through at a time.',
			'Compile turns the whole book into Word, EPUB, Markdown, plain text or a web page, or prints it to PDF, with a title page, chapter headings and scene breaks.',
		],
		links: [{ label: 'Writing Studio', route: ROUTES.writing(), needsWorld: true }],
	},
	{
		id: 'move',
		icon: 'file-output',
		title: 'Moving a world: export and import',
		paras: [
			'Export makes one .worldsmith.zip with the world, its notes and images, checked after saving. You choose which of your own notes go along; every file is listed.',
			'Import it into any vault (from the welcome screen of an empty one). Nothing is written over: files with the same name are saved beside yours.',
		],
		links: [{ label: 'Import & export', route: { name: 'transfer', params: {} }, needsWorld: true }],
	},
	{
		id: 'features',
		icon: 'toggle-right',
		title: 'Choosing what your world uses',
		paras: ['Features (in Tools) switches whole parts of Worldsmith on or off for this world: the Writing Studio, maps, calendars, the timeline, family trees, the graph, tasks, dashboards and the media library. A part that’s off disappears from the sidebar, pages, commands and widgets; nothing is deleted, and turning it on brings everything back.'],
		links: [{ label: 'Features', route: ROUTES.features(), needsWorld: true }],
	},
	{
		id: 'backups',
		icon: 'life-buoy',
		title: 'Backups and restoring',
		paras: [
			'Worldsmith backs up the open world every hour (skipped when nothing changed), and you can make one any time. Every backup is checked.',
			'Restore one as a new world (safest), or replace the world with it after seeing what changes; a safety backup is made first. Deleted worlds can be put back from the world menu.',
		],
		links: [{ label: 'Backups & recovery', route: { name: 'backups', params: {} }, needsWorld: true }],
	},
	{
		id: 'trouble',
		icon: 'stethoscope',
		title: 'If something looks out of step',
		paras: [
			'A native note and its entry disagree: Worldsmith asks which to keep (the note’s Note button shows it). Nothing is overwritten without asking.',
			'Changes made on another device haven’t appeared: run “Reload world from disk” from the command palette.',
			'A note shows as missing: it was moved or deleted outside Obsidian. Its entry keeps the link; open the entry’s Note tab to find it again or choose another.',
			'World health lists missing images, broken links and other loose ends, with a fix for each.',
		],
		links: [{ label: 'World health', route: ROUTES.health(), needsWorld: true }],
	},
];

export const helpRoute: RouteDefinition = {
	id: 'help',
	needsWorld: false,
	title: () => 'Help',
	icon: () => 'circle-help',
	render(ctx) {
		const s = ctx.session;
		const page = ctx.el.createDiv({ cls: 'ws-page ws-page--help' });
		const head = page.createDiv({ cls: 'ws-studio-head' });
		icon(head.createDiv({ cls: 'ws-db-header__mark ws-tint--blue' }), 'circle-help');
		const ht = head.createDiv({ cls: 'ws-db-header__text' });
		ht.createEl('h1', { cls: 'ws-db-header__title', text: 'How Worldsmith works' });
		ht.createDiv({ cls: 'ws-db-header__desc', text: 'Short answers, and a button to each feature. Everything here works offline.' });

		if (s) {
			const g = page.createDiv({ cls: 'ws-help-guide' });
			const on = guideOn(ctx.ws, s.worldId);
			g.createDiv({ cls: 'ws-help-guide__text', text: on ? `The getting-started guide is on ${s.world.name}’s Home.` : `Want the seven first steps on ${s.world.name}’s Home? Nothing in your world changes.` });
			button(g, {
				label: on ? 'Open Home' : 'Show the getting-started guide',
				icon: on ? 'home' : 'list-checks',
				variant: on ? 'ghost' : 'primary',
				size: 'sm',
				cls: 'ws-help-guide__btn',
				onClick: () => void (async () => {
					if (!on) await setGuide(ctx.ws, s.worldId, true);
					ctx.navigate(ROUTES.dashboard());
				})(),
			});
		}

		const toc = page.createEl('nav', { cls: 'ws-help-toc', attr: { 'aria-label': 'Help topics' } });
		const terms = page.createEl('section', { cls: 'ws-help-sec', attr: { id: 'ws-help-terms' } });
		const tocLink = (id: string, text: string) => {
			const b = toc.createEl('button', { cls: 'ws-help-toc__link', text, attr: { type: 'button' } });
			b.addEventListener('click', () => page.querySelector(`#ws-help-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
		};
		tocLink('terms', 'The words Worldsmith uses');
		const th = terms.createDiv({ cls: 'ws-help-sec__head' });
		icon(th, 'book-open');
		th.createEl('h2', { text: 'The words Worldsmith uses' });
		const dl = terms.createEl('dl', { cls: 'ws-help-terms' });
		for (const [term, def] of TERMS) {
			dl.createEl('dt', { text: term });
			dl.createEl('dd', { text: def });
		}
		for (const t of TOPICS) {
			tocLink(t.id, t.title);
			const sec = page.createEl('section', { cls: 'ws-help-sec', attr: { id: `ws-help-${t.id}`, 'data-topic': t.id } });
			const h = sec.createDiv({ cls: 'ws-help-sec__head' });
			icon(h, t.icon);
			h.createEl('h2', { text: t.title });
			for (const p of t.paras) sec.createEl('p', { text: p });
			if (t.links?.length) {
				const a = sec.createDiv({ cls: 'ws-help-sec__links' });
				for (const l of t.links) {
					const b = button(a, { label: l.label, icon: 'arrow-right', variant: 'ghost', size: 'sm', onClick: () => ctx.navigate(l.route) });
					if (l.needsWorld && !s) {
						b.disabled = true;
						b.setAttr('title', 'Create or import a world first');
					}
				}
			}
		}
		if (!s) {
			const back = page.createDiv({ cls: 'ws-help-sec__links' });
			button(back, { label: 'Back to the welcome screen', icon: 'arrow-left', variant: 'primary', size: 'sm', onClick: () => ctx.navigate(ROUTES.onboarding()) });
		}
	},
};
