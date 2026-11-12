import { Menu } from 'obsidian';
import { dayKey, lastDays, neededPerDay, projectedFinish, streaks } from '../../services/writing/progress';
import { button, cx, icon } from '../components/dom';
import { caps, fmt, type Studio } from './kit';
import { onSprint, sprint, sprintWords, startSprint, stopSprint, timeLeft } from './sprint';

/**
 * WS6 (0.24): progress in the studio. The Overview's Progress section (today against the
 * daily goal, streaks, the last 30 days, what's needed for a deadline, a projected finish,
 * recent sprints) and the manuscript's compact "today" counter with the sprint button.
 */

function niceDay(key: string): string {
	const [y, m, d] = key.split('-').map(Number) as [number, number, number];
	return new Date(y, m - 1, d).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

/** A ring for today's words against the goal. */
function ring(parent: HTMLElement, ratio: number, label: string): void {
	const r = 26;
	const c = 2 * Math.PI * r;
	const el = parent.createDiv({ cls: 'ws-wr-pring', attr: { role: 'img', 'aria-label': label } });
	const NS = 'http://www.w3.org/2000/svg';
	const mk = (tag: string, attrs: Record<string, string>, host: Element) => {
		const n = el.ownerDocument.createElementNS(NS, tag);
		for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
		host.appendChild(n);
		return n;
	};
	const svg = mk('svg', { viewBox: '0 0 64 64', width: '64', height: '64' }, el);
	mk('circle', { cx: '32', cy: '32', r: String(r), class: 'ws-wr-pring__track' }, svg);
	const done = Math.max(0, Math.min(1, ratio));
	mk('circle', { cx: '32', cy: '32', r: String(r), class: cx('ws-wr-pring__fill', ratio >= 1 && 'is-met').join(' '), 'stroke-dasharray': `${c * done} ${c}`, transform: 'rotate(-90 32 32)' }, svg);
}

export function renderProgress(st: Studio, parent: HTMLElement, openDetails: () => void): void {
	const p = st.project!;
	const sec = parent.createEl('section', { cls: 'ws-wr-wprogress' });
	caps(sec, 'Progress', 'ws-wr-sheet__label');
	const today = dayKey();
	const days = { ...(p.days ?? {}) };
	const todayWords = st.w.wordsToday(p.id);
	days[today] = todayWords;
	const goal = p.dailyGoal ?? null;
	const sk = streaks(days, goal, today);
	const total = st.w.words.projectWords(p.id);
	const top = sec.createDiv({ cls: 'ws-wr-wprogress__top' });

	const t = top.createDiv({ cls: 'ws-wr-pstat ws-wr-pstat--today' });
	if (goal) ring(t, todayWords / goal, `${todayWords} of ${goal} words today`);
	const tt = t.createDiv();
	tt.createDiv({ cls: 'ws-wr-pstat__n', text: goal ? `${fmt(Math.max(0, todayWords))} / ${fmt(goal)}` : fmt(todayWords) });
	tt.createDiv({ cls: 'ws-wr-pstat__label', text: goal ? (todayWords >= goal ? 'today: goal met' : 'words today') : 'words today' });

	const s2 = top.createDiv({ cls: 'ws-wr-pstat' });
	const flame = icon(s2, 'flame', 'ws-wr-pstat__icon');
	if (sk.current > 0) flame.addClass('is-lit');
	const st2 = s2.createDiv();
	st2.createDiv({ cls: 'ws-wr-pstat__n ws-wr-streak', text: `${sk.current} day${sk.current === 1 ? '' : 's'}` });
	st2.createDiv({ cls: 'ws-wr-pstat__label', text: `streak · best ${sk.best}` });

	const week = lastDays(days, today, 7).reduce((n, d) => n + d.words, 0);
	const s3 = top.createDiv({ cls: 'ws-wr-pstat' });
	icon(s3, 'calendar-days', 'ws-wr-pstat__icon');
	const st3 = s3.createDiv();
	st3.createDiv({ cls: 'ws-wr-pstat__n', text: fmt(week) });
	st3.createDiv({ cls: 'ws-wr-pstat__label', text: 'this week' });

	const need = neededPerDay(total, p.wordTarget, p.deadline, today);
	const finish = projectedFinish(total, p.wordTarget, days, today);
	if (need !== null || finish) {
		const s4 = top.createDiv({ cls: 'ws-wr-pstat' });
		icon(s4, 'flag', 'ws-wr-pstat__icon');
		const st4 = s4.createDiv();
		if (need !== null) {
			st4.createDiv({ cls: 'ws-wr-pstat__n ws-wr-need', text: need === 0 ? 'Done' : `${fmt(need)} a day` });
			st4.createDiv({ cls: 'ws-wr-pstat__label', text: `to finish by ${niceDay(p.deadline!)}` });
		} else {
			st4.createDiv({ cls: 'ws-wr-pstat__n ws-wr-finish', text: niceDay(finish!) });
			st4.createDiv({ cls: 'ws-wr-pstat__label', text: 'finish at your recent pace' });
		}
	}

	// The last 30 days.
	const last = lastDays(days, today, 30);
	const max = Math.max(goal ?? 0, ...last.map((d) => d.words), 1);
	const chart = sec.createDiv({ cls: 'ws-wr-pchart', attr: { role: 'img', 'aria-label': `Words written each day over the last 30 days; ${last.filter((d) => d.words > 0).length} days with writing` } });
	if (goal) chart.createDiv({ cls: 'ws-wr-pchart__goal', attr: { style: `bottom:${Math.round((goal / max) * 100)}%` } });
	for (const d of last) {
		const bar = chart.createDiv({ cls: cx('ws-wr-pchart__bar', d.day === today && 'is-today', goal !== null && d.words >= goal && 'is-met', d.words < 0 && 'is-cut').join(' '), attr: { title: `${niceDay(d.day)}: ${d.words.toLocaleString()} words` } });
		bar.style.height = `${Math.max(d.words !== 0 ? 3 : 0, Math.round((Math.abs(d.words) / max) * 100))}%`;
	}
	const legend = sec.createDiv({ cls: 'ws-wr-pchart__legend' });
	legend.createSpan({ text: niceDay(last[0]!.day) });
	legend.createSpan({ text: 'Today' });

	if (!goal && !p.deadline) {
		const hint = sec.createDiv({ cls: 'ws-wr-wprogress__hint' });
		hint.createSpan({ text: 'Set a daily goal or a day to finish by, and this shows your streak against it and what’s needed each day.' });
		button(hint, { label: 'Set goals…', icon: 'target', variant: 'ghost', size: 'sm', cls: 'ws-wr-set-goals', onClick: openDetails });
	}

	const sprints = (p.sprints ?? []).slice(-5).reverse();
	if (sprints.length) {
		caps(sec, 'Recent sprints', 'ws-wr-sheet__label');
		const ul = sec.createEl('ul', { cls: 'ws-wr-sprints' });
		for (const s of sprints) {
			const li = ul.createEl('li');
			li.createSpan({ text: new Date(s.start).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) });
			li.createSpan({ cls: 'ws-wr-sprints__w', text: `${s.words.toLocaleString()} words in ${s.minutes} min` });
		}
	}
}

