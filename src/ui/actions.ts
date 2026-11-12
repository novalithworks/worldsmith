import { addNativeNoteItems } from './notes/noteActions';
import { EntityMediaActions } from './media/entityMedia';
import { Keymap, Menu, Notice } from 'obsidian';
import type { WorldsmithContext } from '../app/context';
import type { EntityRecord } from '../core/types';
import { addTypeToSidebar } from '../services/WorldService';
import type { WorldSession } from '../services/WorldSession';
import { mapsOf } from '../services/maps';
import { ROUTES } from '../state/route';
import { CreateEntityModal, NotePickerModal, confirmModal } from './components/modals';
import { NewTypeModal } from './components/NewTypeModal';
import { EntitySuggestModal } from './components/EntitySuggestModal';
import { openAddConnection } from './relationActions';

/**
 * User-level actions shared by every surface (sidebar, cards, hero, commands). Business
 * rules live in services; these functions add the UI around them (modals, notices, undo).
 */

function session(ws: WorldsmithContext): WorldSession | null {
	const s = ws.worlds.session;
	if (!s) new Notice('Open or create a world first.');
	return s;
}

export function openCreateEntity(
	ws: WorldsmithContext,
	opts: { typeId?: string | null; parentId?: string | null; typeIds?: string[]; newLeaf?: boolean } = {},
): void {
	const s = session(ws);
	if (!s) return;
	let types = s.schemas.list();
	if (opts.typeIds?.length) types = types.filter((t) => opts.typeIds?.includes(t.id));
	new CreateEntityModal(
		ws.app,
		types,
		opts.typeId ?? (types.length === 1 ? (types[0]?.id ?? null) : null),
		(typeId, name) => {
			const e = s.entityService.create(typeId, { name, parentId: opts.parentId ?? null });
			void ws.open(ROUTES.entity(e.id), { newLeaf: opts.newLeaf });
		},
		opts.typeIds?.length ? undefined : () => openNewType(ws),
	).open();
}

export function openNewType(ws: WorldsmithContext, onCreated?: (typeId: string) => void): void {
	const s = session(ws);
	if (!s) return;
	new NewTypeModal(
		ws.app,
		(v) => {
			const schema = v.starter
				? s.schemas.createFromTemplate(v.starter, v, (id) => !!s.relations.type(id))
				: s.schemas.createCustomType(v);
			const sidebar = JSON.parse(JSON.stringify(s.world.sidebar)) as typeof s.world.sidebar;
			addTypeToSidebar(sidebar, schema);
			s.updateWorld({ sidebar });
			new Notice(`${schema.plural} added to your world.`);
			if (onCreated) onCreated(schema.id);
			else void ws.open({ name: 'type-studio', params: { typeId: schema.id, tab: 'fields' } });
		},
		{ onImport: () => void ws.open({ name: 'transfer', params: { section: 'types' } }), hasRelationType: (id) => !!s.relations.type(id) },
	).open();
}

export function openSearch(ws: WorldsmithContext): void {
	const s = session(ws);
	if (!s) return;
	new EntitySuggestModal(ws.app, s, (e, evt) => {
		void ws.open(ROUTES.entity(e.id), { newLeaf: Keymap.isModEvent(evt) ? 'tab' : false });
	}).open();
}

/** Soft delete with an Undo button in the notice. */
export function trashEntity(ws: WorldsmithContext, entity: EntityRecord): void {
	const s = session(ws);
	if (!s) return;
	s.entityService.trash(entity.id);
	const frag = createFragment();
	const wrap = frag.createDiv({ cls: 'ws-notice' });
	wrap.createSpan({ text: `“${entity.name}” moved to trash. ` });
	const undo = wrap.createEl('button', { cls: 'ws-notice__action', text: 'Undo' });
	const notice = new Notice(frag, 8000);
	undo.addEventListener('click', () => {
		s.entityService.restore(entity.id);
		notice.hide();
	});
}

