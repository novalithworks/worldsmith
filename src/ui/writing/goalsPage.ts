import { Menu } from 'obsidian';
import type { WritingProject } from '../../core/types';
import { addDays, dayKey, lastDays, neededPerDay, projectedFinish, streaks } from '../../services/writing/progress';
import { button, cx, icon } from '../components/dom';
import { ProjectDetailsModal } from './dialogs';
import { fmt, head, panel, type Studio } from './kit';
import { startSprint } from './sprint';

/**
 * Goals (0.28): rings for today, the week, the month, the streak and the book; the week's
 * words against the goal; when the book will be finished; an activity grid; recent sessions.
 * One book (a project's Goals tab) or every book together (the studio's Goals & stats).
 */

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function niceDay(key: string, year = true): string {
	const [y, m, d] = key.split('-').map(Number) as [number, number, number];
	return new Date(y, m - 1, d).toLocaleDateString(undefined, { day: 'numeric', month: 'long', ...(year ? { year: 'numeric' } : {}) });
}

function ring(parent: HTMLElement, ratio: number): void {
	const r = Math.max(0, Math.min(1, ratio));
	const NS = 'http://www.w3.org/2000/svg';
	const svg = parent.ownerDocument.createElementNS(NS, 'svg');
	svg.setAttribute('viewBox', '0 0 36 36');
	svg.setAttribute('class', 'ws-wr-ring ws-wr-minring');
	svg.setAttribute('aria-hidden', 'true');
	const C = 2 * Math.PI * 14;
	for (const [cls, dash] of [['ws-wr-ring__track', `${C} ${C}`], ['ws-wr-ring__fill', `${C * r} ${C}`]] as const) {
		const c = parent.ownerDocument.createElementNS(NS, 'circle');
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

export function renderGoals(st: Studio, el: HTMLElement, book: WritingProject | null): void {
	const books = book ? [book] : st.w.projects();
	const wrap = el.createDiv({ cls: 'ws-wr-goalspage' });
	const tools = head(wrap, { eyebrow: book ? 'Goals' : 'Goals & stats', title: 'Writing goals and progress', sub: 'Counted on this device from your own notes. Nothing leaves your vault.' });
	const sprintBook = book ?? books[0];
	if (sprintBook)
		button(tools, {
			label: 'Start a session',
			icon: 'timer',
			variant: 'primary',
			size: 'sm',
			cls: 'ws-wr-goals-session',
			onClick: (e) => {
				const m = new Menu();
				for (const min of [15, 25, 45]) m.addItem((i) => i.setTitle(`${min}-minute sprint`).setIcon('timer').onClick(() => startSprint(st.w, sprintBook.id, min)));
				m.showAtMouseEvent(e);
			},
		});
	if (book) button(tools, { label: 'Edit goals', icon: 'target', variant: 'ghost', size: 'sm', cls: 'ws-wr-goals-edit', onClick: () => new ProjectDetailsModal(st, book).open() });
	if (!books.length) {
		wrap.createDiv({ cls: 'ws-wr-muted', text: 'No projects yet.' });
		return;
	}

	const today = dayKey();
	const days: Record<string, number> = {};
	for (const b of books) for (const [k, n] of Object.entries(b.days ?? {})) days[k] = (days[k] ?? 0) + n;
	const todayWords = books.reduce((n, b) => n + st.w.wordsToday(b.id), 0);
	days[today] = todayWords;
	const daily = books.reduce((n, b) => n + (b.dailyGoal ?? 0), 0) || null;
	const weekly = books.reduce((n, b) => n + (b.weeklyGoal ?? (b.dailyGoal ? b.dailyGoal * 7 : 0)), 0) || null;
	const monthly = books.reduce((n, b) => n + (b.monthlyGoal ?? (b.dailyGoal ? b.dailyGoal * 30 : 0)), 0) || null;
	// This week runs Monday to today.
	const dow = (new Date().getDay() + 6) % 7;
	const weekStart = addDays(today, -dow);
	const week = lastDays(days, today, dow + 1).reduce((n, d) => n + d.words, 0);
	const monthWords = Object.entries(days).reduce((n, [k, v]) => (k.startsWith(today.slice(0, 8)) ? n + v : n), 0);
	const sk = streaks(days, daily, today);
	const words = books.reduce((n, b) => n + st.w.wordCount(b.id), 0);
	const target = books.reduce((n, b) => n + (b.wordTarget ?? 0), 0) || null;

	const rings = wrap.createDiv({ cls: 'ws-wr-grings' });
	const tile = (ratio: number | null, n: string, label: string, deco?: (t: HTMLElement) => void) => {
		const t = rings.createDiv({ cls: 'ws-wr-gring' });
		if (deco) deco(t);
		else ring(t, ratio ?? 0);
		const tx = t.createDiv();
		tx.createDiv({ cls: 'ws-wr-gring__n', text: n });
		tx.createDiv({ cls: 'ws-wr-gring__l', text: label });
	};
	tile(daily ? todayWords / daily : 0, fmt(Math.max(0, todayWords)), daily ? `today · goal ${fmt(daily)}` : 'today');
	tile(weekly ? week / weekly : 0, fmt(week), weekly ? `this week · goal ${fmt(weekly)}` : 'this week');
	const monthName = new Date().toLocaleDateString(undefined, { month: 'long' });
	tile(monthly ? monthWords / monthly : 0, fmt(monthWords), monthly ? `${monthName} · goal ${fmt(monthly)}` : monthName);
	tile(null, `${sk.current} day${sk.current === 1 ? '' : 's'}`, `current streak · best ${sk.best}`, (t) => icon(t, 'flame', sk.current > 0 ? 'ws-wr-gring__flame is-lit' : 'ws-wr-gring__flame'));
	tile(target ? words / target : 0, fmt(words), book ? `${book.name}${target ? ` · ${Math.round((words / target) * 100)}%` : ''}` : `all books${target ? ` · ${Math.round((words / target) * 100)}%` : ''}`);

	const grid = wrap.createDiv({ cls: 'ws-wr-ggrid' });
	// The week, Monday to Sunday, against the daily goal.
	const wk = panel(grid, 'Words this week', 'ws-wr-gweek');
	const chartDays = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
	const max = Math.max(daily ?? 0, ...chartDays.map((d) => days[d] ?? 0), 1);
	const chart = wk.createDiv({ cls: 'ws-wr-gchart', attr: { role: 'img', 'aria-label': `Words written each day this week${daily ? `, against a goal of ${daily}` : ''}` } });
	if (daily) {
		const g = chart.createDiv({ cls: 'ws-wr-gchart__goal', attr: { style: `bottom:calc(${Math.round((daily / max) * 100)}% * 0.82 + 22px)` } });
		g.createSpan({ text: `goal ${fmt(daily)}` });
	}
	for (const d of chartDays) {
		const col = chart.createDiv({ cls: cx('ws-wr-gchart__col', d === today && 'is-today', d > today && 'is-future') });
		const v = Math.max(0, days[d] ?? 0);
		const barEl = col.createDiv({ cls: cx('ws-wr-gchart__bar', daily !== null && v >= daily && 'is-met'), attr: { title: `${niceDay(d, false)}: ${fmt(v)} words` } });
		barEl.style.height = `${v ? Math.max(3, Math.round((v / max) * 82)) : 0}%`;
		const [y, m, dd] = d.split('-').map(Number) as [number, number, number];
		col.createDiv({ cls: 'ws-wr-gchart__day', text: d === today ? 'Today' : DAY_NAMES[new Date(y, m - 1, dd).getDay()]! });
	}

	// When will it be finished?
	const fin = panel(grid, 'When will it be finished?', 'ws-wr-gfinish');
	const pace = lastDays(days, today, 30).reduce((n, d) => n + d.words, 0) / 30;
	const deadline = book?.deadline ?? null;
	const finish = target ? projectedFinish(words, target, days, today) : null;
	if (!target) fin.createDiv({ cls: 'ws-wr-muted', text: 'Give the book a word goal (in Edit goals) to see when it will be finished.' });
	else {
		fin.createDiv({ cls: 'ws-wr-gfinish__date', text: words >= target ? 'Finished' : finish ? niceDay(finish) : 'Not yet known' });
		const weeks = finish ? Math.max(1, Math.round((new Date(finish).getTime() - Date.now()) / (7 * 86_400_000))) : null;
		fin.createDiv({
			cls: 'ws-wr-gfinish__text',
			text:
				words >= target
					? `${fmt(words)} of ${fmt(target)} words.`
					: pace > 0
						? `At your last 30 days’ pace (${fmt(Math.round(pace))} words a day), ${book ? book.name : 'your books'} reach${book ? 'es' : ''} ${fmt(target)} words${weeks ? ` in ${weeks} week${weeks === 1 ? '' : 's'}` : ''}.${deadline ? ` Your deadline is ${niceDay(deadline, false)}.` : ''}`
						: 'Write a little each day and an estimate appears here.',
		});
		// With a finish date: what each day needs (WS6).
		const need = deadline ? neededPerDay(words, target, deadline, today) : null;
		if (need !== null) fin.createDiv({ cls: 'ws-wr-gfinish__need', text: need === 0 ? 'The word goal is reached.' : `To finish by ${niceDay(deadline!, false)}: ${fmt(need)} words a day.` });
		const b = fin.createDiv({ cls: 'ws-wr-bar ws-wr-gfinish__bar' });
		b.createDiv().style.width = `${Math.min(100, Math.round((words / target) * 100))}%`;
	}

	// Writing activity: the last 26 weeks, a square a day.
	const act = panel(grid, 'Writing activity', 'ws-wr-gactivity');
	const heat = act.createDiv({ cls: 'ws-wr-heat', attr: { role: 'img', 'aria-label': `${Object.values(days).filter((v) => v > 0).length} days with writing` } });
	const start = addDays(weekStart, -25 * 7);
	const top = Math.max(1, ...Object.values(days));
	for (let w = 0; w < 26; w++) {
		const col = heat.createDiv({ cls: 'ws-wr-heat__week' });
		for (let d = 0; d < 7; d++) {
			const k = addDays(start, w * 7 + d);
			const v = k > today ? -1 : Math.max(0, days[k] ?? 0);
			const lvl = v < 0 ? 'is-future' : v === 0 ? 'is-0' : `is-${Math.min(4, 1 + Math.floor((v / top) * 4))}`;
			col.createDiv({ cls: cx('ws-wr-heat__day', lvl), attr: v >= 0 ? { title: `${niceDay(k, false)}: ${fmt(v)} words` } : {} });
		}
	}

	// Recent sessions, newest first.
	const ses = panel(grid, 'Recent sessions', 'ws-wr-gsessions');
	// Sessions and sprints, newest first (a sprint is a timed session).
	const all = [
		...books.flatMap((b) => (b.sessions ?? []).map((s) => ({ ...s, book: b, sprint: false }))),
		...books.flatMap((b) => (b.sprints ?? []).map((s) => ({ start: s.start, end: s.start + s.minutes * 60_000, words: s.words, sceneId: null as string | null, book: b, sprint: true }))),
	]
		.sort((a, b) => b.start - a.start)
		.slice(0, 8);
	if (!all.length) ses.createDiv({ cls: 'ws-wr-muted', text: 'Sessions are recorded as you write: each stretch of writing, with how long and how many words.' });
	const ul = ses.createDiv({ cls: 'ws-wr-gsess-list' });
	for (const s of all) {
		const r = ul.createDiv({ cls: 'ws-wr-gsess' });
		const d = new Date(s.start);
		const isToday = dayKey(s.start) === today;
		r.createSpan({ cls: 'ws-wr-gsess__when', text: `${isToday ? 'Today' : d.toLocaleDateString(undefined, { weekday: 'short' })} ${d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}` });
		r.createSpan({ cls: 'ws-wr-gsess__min', text: `${Math.max(1, Math.round((s.end - s.start) / 60_000))} min` });
		r.createSpan({ cls: cx('ws-wr-gsess__words', s.words < 0 && 'is-cut'), text: `${s.words >= 0 ? '+' : ''}${fmt(s.words)}` });
		const scene = s.sceneId ? st.w.item(s.sceneId) : null;
		r.createSpan({ cls: 'ws-wr-gsess__scene', text: s.sprint ? `Sprint${book ? '' : ` · ${s.book.name}`}` : (scene?.title ?? (book ? '' : s.book.name)) });
	}
}
