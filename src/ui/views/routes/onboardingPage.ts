import { Notice, setIcon } from 'obsidian';
import { ROUTES } from '../../../state/route';
import { button, icon } from '../../components/dom';
import { renderWorldFields, type WorldFormValue } from '../../components/WorldEditModal';
import type { RouteDefinition } from './RouteRegistry';
import type { WorldBackup } from '../../../data/backup/BackupService';
import { decodeText, parseJson } from '../../transfer/files';
import { ImportArchiveModal } from '../../transfer/archiveModals';
import { DeletedWorldsModal } from '../../components/worldDelete';
import { setGuide } from '../../guide/guide';
import { WorldImportModal } from '../../transfer/importModals';
import { chooseFile } from '../../transfer/transferPage';

/**
 * First run: a quiet welcome, then a short world form. No tables, no settings — the user
 * lands on their dashboard the moment the world exists.
 */
export const onboardingRoute: RouteDefinition = {
	id: 'onboarding',
	needsWorld: false,
	title: () => 'Welcome to Worldsmith',
	icon: () => 'sparkles',
	render(ctx) {
		const page = ctx.el.createDiv({ cls: 'ws-page ws-onboarding' });
		const card = page.createDiv({ cls: 'ws-onboarding__card' });
		const creatingAnother = (ctx.ws.worlds.manifest()?.worlds.length ?? 0) > 0;

		const welcome = () => {
			card.empty();
			const seal = card.createDiv({ cls: 'ws-onboarding__seal' });
			setIcon(seal, 'globe-2');
			card.createEl('h1', { cls: 'ws-onboarding__title', text: creatingAnother ? 'A new world' : 'Welcome to Worldsmith' });
			card.createEl('p', {
				cls: 'ws-onboarding__lede',
				text: 'Build worlds without limits. Characters, places, powers and histories live here as connected records — your notes stay notes.',
			});
			// Three ways in (0.21): from scratch, from notes you already have, or from an archive.
			const paths = card.createDiv({ cls: 'ws-onboarding__paths', attr: { role: 'list' } });
			const path = (cls: string, ic: string, title: string, body: string, run: (evt: MouseEvent) => void) => {
				const b = paths.createEl('button', { cls: `ws-onboarding__path ${cls}`, attr: { type: 'button', role: 'listitem' } });
				icon(b.createSpan({ cls: 'ws-onboarding__path-icon' }), ic);
				const t = b.createSpan({ cls: 'ws-onboarding__path-text' });
				t.createSpan({ cls: 'ws-onboarding__path-title', text: title });
				t.createSpan({ cls: 'ws-onboarding__path-body', text: body });
				b.addEventListener('click', run);
				return b;
			};
			path('ws-onboarding__new', 'sparkles', creatingAnother ? 'Create a new world' : 'Create a world', 'Start from scratch, with ready-made types for characters, places, factions and more.', () => form('new'));
			path('ws-onboarding__notes', 'file-input', 'Use my existing notes', 'Already have characters or places in Obsidian? Turn them into entries; your notes stay exactly as they are.', () => form('notes'));
			path('ws-onboarding__import', 'download', 'Import a Worldsmith world', 'Move or restore a world from a .worldsmith.zip archive.', (evt) => {
				void (async () => {
					const anchor = (evt.currentTarget as HTMLElement | null) ?? card;
					const file = await chooseFile(ctx.ws, anchor, ['zip', 'json'], 'a world archive', true);
					if (!file?.bytes) return;
					// A .worldsmith.zip archive (0.19), or an older .json world file.
					if (file.name.toLowerCase().endsWith('.zip')) {
						new ImportArchiveModal(ctx.ws, { name: file.name, bytes: file.bytes }, () => ctx.navigate(ROUTES.dashboard())).open();
						return;
					}
					const parsed = parseJson(decodeText(file.bytes.buffer.slice(file.bytes.byteOffset, file.bytes.byteOffset + file.bytes.byteLength) as ArrayBuffer));
					if ('error' in parsed) return void new Notice(parsed.error);
					new WorldImportModal(ctx.ws, parsed.value as WorldBackup, () => ctx.navigate(ROUTES.dashboard())).open();
				})();
			});
			const help = card.createDiv({ cls: 'ws-onboarding__helprow' });
			const hl = help.createEl('button', { cls: 'ws-onboarding__help', text: 'How Worldsmith works', attr: { type: 'button' } });
			hl.addEventListener('click', () => ctx.navigate({ name: 'help', params: {} }));
			// Deleted worlds can be put back from here too (e.g. after deleting the last one).
			const back = card.createDiv({ cls: 'ws-onboarding__deleted' });
			void ctx.ws.worldTrash.list().then((list) => {
				if (!list.length) return;
				const b = back.createEl('button', { cls: 'ws-onboarding__deleted-link', text: `Restore a deleted world (${list.length})`, attr: { type: 'button' } });
				b.addEventListener('click', () => new DeletedWorldsModal(ctx.ws, () => ctx.navigate(ROUTES.dashboard())).open());
			});
			const foot = card.createDiv({ cls: 'ws-onboarding__foot' });
			icon(foot, 'shield-check');
			foot.createSpan({
				text: `Everything is stored as JSON inside your vault (${ctx.ws.settings.dataFolder}/). Nothing leaves your device.`,
			});
		};

		const form = (mode: 'new' | 'notes' = 'new') => {
			card.empty();
			card.addClass('is-form');
			card.createEl('h1', { cls: 'ws-onboarding__title ws-onboarding__title--small', text: 'Name your world' });
			const f = card.createEl('form', { cls: 'ws-form' });
			const value: WorldFormValue = { name: '', description: '', icon: 'globe-2', banner: null };
			const fields = renderWorldFields(ctx.ws, f, value);
			f.createEl('p', {
				cls: 'ws-form__hint',
				text:
					mode === 'notes'
						? 'Next you’ll add your notes: drag them from the file explorer onto a type’s page, such as Characters. Nothing in your vault is moved or changed.'
						: 'Your world starts with 17 ready-made types — characters, locations, magic systems, religions and more. Rename, extend or add your own anytime.',
			});
			const gl = f.createEl('label', { cls: 'ws-onboarding__guideopt' });
			const guideBox = gl.createEl('input', { attr: { type: 'checkbox' } });
			guideBox.checked = true;
			gl.createSpan({ text: 'Show a short getting-started guide on the world’s Home' });
			const row = f.createDiv({ cls: 'ws-modal-actions' });
			button(row, { label: 'Back', variant: 'ghost', onClick: () => { card.removeClass('is-form'); welcome(); } });
			const submit = button(row, { label: 'Create world', icon: 'sparkles', variant: 'primary' });
			submit.type = 'submit';
			f.addEventListener('submit', (e) => void (async () => {
				e.preventDefault();
				if (!value.name.trim()) {
					fields.focus();
					new Notice('Give your world a name.');
					return;
				}
				submit.disabled = true;
				try {
					const made = await ctx.ws.worlds.createWorld(value);
					if (guideBox.checked) await setGuide(ctx.ws, made.worldId, true).catch(() => undefined);
					// From notes: straight to Characters (or the first type), where notes are dropped.
					const typeId = made.schemas.get('character') ? 'character' : made.schemas.list()[0]?.id;
					ctx.navigate(mode === 'notes' && typeId ? ROUTES.database(typeId) : ROUTES.dashboard());
				} catch (err) {
					submit.disabled = false;
					new Notice(`Couldn’t create the world: ${err instanceof Error ? err.message : String(err)}`);
				}
			})());
			window.setTimeout(() => fields.focus(), 0);
		};

		welcome();
	},
};
