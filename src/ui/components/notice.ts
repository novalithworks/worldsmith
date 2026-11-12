import { Notice } from 'obsidian';

/** A notice with an action button (usually Undo). */
export function actionNotice(message: string, action: { label: string; run: () => void }, timeout = 8000): Notice {
	const frag = createFragment();
	const wrap = frag.createDiv({ cls: 'ws-notice' });
	wrap.createSpan({ text: `${message} ` });
	const btn = wrap.createEl('button', { cls: 'ws-notice__action', text: action.label });
	const n = new Notice(frag, timeout);
	btn.addEventListener('click', () => {
		action.run();
		n.hide();
	});
	return n;
}
