import { EDITION, EDITION_NAME, openProPage } from '../app/edition';
import { Notice, PluginSettingTab, normalizePath, type App, type Plugin, type Setting, type SettingDefinitionItem } from 'obsidian';
import type { WorldsmithApp } from '../app/WorldsmithApp';
import { confirmModal } from '../ui/components/modals';
import { WRITING_LIMITS, type WritingSettings } from './settings';

/**
 * Obsidian settings tab. Appearance changes apply live to open Worldsmith panes.
 */
export class WorldsmithSettingsTab extends PluginSettingTab {
	constructor(
		app: App,
		plugin: Plugin,
		private readonly ws: WorldsmithApp,
	) {
		super(app, plugin);
	}

	/**
	 * Obsidian 1.13's declarative settings (0.30.9): every row below is recorded (name,
	 * description, controls) and handed to Obsidian as a definition: headings become groups, rows
	 * become definitions whose render callback replays their controls. Obsidian draws them, and
	 * its settings search finds them.
	 */
	override getSettingDefinitions(): SettingDefinitionItem[] {
		const rows: RecordedRow[] = [];
		this.build(() => {
			const r = new RecordedRow();
			rows.push(r);
			return r.asSetting();
		});
		const out: SettingDefinitionItem[] = [];
		let group: { type: 'group'; heading: string; items: SettingDefinitionItem[] } | null = null;
		for (const r of rows) {
			if (r.heading) {
				group = { type: 'group', heading: r.name, items: [] };
				out.push(group as unknown as SettingDefinitionItem);
				continue;
			}
			const def = r.ops.length ? { name: r.name, desc: r.desc, render: (setting: Setting) => r.replay(setting) } : { name: r.name, desc: r.desc };
			(group ? group.items : out).push(def as unknown as SettingDefinitionItem);
		}
		return out;
	}