export async function deletePermanently(ws: WorldsmithContext, entity: EntityRecord): Promise<boolean> {
	const s = session(ws);
	if (!s) return false;
	const impact = s.entityService.deleteImpact(entity.id);
	const details: string[] = [];
	if (impact.children) details.push(`${impact.children} nested ${impact.children === 1 ? 'entry moves' : 'entries move'} up one level`);
	if (impact.relations) details.push(`Its ${impact.relations} connection${impact.relations === 1 ? '' : 's'} to other entries will be removed`);
	if (impact.tasks) details.push(`${impact.tasks} development task${impact.tasks === 1 ? '' : 's'} will be removed`);
	if (impact.hasLinkedNote) details.push('The linked note stays in your vault');
	const ok = await confirmModal(ws.app, {
		title: `Delete “${entity.name}” permanently?`,
		body: 'This can’t be undone. A backup from settings can still restore it.',
		details,
		confirmLabel: 'Delete permanently',
		danger: true,
	});
	if (ok) s.entityService.deletePermanently(entity.id);
	return ok;
}

export function moveUnder(ws: WorldsmithContext, entity: EntityRecord): void {
	const s = session(ws);
	if (!s) return;
	const schema = s.schemas.get(entity.typeId);
	// Exclude self and descendants to prevent cycles.
	const exclude = new Set<string>([entity.id]);
	const stack = [entity.id];
	while (stack.length) {
		const id = stack.pop() as string;
		for (const c of s.index.childrenOf(id)) {
			if (!exclude.has(c.id)) {
				exclude.add(c.id);
				stack.push(c.id);
			}
		}
	}
	new EntitySuggestModal(
		ws.app,
		s,
		(parent) => {
			s.entityService.update(entity.id, { parentId: parent.id });
			new Notice(`Moved under ${parent.name}.`);
		},
		{ placeholder: `Place “${entity.name}” inside…`, typeIds: schema?.hierarchy.parentTypes, exclude },
	).open();
}

/**
 * A titled sub-menu inside `menu`. Obsidian draws one when it can (MenuItem.setSubmenu, not in
 * the public typings); otherwise the items go straight into the menu after a separator.
 */
export function subMenu(menu: Menu, title: string, iconName: string): Menu {
	let sub: Menu | null = null;
	menu.addItem((i) => {
		i.setTitle(title).setIcon(iconName);
		const make = (i as unknown as { setSubmenu?: () => Menu }).setSubmenu;
		if (typeof make === 'function') sub = make.call(i);
		// No sub-menus here: the title becomes a section label over the items that follow.
		else i.setIsLabel(true);
	});
	if (sub) return sub;
	return menu;
}