/**
 * The manuscript's compact counter: today's words (against the goal), the streak, and the
 * sprint button (or the running sprint's time and words, with Stop). Repaints itself while a
 * sprint runs; `register` cleans up with the screen.
 */
export function renderTodayBadge(st: Studio, parent: HTMLElement, register: (fn: () => void) => void): void {
	const p = st.project!;
	const el = parent.createDiv({ cls: 'ws-wr-today' });
	let tick: number | null = null;
	let cleanup = () => {};
	const paint = () => {
		// Gone from the page (the status bar was redrawn or the screen closed): stop listening.
		if (!el.isConnected) {
			cleanup();
			return;
		}
		el.empty();
		const today = st.w.wordsToday(p.id);
		const goal = p.dailyGoal ?? null;
		const days = { ...(p.days ?? {}), [dayKey()]: today };
		const sk = streaks(days, goal, dayKey());
		const t = el.createSpan({ cls: cx('ws-wr-today__words', goal !== null && today >= goal && 'is-met').join(' '), attr: { title: goal ? `Today’s goal: ${goal} words` : 'Words written today in this project' } });
		t.setText(goal ? `Today ${fmt(Math.max(0, today))} / ${fmt(goal)}` : `Today ${fmt(today)}`);
		if (sk.current > 0) {
			const f = el.createSpan({ cls: 'ws-wr-today__streak', attr: { title: `${sk.current}-day streak` } });
			icon(f, 'flame');
			f.createSpan({ text: String(sk.current) });
		}
		const run = sprint();
		if (run && run.projectId === p.id) {
			const r = el.createSpan({ cls: 'ws-wr-today__sprint', attr: { 'aria-live': 'polite' } });
			icon(r, 'timer');
			r.createSpan({ cls: 'ws-wr-today__left', text: timeLeft() });
			r.createSpan({ cls: 'ws-wr-muted', text: `· ${sprintWords(st.w).toLocaleString()} words` });
			button(el, { label: 'Stop', variant: 'quiet', size: 'sm', cls: 'ws-wr-sprint-stop', onClick: () => stopSprint(st.w, false) });
			if (tick === null) tick = window.setInterval(paint, 1000);
		} else {
			if (tick !== null) {
				window.clearInterval(tick);
				tick = null;
			}
			const b = button(el, {
				label: 'Sprint',
				icon: 'timer',
				variant: 'quiet',
				size: 'sm',
				cls: 'ws-wr-sprint-start',
				tooltip: 'A timed burst of writing; the words are counted for you',
				onClick: (evt) => {
					const m = new Menu();
					for (const min of [15, 25, 45]) m.addItem((i) => i.setTitle(`${min}-minute sprint`).setIcon('timer').onClick(() => startSprint(st.w, p.id, min)));
					if (evt.detail === 0) {
						const r = b.getBoundingClientRect();
						m.showAtPosition({ x: r.left, y: r.bottom + 4 });
					} else m.showAtMouseEvent(evt);
				},
			});
			b.setAttr('aria-haspopup', 'menu');
		}
	};
	paint();
	const off = onSprint(paint);
	const sub = st.s.events.on('writing:words', ({ projectId }) => projectId === p.id && paint());
	cleanup = () => {
		off();
		sub.dispose();
		if (tick !== null) window.clearInterval(tick);
		tick = null;
	};
	register(cleanup);
}
