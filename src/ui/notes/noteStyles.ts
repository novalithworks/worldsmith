import { normalizePath } from 'obsidian';
import type { WorldsmithContext } from '../../app/context';
import NOTE_CSS from '../../notes-css/native-note.css';
import CODEX_FONT from '../../styles/codex-font.css';
import { pickSnippetName, safeTplId, snippetOwnership, snippetTemplateBlocks, snippetText, templatesCss } from '../../services/notes/appearanceCss';
import { BUILTIN_NOTE_TEMPLATES } from '../../services/notes/templates';
import { confirmModal } from '../components/modals';

interface CustomCss {
	snippets?: string[];
	enabledSnippets?: Set<string>;
	setCssEnabledStatus?(name: string, on: boolean): void;
	readSnippets?(): Promise<void> | void;
	requestLoadSnippets?(): void;
}

/**
 * The look of native notes (0.17). While the plugin runs, two <style> elements carry the
 * note styling and each template's generated rules. The same CSS is also kept as an
 * Obsidian CSS snippet (when allowed), so the notes stay styled with Worldsmith off.
 *
 * The snippet file is Worldsmith's only while it carries Worldsmith's header with the hash
 * of its contents. Anyone else's file (or one edited by hand) is never overwritten: the
 * snippet is written under a free name instead.
 */
export class NoteStyles {
	private sheet: CSSStyleSheet | null = null;
	private writing: Promise<void> = Promise.resolve();
	private asked = false;

	constructor(private readonly ws: WorldsmithContext) {}

	register(): () => void {
		const subs = [
			this.ws.events.on('world:loaded', () => this.refresh()),
			this.ws.events.on('note-template:saved', () => this.refresh()),
			this.ws.events.on('note-template:deleted', () => this.refresh()),
		];
		this.apply();
		return () => {
			for (const s of subs) s.dispose();
			if (this.sheet) document.adoptedStyleSheets = document.adoptedStyleSheets.filter((x) => x !== this.sheet);
			this.sheet = null;
		};
	}

	/** Every template of the open world plus the built-ins. */
	private templateRules(): string {
		const s = this.ws.worlds.session;
		return templatesCss(s ? s.noteTemplates.list() : BUILTIN_NOTE_TEMPLATES);
	}

	/**
	 * The base look of native notes is in styles.css (0.30.1). The templates' rules change with
	 * the world, so they go in a constructed style sheet (no <style> element is created).
	 */
	apply(): void {
		const doc = document;
		if (typeof CSSStyleSheet === 'undefined' || !('adoptedStyleSheets' in doc)) return;
		if (!this.sheet) {
			this.sheet = new CSSStyleSheet();
			doc.adoptedStyleSheets = [...doc.adoptedStyleSheets, this.sheet];
		}
		this.sheet.replaceSync(this.templateRules());
	}

	refresh(): void {
		this.apply();
		if (this.ws.settings.nativeNotes.snippet === 'on' && this.anyNotes()) void this.writeSnippet();
	}

	private anyNotes(): boolean {
		const s = this.ws.worlds.session;
		if (!s) return false;
		for (const e of s.entities.values()) if (e.nativeNote) return true;
		return false;
	}

	private get customCss(): CustomCss | null {
		return ((this.ws.app as unknown as { customCss?: CustomCss }).customCss ?? null);
	}

	private snippetPath(name: string): string {
		return normalizePath(`${this.ws.app.vault.configDir}/snippets/${name}.css`);
	}

	/** The snippet's CSS: the title font, the note styling and every template's rules. */
	async snippetCss(previous: string | null): Promise<string> {
		const s = this.ws.worlds.session;
		const current = new Set((s ? s.noteTemplates.list() : BUILTIN_NOTE_TEMPLATES).map((t) => safeTplId(t.id)));
		const kept = previous ? [...snippetTemplateBlocks(previous)].filter(([id]) => !current.has(id)).map(([, block]) => block) : [];
		return [CODEX_FONT, NOTE_CSS, this.templateRules(), ...kept].join('\n');
	}

	/** Write (or refresh) the snippet and switch it on. Never overwrites someone else's file. */
	writeSnippet(): Promise<void> {
		this.writing = this.writing.then(() => this.doWrite()).catch((e) => console.warn('[Worldsmith] could not write the notes snippet', e));
		return this.writing;
	}

	private async doWrite(): Promise<void> {
		const adapter = this.ws.app.vault.adapter;
		const settings = this.ws.settings.nativeNotes;
		const dir = normalizePath(`${this.ws.app.vault.configDir}/snippets`);
		if (!(await adapter.exists(dir))) await adapter.mkdir(dir);
		const cache = new Map<string, string | null>();
		const read = async (name: string) => {
			const p = this.snippetPath(name);
			cache.set(name, (await adapter.exists(p)) ? await adapter.read(p) : null);
		};
		// Look at the usual name and the next few, then pick the first that is free or ours.
		await read(settings.snippetName);
		const base = 'worldsmith-notes';
		for (let n = 1; n <= 6; n++) await read(n === 1 ? base : `${base}-${n}`);
		const preferred = snippetOwnership(cache.get(settings.snippetName) ?? null) !== 'foreign' ? settings.snippetName : pickSnippetName(base, (nm) => (cache.has(nm) ? (cache.get(nm) ?? null) : null));
		if (!cache.has(preferred)) await read(preferred);
		const prev = cache.get(preferred) ?? null;
		if (snippetOwnership(prev) === 'foreign') return;
		const text = snippetText(await this.snippetCss(prev));
		if (prev !== text) await adapter.write(this.snippetPath(preferred), text);
		if (preferred !== settings.snippetName) {
			settings.snippetName = preferred;
			await this.ws.saveSettings();
		}
		await this.enable(preferred, true);
	}

	private async enable(name: string, on: boolean): Promise<void> {
		const css = this.customCss;
		if (!css) return;
		try {
			await css.readSnippets?.();
			css.setCssEnabledStatus?.(name, on);
			css.requestLoadSnippets?.();
		} catch (e) {
			console.warn('[Worldsmith] could not switch the notes snippet', e);
		}
	}

	/** Setting turned off: the snippet is switched off (the file stays, untouched). */
	async disableSnippet(): Promise<void> {
		await this.enable(this.ws.settings.nativeNotes.snippetName, false);
	}

	/** After the first native note: ask once whether notes should stay styled without the plugin. */
	async afterNoteCreated(): Promise<void> {
		const st = this.ws.settings.nativeNotes;
		if (st.snippet === 'on') return this.writeSnippet();
		if (st.snippet !== 'ask' || this.asked) return;
		this.asked = true;
		const yes = await confirmModal(this.ws.app, {
			title: 'Keep notes styled when Worldsmith is off?',
			body: `Worldsmith can save the look of its notes as an Obsidian CSS snippet (“${st.snippetName}.css” in your snippets folder), so they stay styled even with the plugin turned off. It only ever rewrites its own file; you can switch it off in Worldsmith’s settings or under Appearance → CSS snippets.`,
			confirmLabel: 'Save the snippet',
		});
		st.snippet = yes ? 'on' : 'off';
		await this.ws.saveSettings();
		if (yes) await this.writeSnippet();
	}
}
