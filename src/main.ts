import { watchHasMarks } from './ui/components/hasMarks';
import { setTooltipsEnabled } from './ui/components/tooltips';
import { applyLook, clearLook } from './ui/look';
import { Notice, Plugin } from 'obsidian';
import { EDITION, OTHER_EDITION_ID } from './app/edition';
import { hideNoteMarkers } from './ui/notes/markerHide';
import type { WorldsmithAPI } from './app/api';
import { registerCommands } from './app/commands';
import { VIEW_TYPE_APP } from './app/constants';
import { WorldsmithApp } from './app/WorldsmithApp';
import { ROUTES } from './state/route';
import { WorldsmithSettingsTab } from './settings/SettingsTab';
import { mergeSettings } from './settings/settings';
import { registerNotesUi } from './ui/notes/notesUi';

/**
 * Plugin lifecycle only. Everything else lives behind WorldsmithApp (src/app/).
 */
export default class WorldsmithPlugin extends Plugin {
	private ws!: WorldsmithApp;
	/** Extension API for other plugins: app.plugins.plugins.worldsmith.api */
	api!: WorldsmithAPI;

	/** Problems met while starting (shown once, with what failed). */
	private startProblems: string[] = [];

	/** The free edition's settings, if it was installed in this vault. */
	private async freeSettings(): Promise<unknown> {
		try {
			const path = `${this.app.vault.configDir}/plugins/worldsmith/data.json`;
			if (!(await this.app.vault.adapter.exists(path))) return null;
			return JSON.parse(await this.app.vault.adapter.read(path)) as unknown;
		} catch {
			return null;
		}
	}

	private step(name: string, run: () => void): void {
		try {
			run();
		} catch (e) {
			console.error(`[Worldsmith] start-up step “${name}” failed`, e);
			this.startProblems.push(`${name}: ${e instanceof Error ? e.message : String(e)}`);
		}
	}

	override async onload(): Promise<void> {
		try {
			await this.start();
		} catch (e) {
			// Even the core failing shouldn't leave you with nothing: say what happened.
			console.error('[Worldsmith] failed to start', e);
			new Notice(`Worldsmith couldn’t start: ${e instanceof Error ? e.message : String(e)}. Open the developer console (Ctrl+Shift+I) for details, and send them to the developer.`, 0);
			return;
		}
		if (this.startProblems.length) new Notice(`Worldsmith started, but part of it didn’t: ${this.startProblems.join('; ')}. The rest works. Please send this message to the developer.`, 0);
	}

	private async start(): Promise<void> {
		// One edition at a time (0.30): Pro switches the free copy off; the free copy stays idle beside Pro.
		const plugins = (this.app as unknown as { plugins?: { enabledPlugins?: Set<string>; disablePluginAndSave?: (id: string) => Promise<void> } }).plugins;
		if (plugins?.enabledPlugins?.has(OTHER_EDITION_ID)) {
			if (EDITION === 'free') {
				new Notice('Worldsmith Pro is installed and on, so this free copy of Worldsmith stays idle. You can uninstall it; your worlds are shared.', 15000);
				return;
			}
			try {
				await plugins.disablePluginAndSave?.(OTHER_EDITION_ID);
				new Notice('Worldsmith Pro is on, so the free copy was switched off. Your worlds are the same; you can uninstall the free copy.', 12000);
			} catch (e) {
				console.warn('[Worldsmith] couldn’t switch the free copy off', e);
			}
		}
		// Pro's first start brings the free edition's settings along (data folder, preferences).
		let saved: unknown = await this.loadData();
		if (EDITION === 'pro' && !saved) saved = await this.freeSettings();
		const { upgraded, ...settings } = mergeSettings(saved);
		setTooltipsEnabled(settings.appearance.tooltips);
		this.ws = new WorldsmithApp(this, settings, (s) => this.saveData(s));
		// Dialogs follow the setting even when no Worldsmith pane is open.
		applyLook(document, settings.appearance);
		const sub = this.ws.events.on('settings:changed', () => {
			setTooltipsEnabled(this.ws.settings.appearance.tooltips);
			applyLook(document, this.ws.settings.appearance);
		});
		this.register(() => sub.dispose());
		this.register(() => clearLook(document));
		if (upgraded || (EDITION === 'pro' && saved && !(await this.loadData()))) await this.saveData(settings);
		this.api = this.ws.api;

		this.registerView(VIEW_TYPE_APP, (leaf) => this.ws.createView(leaf));
		// Each start-up step on its own (0.29.1): one that fails is reported and the rest still run,
		// so Worldsmith loads instead of Obsidian's "Failed to load plugin".
		this.step('commands', () => registerCommands(this, this.ws));
		this.step('note commands', () => registerNotesUi(this, this.ws));
		this.step('settings tab', () => this.addSettingTab(new WorldsmithSettingsTab(this.app, this, this.ws)));
		this.step('native note markers', () => this.registerEditorExtension(hideNoteMarkers()));
		this.step('style markers', () => this.register(watchHasMarks()));
		this.step('ribbon icon', () => this.addRibbonIcon('globe-2', 'Open Worldsmith', () => void this.ws.open(ROUTES.dashboard())));

		// Make sure pending edits reach disk when Obsidian quits.
		this.registerEvent(this.app.workspace.on('quit', (tasks) => tasks.add(() => this.ws.flush())));

		// Defer storage work until the workspace is ready, keeping startup light.
		this.app.workspace.onLayoutReady(() => void this.ws.ensureStarted());
	}

	override onunload(): void {
		this.ws?.dispose();
	}
}