	private build(row: () => Setting): void {
		this.containerEl.addClass('worldsmith-settings');
		const st = this.ws.settings;
		const save = () => void this.ws.saveSettings();

		// ── Edition (0.30)
		const ed = row().setName(EDITION_NAME);
		if (EDITION === 'pro') ed.setDesc('Thank you for supporting Worldsmith. Every part is available.');
		else {
			ed.setDesc('The Writing Studio, Maps, Timeline, Trees, Graph and Calendars come with Worldsmith Pro: one purchase, no account or licence key, and your worlds carry straight over.');
			ed.addButton((b) => b.setButtonText('Get Worldsmith Pro').setCta().onClick(() => openProPage()));
		}

		// ── Appearance
		row().setName('Appearance').setHeading();
		row()
			.setName('Design')
			.setDesc('Modern Codex is the current design. Classic is how Worldsmith looked before it.')
			.addDropdown((d) =>
				d
					.addOptions({ codex: 'Modern Codex', classic: 'Classic' })
					.setValue(st.appearance.look)
					.onChange((v) => {
						st.appearance.look = v === 'classic' ? 'classic' : 'codex';
						save();
						this.update();
					}),
			);
		if (st.appearance.look === 'codex')
			row()
				.setName('Colors')
				.setDesc('Worldsmith’s bronze, or the colors of your Obsidian theme. Both follow light and dark mode.')
				.addDropdown((d) =>
					d
						.addOptions({ bronze: 'Bronze', theme: 'Match my Obsidian theme' })
						.setValue(st.appearance.palette)
						.onChange((v) => {
							st.appearance.palette = v === 'theme' ? 'theme' : 'bronze';
							save();
						}),
				);
		row()
			.setName('Density')
			.setDesc('Spacing between fields and blocks.')
			.addDropdown((d) =>
				d
					.addOptions({ compact: 'Compact', comfortable: 'Comfortable', spacious: 'Spacious' })
					.setValue(st.appearance.density)
					.onChange((v) => {
						st.appearance.density = v as typeof st.appearance.density;
						save();
					}),
			);
		row()
			.setName('Fonts')
			.setDesc('Names and headings in Worldsmith’s book serif, your theme’s fonts, or fonts installed on this device.')
			.addDropdown((d) =>
				d
					.addOptions({ ...(st.appearance.look === 'codex' || st.appearance.fontMode === 'codex' ? { codex: 'Book serif for titles' } : {}), theme: 'Use theme fonts', custom: 'Use custom fonts' })
					.setValue(st.appearance.fontMode)
					.onChange((v) => {
						st.appearance.fontMode = v as 'codex' | 'theme' | 'custom';
						save();
						this.update();
					}),
			);
		if (st.appearance.fontMode === 'custom') {
			row()
				.setName('Display font')
				.setDesc('For names and headings, e.g. “Cormorant Garamond”. Must be installed locally.')
				.addText((t) =>
					t.setValue(st.appearance.displayFont).onChange((v) => {
						st.appearance.displayFont = v.trim();
						save();
					}),
				);
			row()
				.setName('Body font')
				.setDesc('For field content, e.g. “URW Bookman”.')
				.addText((t) =>
					t.setValue(st.appearance.bodyFont).onChange((v) => {
						st.appearance.bodyFont = v.trim();
						save();
					}),
				);
		}
		row()
			.setName('Maximum page width')
			.setDesc(`${st.appearance.maxWidth}px`)
			.addSlider((s) =>
				s
					.setLimits(800, 1800, 20)
					.setValue(st.appearance.maxWidth)
					
					.onChange((v) => {
						st.appearance.maxWidth = v;
						save();
					}),
			);
		row().setName('Full width').setDesc('Ignore the maximum width and use the whole pane.').addToggle((t) =>
			t.setValue(st.appearance.fullWidth).onChange((v) => {
				st.appearance.fullWidth = v;
				save();
			}),
		);
		row().setName('Animations').setDesc('Subtle transitions. Always off when your system asks for reduced motion.').addToggle((t) =>
			t.setValue(st.appearance.animations).onChange((v) => {
				st.appearance.animations = v;
				save();
			}),
		);
		row()
			.setName('Hover tooltips')
			.setDesc('Show a small label when the pointer rests on a button, card or widget. Turn off for a quieter interface; buttons keep their names for screen readers.')
			.addToggle((t) =>
				t.setValue(st.appearance.tooltips).onChange((v) => {
					st.appearance.tooltips = v;
					save();
				}),
			);
		row()
			.setName('Card image')
			.setDesc('What database cards show at the top.')
			.addDropdown((d) =>
				d
					.addOptions({ portrait: 'Portrait', banner: 'Banner (falls back to portrait)' })
					.setValue(st.appearance.cardImage)
					.onChange((v) => {
						st.appearance.cardImage = v as 'portrait' | 'banner';
						save();
					}),
			);

		row()
			.setName('Details layout')
			.setDesc('How entry pages lay out their fields. A whole type (all Characters, say) or a single page can choose differently with the layout switch on the Details panel.')
			.addDropdown((d) =>
				d
					.addOptions({ grid: 'Grid — label above each value, two columns', rows: 'List — label beside each value' })
					.setValue(st.appearance.detailsLayout)
					.onChange((v) => {
						st.appearance.detailsLayout = v === 'rows' ? 'rows' : 'grid';
						save();
					}),
			)
			.addExtraButton((b) =>
				b
					.setIcon('rotate-ccw')
					.setTooltip('Reset types and pages that chose their own layout')
					.onClick(() => {
						const n = Object.keys(st.appearance.detailsLayoutByEntry).length + Object.keys(st.appearance.detailsLayoutByType).length;
						st.appearance.detailsLayoutByEntry = {};
						st.appearance.detailsLayoutByType = {};
						save();
						new Notice(n ? 'Every type and page now follows the default layout.' : 'Everything already follows the default layout.');
					}),
			);

		// ── Writing Studio
		row().setName('Writing Studio').setHeading();
		const w = () => st.writing;
		const setW = (patch: Partial<WritingSettings>) => {
			st.writing = { ...st.writing, ...patch };
			save();
		};
		row()
			.setName('Writing surface')
			.setDesc('The page you write on in the manuscript. Paper is warm and easy on the eyes; Theme uses your Obsidian theme’s colours; Dark is a dim page for late nights.')
			.addDropdown((d) =>
				d
					.addOptions({ paper: 'Paper', theme: 'Theme', dark: 'Dark' })
					.setValue(w().surface)
					.onChange((v) => setW({ surface: v === 'theme' || v === 'dark' ? v : 'paper' })),
			);
		row()
			.setName('Page width')
			.setDesc('How wide the lines of text are, in characters (about 60–75 reads best). Separate from the maximum page width above.')
			.addSlider((sl) =>
				sl
					.setLimits(WRITING_LIMITS.pageWidth.min, WRITING_LIMITS.pageWidth.max, WRITING_LIMITS.pageWidth.step)
					.setValue(w().pageWidth)
					
					.onChange((v) => setW({ pageWidth: v })),
			);
		row()
			.setName('Line height')
			.addSlider((sl) =>
				sl
					.setLimits(WRITING_LIMITS.lineHeight.min, WRITING_LIMITS.lineHeight.max, WRITING_LIMITS.lineHeight.step)
					.setValue(w().lineHeight)
					
					.onChange((v) => setW({ lineHeight: v })),
			);
		row()
			.setName('Text size')
			.addSlider((sl) =>
				sl
					.setLimits(WRITING_LIMITS.fontSize.min, WRITING_LIMITS.fontSize.max, 1)
					.setValue(w().fontSize)
					
					.onChange((v) => setW({ fontSize: v })),
			);
		row()
			.setName('Text font')
			.setDesc('Book serif is a calm reading face. Theme font is the one your Obsidian theme uses for notes.')
			.addDropdown((d) =>
				d
					.addOptions({ book: 'Book serif', theme: 'Theme font', custom: 'A font I name' })
					.setValue(w().font)
					.onChange((v) => {
						setW({ font: v === 'theme' || v === 'custom' ? v : 'book' });
						this.update();
					}),
			);
		if (w().font === 'custom') {
			row()
				.setName('Font name')
				.setDesc('A font installed on this device, e.g. Literata. If it isn’t found, the book serif is used.')
				.addText((t) =>
					t
						.setPlaceholder('Literata')
						.setValue(w().customFont)
						.onChange((v) => setW({ customFont: v.slice(0, 80) })),
				);
		}
		row()
			.setName('Typewriter mode')
			.setDesc('Keep the line you’re writing in the middle of the page.')
			.addToggle((t) => t.setValue(w().typewriter).onChange((v) => setW({ typewriter: v })));
		row()
			.setName('Dim other paragraphs')
			.setDesc('In typewriter mode, fade the text you’re not writing in.')
			.addToggle((t) => t.setValue(w().dimOthers).onChange((v) => setW({ dimOthers: v })));

		// ── Sidebar
		row().setName('Sidebar').setHeading();
		row()
			.setName('Dashboards')
			.setDesc('Show your own dashboards in the sidebar, under Home and Tasks. Turn this off if you only use Home; your dashboards are kept and the section comes back when you turn it on.')
			.addToggle((t) =>
				t.setValue(st.showDashboards).onChange((v) => {
					st.showDashboards = v;
					save();
				}),
			);

		// ── Notes
		row().setName('Linked notes').setHeading();
		row()
			.setName('Folder for new notes')
			.setDesc('Linked and native notes are created in a sub-folder per type, e.g. Worldsmith/Characters/.')
			.addText((t) =>
				t
					.setPlaceholder('Worldsmith')
					.setValue(st.notesFolder)
					.onChange((v) => {
						st.notesFolder = normalizePath(v.trim() || 'Worldsmith');
						save();
					}),
			);

		// ── Native notes (0.17)
		row().setName('Native notes').setHeading();
		row()
			.setName('New notes are native notes')
			.setDesc('A note made from an entry’s Note button is a native note: its Properties and sections stay in step with the entry. Turn off to make plain linked notes instead (native notes stay one click away in the same menu).')
			.addToggle((t) =>
				t.setValue(st.nativeNotes.newNotesNative).onChange((v) => {
					st.nativeNotes.newNotesNative = v;
					save();
				}),
			);
		row()
			.setName('Rename the note with its entry')
			.setDesc('When you rename an entry, its native note is renamed too, and Obsidian updates links to it. Renaming the note in Obsidian never renames the entry.')
			.addToggle((t) =>
				t.setValue(st.nativeNotes.renameWithEntry).onChange((v) => {
					st.nativeNotes.renameWithEntry = v;
					save();
				}),
			);
		row()
			.setName('Keep notes styled when Worldsmith is off')
			.setDesc(`Saves the look of native notes as an Obsidian CSS snippet (“${st.nativeNotes.snippetName}.css” in your snippets folder), so they stay styled with the plugin turned off. Worldsmith only rewrites its own, unedited file; a file of yours with that name is never touched. Without it, notes are plain, readable Markdown.`)
			.addToggle((t) =>
				t.setValue(st.nativeNotes.snippet === 'on').onChange(async (v) => {
					st.nativeNotes.snippet = v ? 'on' : 'off';
					save();
					if (v) await this.ws.noteStyles?.writeSnippet();
					else await this.ws.noteStyles?.disableSnippet();
				}),
			);
		row()
			.setName('Sync line in Reading view')
			.setDesc('Shows “In sync with Worldsmith” (or what needs a decision) next to a native note’s “Open in Worldsmith” link.')
			.addToggle((t) =>
				t.setValue(st.nativeNotes.readingExtras).onChange((v) => {
					st.nativeNotes.readingExtras = v;
					save();
				}),
			);

		// ── Images
		row().setName('Images').setHeading();
		const folderSetting = row()
			.setName('Folder for added images')
			.setDesc('Images you upload, paste, drop from your computer or download from a link are copied here. Images already in your vault are used where they are.')
			.addText((t) =>
				t
					.setPlaceholder('Worldsmith/Images')
					.setValue(st.media.folder)
					.onChange((v) => {
						st.media.folder = normalizePath(v.trim() || 'Worldsmith/Images');
						save();
					}),
			);
		row()
			.setName('Use Obsidian’s attachment folder instead')
			.setDesc('Follow “Default location for new attachments” in Files & links. With “Same folder as current file”, images go next to the entry’s linked note.')
			.addToggle((t) =>
				t.setValue(st.media.useAttachmentFolder).onChange((v) => {
					st.media.useAttachmentFolder = v;
					save();
					this.update();
				}),
			);
		folderSetting.then((x) => x.settingEl.toggleClass('is-disabled', st.media.useAttachmentFolder));

		// ── Data
		row().setName('Data & backups').setHeading();
		const dataSetting = row()
			.setName('Data folder')
			.setDesc(
				`Where Worldsmith stores your worlds as JSON (currently “${st.dataFolder}/”). Obsidian Sync skips folders whose names start with a dot, so keep a visible name like “_worldsmith” if you use Sync — and make sure “Other file types” is enabled in Sync’s selective sync settings so the .json files are included.`,
			);
		let pending = st.dataFolder;
		dataSetting.addText((t) => t.setValue(st.dataFolder).onChange((v) => (pending = normalizePath(v.trim() || '_worldsmith'))));
		const change = async (move: boolean) => {
			if (pending === st.dataFolder) return;
			const ok = await confirmModal(this.app, {
				title: move ? `Move your worlds to “${pending}/”?` : `Switch to “${pending}/”?`,
				body: move
					? `Everything in “${st.dataFolder}/” moves to “${pending}/”, then Worldsmith reopens from there. If the folder can’t be renamed directly, files are copied and verified and the original folder is kept.`
					: `Worldsmith will open whatever is already in “${pending}/” (or start fresh if it’s empty). Nothing is moved, and “${st.dataFolder}/” is left as it is.`,
				confirmLabel: move ? 'Move data' : 'Switch folder',
			});
			if (!ok) return;
			try {
				const res = await this.ws.changeDataFolder(pending, { move });
				new Notice(
					res
						? `Moved ${res.files} file${res.files === 1 ? '' : 's'} to “${pending}/”.${res.method === 'copy' ? ` The old folder was kept; delete it once you’ve checked everything.` : ''}`
						: `Now using “${pending}/”.`,
					10000,
				);
			} catch (e) {
				new Notice(`Couldn’t change the data folder: ${e instanceof Error ? e.message : String(e)}`, 12000);
			}
			this.update();
		};
		dataSetting.addButton((b) => b.setButtonText('Move here').setCta().onClick(() => void change(true)));
		dataSetting.addButton((b) => b.setButtonText('Use existing').onClick(() => void change(false)));

		const session = this.ws.worlds.session;
		row()
			.setName('Backups & recovery')
			.setDesc(`Automatic backups are ${this.ws.settings.backups.auto ? 'on' : 'off'}. Make, check and restore backups, and see anything that needs attention after a crash.`)
			.addButton((b) =>
				b
					.setButtonText('Open Backups & recovery')
					.setCta()
					.setDisabled(!session)
					.onClick(() => {
						void this.ws.open({ name: 'backups' });
						(this.app as unknown as { setting?: { close(): void } }).setting?.close();
					}),
			);

		row()
			.setName('World features')
			.setDesc('Choose the parts of Worldsmith the open world uses: Writing Studio, maps, calendars, timeline, trees, the graph, tasks, dashboards and the media library. Off hides a part; nothing is deleted.')
			.addButton((b) =>
				b
					.setButtonText('Open Features')
					.setDisabled(!session)
					.onClick(() => {
						void this.ws.open({ name: 'features' });
						(this.app as unknown as { setting?: { close(): void } }).setting?.close();
					}),
			);

		row()
			.setName('Import & export')
			.setDesc('Move a world to another vault, share types, import a spreadsheet, or write entries out as Markdown notes.')
			.addButton((b) =>
				b
					.setButtonText('Open Import & export')
					.setDisabled(!session)
					.onClick(() => {
						void this.ws.open({ name: 'transfer' });
						(this.app as unknown as { setting?: { close(): void } }).setting?.close();
					}),
			);

		row()
			.setName('Reload from disk')
			.setDesc('Re-read the current world, e.g. after syncing from another device.')
			.addButton((b) =>
				b.setButtonText('Reload').onClick(async () => {
					await this.ws.worlds.reload();
					new Notice('Reloaded.');
				}),
			);

		row().setName('Advanced').setHeading();
		row().setName('Debug logging').addToggle((t) =>
			t.setValue(st.debug).onChange((v) => {
				st.debug = v;
				save();
			}),
		);
	}
}

/**
 * One settings row, recorded: its name, description and whether it is a heading, plus every
 * other call (controls, classes, then-callbacks) to replay on the row Obsidian draws.
 */
class RecordedRow {
	name = '';
	desc: string | DocumentFragment = '';
	heading = false;
	readonly ops: Array<{ method: string; args: unknown[] }> = [];

	asSetting(): Setting {
		const proxy: Setting = new Proxy({} as Setting, {
			get: (_t, key: string | symbol) => {
				if (key === 'setName') return (n: string) => ((this.name = n), proxy);
				if (key === 'setDesc') return (d: string | DocumentFragment) => ((this.desc = d), proxy);
				if (key === 'setHeading') return () => ((this.heading = true), proxy);
				return (...args: unknown[]) => {
					this.ops.push({ method: String(key), args });
					return proxy;
				};
			},
		});
		return proxy;
	}

	replay(setting: Setting): void {
		const target = setting as unknown as Record<string, (...a: unknown[]) => unknown>;
		for (const op of this.ops) target[op.method]?.(...op.args);
	}
}
