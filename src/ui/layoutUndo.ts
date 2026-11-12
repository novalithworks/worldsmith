import { Notice } from 'obsidian';
import type { LayoutDoc } from '../core/types';
import type { WorldSession } from '../services/WorldSession';

/**
 * Undo a layout reset (the Undo on a "back to the default" notice) — unless the layout was
 * changed again since, here or on another device: then the newer work wins, and we say so.
 */
export function undoLayoutReset(s: WorldSession, removed: LayoutDoc, what: string): void {
	if (s.layouts.all().some((d) => d.id === removed.id)) {
		new Notice(`${what} was changed again after the reset, so the earlier layout wasn’t brought back.`);
		return;
	}
	s.layouts.restore(removed);
}