/** Right-click / "more" menu for an entity, identical everywhere: the common actions first, the rest grouped. */
export function entityMenu(ws: WorldsmithContext, entity: EntityRecord, opts: { onPage?: boolean; onCustomize?: () => void } = {}): Menu {
	const s = ws.worlds.session;
	const menu = new Menu();
	if (!s) return menu;
	const schema = s.schemas.get(entity.typeId);

	if (!opts.onPage) {
		menu.addItem((i) => i.setTitle('Open').setIcon('arrow-up-right').onClick(() => void ws.open(ROUTES.entity(entity.id))));
	}
	menu.addItem((i) =>
		i.setTitle('Open in new tab').setIcon('file-plus-2').onClick(() => void ws.open(ROUTES.entity(entity.id), { newLeaf: 'tab' })),
	);
	menu.addItem((i) =>
		i.setTitle('Open to the right').setIcon('separator-vertical').onClick(() => void ws.open(ROUTES.entity(entity.id), { newLeaf: 'split' })),
	);
	menu.addSeparator();
	menu.addItem((i) =>
		i
			.setTitle(entity.flags.favorite ? 'Remove from favorites' : 'Add to favorites')
			.setIcon('star')
			.onClick(() => s.entityService.toggleFavorite(entity.id)),
	);

	const org = subMenu(menu, 'Organize', 'folder-tree');
	org.addItem((i) =>
		i
			.setTitle(entity.flags.pinned ? 'Unpin' : 'Pin to dashboard')
			.setIcon('pin')
			.onClick(() => s.entityService.togglePinned(entity.id)),
	);
	org.addItem((i) =>
		i.setTitle('Duplicate').setIcon('copy').onClick(() => {
			const copy = s.entityService.duplicate(entity.id);
			if (copy) void ws.open(ROUTES.entity(copy.id));
		}),
	);
	if (schema?.hierarchy.allowParent !== false) {
		org.addItem((i) => i.setTitle('Move under…').setIcon('corner-down-right').onClick(() => moveUnder(ws, entity)));
		if (entity.parentId) {
			org.addItem((i) =>
				i.setTitle('Move to top level').setIcon('corner-left-up').onClick(() => s.entityService.update(entity.id, { parentId: null })),
			);
		}
	}
	if (!entity.trashedAt) {
		org.addItem((i) =>
			i
				.setTitle(entity.archivedAt ? 'Unarchive' : 'Archive')
				.setIcon('archive')
				.onClick(() => s.entityService.setArchived(entity.id, !entity.archivedAt)),
		);

		const con = subMenu(menu, 'Connections', 'waypoints');
		con.addItem((i) => i.setTitle('Add connection…').setIcon('waypoints').onClick(() => openAddConnection(ws, s, entity)));
		if (s.relations.count(entity.id)) con.addItem((i) => i.setTitle('See connections').setIcon('share-2').onClick(() => void ws.open(ROUTES.graph(undefined, entity.id))));
		const tree = s.trees.list().find((t) => t.kind === 'family' && t.rootId === entity.id);
		if (tree || entity.typeId === 'character') {
			con.addItem((i) =>
				i.setTitle('Family tree').setIcon('network').onClick(() => {
					let t = tree;
					if (!t) {
						s.ensureRelationKinds(['parent-of', 'marriage']);
						t = s.trees.create({ name: `${entity.name}’s family`, kind: 'family', rootId: entity.id });
					}
					void ws.open(ROUTES.trees(t.id));
				}),
			);
		}
		const onMap = mapsOf(s, entity.id)[0];
		if (onMap) con.addItem((i) => i.setTitle(onMap.isOf ? `Open ${onMap.map.name}` : `Show on ${onMap.map.name}`).setIcon('map').onClick(() => void ws.open(ROUTES.maps(onMap.map.id, onMap.isOf ? undefined : entity.id))));

		const media = new EntityMediaActions(ws, s, entity.id);
		const img = subMenu(menu, 'Images', 'image');
		img.addItem((i) => i.setTitle(entity.media.portrait ? 'Change portrait…' : 'Add portrait…').setIcon('user-round').onClick(() => media.pickPortrait()));
		img.addItem((i) => i.setTitle(entity.media.banner ? 'Change banner…' : 'Add banner…').setIcon('panel-top').onClick(() => media.pickBanner()));
	}

	const notes = subMenu(menu, 'Linked notes', 'file-text');
	if (entity.linkedNote) {
		notes.addItem((i) => i.setTitle('Open linked note').setIcon('file-text').onClick(() => void ws.linkedNotes.open(entity)));
		for (const n of entity.moreNotes.slice(0, 5))
			notes.addItem((i) =>
				i
					.setTitle(`Open ${n.label || n.path.split('/').pop()?.replace(/\.md$/, '')}`)
					.setIcon('file')
					.onClick(() => void ws.linkedNotes.openPath(n.path)),
			);
		notes.addItem((i) =>
			i.setTitle('Link another note…').setIcon('link').onClick(() => new NotePickerModal(ws.app, (f) => ws.linkedNotes.link(entity, f)).open()),
		);
	} else {
		notes.addItem((i) =>
			i.setTitle('Create linked note').setIcon('file-plus').onClick(async () => {
				const f = await ws.linkedNotes.create(entity);
				if (f) new Notice(`Created ${f.path}`);
			}),
		);
		notes.addItem((i) =>
			i.setTitle('Link existing note…').setIcon('link').onClick(() => new NotePickerModal(ws.app, (f) => ws.linkedNotes.link(entity, f)).open()),
		);
	}

	addNativeNoteItems(subMenu(menu, 'Native note', 'file-check'), ws, entity);

	menu.addSeparator();
	if (opts.onCustomize) {
		const go = opts.onCustomize;
		menu.addItem((i) => i.setTitle('Customize this page…').setIcon('layout-grid').onClick(go));
	}
	if (schema) {
		menu.addItem((i) =>
			i.setTitle(`Edit the ${schema.singular} type…`).setIcon('shapes').onClick(() => void ws.open(ROUTES.typeStudio(schema.id))),
		);
	}
	menu.addSeparator();
	if (entity.trashedAt) {
		menu.addItem((i) => i.setTitle('Restore').setIcon('undo-2').onClick(() => s.entityService.restore(entity.id)));
		menu.addItem((i) =>
			i.setTitle('Delete permanently').setIcon('trash-2').setWarning(true).onClick(() => void deletePermanently(ws, entity)),
		);
	} else {
		menu.addItem((i) => i.setTitle('Move to trash').setIcon('trash-2').setWarning(true).onClick(() => trashEntity(ws, entity)));
	}
	return menu;
}
