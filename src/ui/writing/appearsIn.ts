import type { WorldsmithContext } from '../../app/context';
import type { EntityRecord } from '../../core/types';
import type { WorldSession } from '../../services/WorldSession';
import { appearancesOf, type SceneRole } from '../../services/writing/world';
import { ROUTES } from '../../state/route';
import { icon } from '../components/dom';

/**
 * WS5 (0.22): "Appears in" on an entry's page. The scenes the entry is in (point of view, in
 * the scene, or where it happens), grouped by project in reading order. Shown only when there
 * is at least one, so pages of entries that aren't in any scene don't change. Clicking a scene
 * opens it in the Writing Studio.
 */

const ROLE_SHORT: Record<SceneRole, string> = { pov: 'Point of view', cast: 'In the scene', location: 'Where it happens' };

export function renderAppearsIn(parent: HTMLElement, ws: WorldsmithContext, s: WorldSession, e: EntityRecord): HTMLElement | null {
	const groups: Array<{ name: string; projectId: string; items: ReturnType<typeof appearancesOf> }> = [];
	for (const p of s.writing.projects({ archived: 'all' })) {
		const items = appearancesOf(s.writing.scenes(p.id), e.id);
		if (items.length) groups.push({ name: p.name + (p.archivedAt ? ' (archived)' : ''), projectId: p.id, items });
	}
	if (!groups.length) return null;
	const total = groups.reduce((n, g) => n + g.items.length, 0);
	const sec = parent.createEl('section', { cls: 'ws-appears' });
	const head = sec.createDiv({ cls: 'ws-appears__head' });
	icon(head, 'feather');
	head.createEl('h2', { cls: 'ws-appears__title', text: 'Appears in' });
	head.createSpan({ cls: 'ws-appears__count', text: `${total} scene${total === 1 ? '' : 's'}` });
	for (const g of groups) {
		const box = sec.createDiv({ cls: 'ws-appears__project' });
		box.createDiv({ cls: 'ws-appears__pname', text: g.name });
		const ol = box.createEl('ol', { cls: 'ws-appears__list' });
		for (const a of g.items) {
			const li = ol.createEl('li');
			const b = li.createEl('button', { cls: 'ws-appears__scene', attr: { type: 'button', 'data-scene': a.scene.id } });
			b.createSpan({ cls: 'ws-appears__stitle', text: a.scene.title });
			b.createSpan({ cls: 'ws-appears__roles', text: a.roles.map((r) => ROLE_SHORT[r]).join(' · ') });
			b.addEventListener('click', () => void ws.open(ROUTES.writing({ project: g.projectId, view: 'manuscript', item: a.scene.id })));
		}
	}
	return sec;
}
