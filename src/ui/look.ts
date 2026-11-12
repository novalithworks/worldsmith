import type { WorldsmithSettings } from '../settings/settings';

/** Body classes that pick the design, the colours and the title font everywhere Worldsmith draws (panes, dialogs, settings, floating windows). */
const CLASSES = ['ws-look-codex', 'ws-look-classic', 'ws-palette-bronze', 'ws-palette-theme', 'ws-font-codex'];

export function applyLook(doc: Document, a: WorldsmithSettings['appearance']): void {
	const body = doc.body;
	body.removeClasses(CLASSES);
	body.addClass(a.look === 'classic' ? 'ws-look-classic' : 'ws-look-codex');
	if (a.look !== 'classic') {
		body.addClass(a.palette === 'theme' ? 'ws-palette-theme' : 'ws-palette-bronze');
		if (a.fontMode === 'codex') body.addClass('ws-font-codex');
	}
}

export function clearLook(doc: Document): void {
	doc.body.removeClasses(CLASSES);
}
