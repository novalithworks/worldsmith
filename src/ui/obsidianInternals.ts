import { Notice, type App, type WorkspaceLeaf } from 'obsidian';

/**
 * The only place Worldsmith touches undocumented Obsidian APIs. Every call is optional
 * and degrades gracefully, so an Obsidian update can't crash the plugin.
 */

interface SettingInternals {
	setting?: { open?(): void; openTabById?(id: string): void };
}

export function openPluginSettings(app: App, pluginId: string): void {
	const s = (app as unknown as SettingInternals).setting;
	if (s?.open && s.openTabById) {
		s.open();
		s.openTabById(pluginId);
	} else {
		new Notice('Open Settings → Community plugins → Worldsmith.');
	}
}

/** Refresh a leaf's tab title after the view's display text changed. */
export function refreshLeafHeader(leaf: WorkspaceLeaf): void {
	(leaf as unknown as { updateHeader?: () => void }).updateHeader?.();
}
