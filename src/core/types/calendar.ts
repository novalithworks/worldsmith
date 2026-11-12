import type { SemanticColor } from './ids';

/**
 * Fictional calendars (Milestone 10). A world can have several; one is its main calendar.
 * Every date sits on one shared line of *absolute years* (the main calendar's own count,
 * negative before its year zero); another calendar is placed on that line by `offset`.
 */
export interface CalendarMonth {
	id: string;
	name: string;
	/** Short form for compact dates ("Frost"); empty = the first three letters. */
	short?: string;
	days: number;
}

/** Days outside any month: festivals, leap days, the five nameless days. */
export interface CalendarFestival {
	id: string;
	name: string;
	/** Comes after this many months (0 = before the first month of the year). */
	after: number;
	days: number;
	/** Every how many years it happens (1 = every year, 4 = a leap day). */
	every: number;
	/** First year (absolute, in this calendar) it happens in when `every` > 1. */
	from?: number;
}

/**
 * A way of counting years. An era counting up names `start` (an absolute year) as its year
 * `firstYear`; one counting down (like BC) names `start` as its year `firstYear` and counts
 * up into the past.
 */
export interface CalendarEra {
	id: string;
	name: string;
	/** Shown after the year: "AE". */
	abbr: string;
	start: number;
	direction: 'up' | 'down';
	/** 0 or 1: what the era's first year is called. */
	firstYear: 0 | 1;
	color?: SemanticColor | null;
}

export type CalendarDateStyle = 'day-month-year' | 'month-day-year' | 'year-month-day' | 'numeric' | 'custom';

/** Your own way of writing dates (style "custom", 0.11.1); "" = worked out from `day`. */
export interface CalendarPattern {
	day: string;
	month: string;
	year: string;
}

export interface Calendar {
	v: number;
	id: string;
	name: string;
	description: string;
	months: CalendarMonth[];
	weekdays: string[];
	/** Which weekday (index) the very first day of year 0 falls on. */
	weekdayOffset: number;
	festivals: CalendarFestival[];
	eras: CalendarEra[];
	style: CalendarDateStyle;
	/** Used when `style` is "custom"; kept when switching back so nothing typed is lost. */
	pattern: CalendarPattern | null;
	/** Show the weekday in day-precise dates. */
	showWeekday: boolean;
	/** Where this calendar's year 0 falls on the main calendar's line (main calendar: 0). */
	offset: number;
	createdAt: number;
	updatedAt: number;
	rev: number;
}
