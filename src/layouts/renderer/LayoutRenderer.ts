import { Component, setIcon } from 'obsidian';
import type { BlockInstance } from '../../core/types';
import type { BlockDefinition, BlockRegistry, BlockRenderContext } from '../../blocks/BlockRegistry';
import { buildLayoutTree, type LayoutNode } from '../engine/tree';
import { emptyState, cx } from '../../ui/components/dom';

/**
 * Renders a list of block instances into a container using the guillotine tree.
 *
 * Each block gets its own child Component, so its listeners and timers are released when
 * the layout re-renders or the page closes. Placement (rows/stacks) is pure flexbox; CSS
 * wraps columns in narrow panes and stacks everything in the narrowest.
 */
export type ContextFactory = (
	instance: BlockInstance,
	def: BlockDefinition,
	el: HTMLElement,
	component: Component,
	setTitle: (t: string) => void,
) => BlockRenderContext;

export class LayoutRenderer extends Component {
	private collapsed = new Map<string, boolean>();

	constructor(
		private readonly registry: BlockRegistry,
		private readonly makeContext: ContextFactory,
	) {
		super();
	}

	render(container: HTMLElement, blocks: BlockInstance[]): void {
		container.empty();
		container.addClass('ws-layout');
		const tree = buildLayoutTree(blocks);
		if (!tree) {
			emptyState(container, { icon: 'layout-dashboard', title: 'This page has no blocks yet' });
			return;
		}
		this.renderNode(container, tree);
	}

	private renderNode(parent: HTMLElement, node: LayoutNode): void {
		switch (node.kind) {
			case 'block':
				this.renderBlock(parent, node.block);
				return;
			case 'stack': {
				const el = parent.createDiv({ cls: 'ws-layout-stack' });
				for (const c of node.children) this.renderNode(el, c);
				return;
			}
			case 'row': {
				// A row of small, equal-ish tiles (number widgets, stat cards) wraps two-up on
				// narrow panes instead of stacking into a long column.
				const tiles = node.columns.length >= 3 && node.columns.every((c) => c.node && c.span <= 4);
				const el = parent.createDiv({ cls: cx('ws-layout-row', tiles && 'ws-layout-row--tiles') });
				for (const col of node.columns) {
					const c = el.createDiv({ cls: cx('ws-layout-col', col.node ? '' : 'ws-layout-col--spacer') });
					c.style.setProperty('--ws-span', String(col.span));
					if (col.node) this.renderNode(c, col.node);
				}
				return;
			}
			case 'grid': {
				const el = parent.createDiv({ cls: 'ws-layout-grid' });
				el.style.setProperty('--ws-cols', String(node.span));
				for (const b of node.blocks) {
					const cell = el.createDiv({ cls: 'ws-layout-grid__cell' });
					cell.style.gridColumn = `${b.x - node.x0 + 1} / span ${b.w}`;
					cell.style.gridRow = `${b.y + 1} / span ${b.h}`;
					this.renderBlock(cell, b);
				}
				return;
			}
		}
	}

	private renderBlock(parent: HTMLElement, instance: BlockInstance): void {
		const def = this.registry.get(instance.type);
		// A block of a part the world has switched off isn't drawn; its settings stay (0.29).
		if (def && (this.registry as { hidden?: (d: BlockDefinition) => boolean }).hidden?.(def)) return;
		const frame = parent.createDiv({
			cls: ['ws-block', `ws-block--${def?.frame ?? 'card'}`, `ws-block-type--${instance.type}`],
			attr: { 'data-block-id': instance.id },
		});
		// A height chosen while customizing: the block keeps it and scrolls inside.
		if (instance.height) {
			frame.addClass('has-height');
			frame.style.setProperty('--ws-block-h', `${instance.height}px`);
		}

		if (!def) {
			// A block whose type isn't registered (e.g. from an extension that's not
			// installed) must not break the page.
			emptyState(frame, {
				icon: 'puzzle',
				title: 'Unknown block',
				body: `The “${instance.type}” block isn’t available. Its settings are kept.`,
				compact: true,
			});
			return;
		}

		const component = new Component();
		this.addChild(component);
		let body: HTMLElement;
		let setTitle: (t: string) => void = () => {};

		if (def.frame === 'card') {
			const header = frame.createDiv({ cls: 'ws-block__header' });
			const toggle = header.createEl('button', {
				cls: 'ws-block__toggle',
				attr: { type: 'button', 'aria-expanded': 'true' },
			});
			const titleEl = toggle.createSpan({ cls: 'ws-block__title' });
			const caret = toggle.createSpan({ cls: 'ws-block__caret' });
			setIcon(caret, 'chevron-down');
			const actions = header.createDiv({ cls: 'ws-block__actions' });
			body = frame.createDiv({ cls: 'ws-block__body' });
			// A title the user typed wins over whatever the block would call itself ("· 4").
			const custom = instance.title?.trim();
			setTitle = (t: string) => titleEl.setText(custom || t);
			const isCollapsed = () => this.collapsed.get(instance.id) ?? !!instance.collapsed;
			const apply = () => {
				const c = isCollapsed();
				frame.toggleClass('is-collapsed', c);
				toggle.setAttr('aria-expanded', String(!c));
			};
			toggle.addEventListener('click', () => {
				this.collapsed.set(instance.id, !isCollapsed());
				apply();
			});
			apply();
			// Blocks can put small actions into their header via this element.
			(frame as HTMLElement & { wsActions?: HTMLElement }).wsActions = actions;
		} else {
			// A plain widget with a chosen height scrolls inside an inner box, so the frame
			// (and the customize controls drawn on its edges) isn't clipped.
			body = instance.height ? frame.createDiv({ cls: 'ws-block__scroll' }) : frame;
		}

		const ctx = this.makeContext(instance, def, body, component, setTitle);
		const title = instance.title ?? def.title?.(ctx) ?? def.name;
		setTitle(title);
		try {
			def.render(ctx);
		} catch (e) {
			console.error(`[Worldsmith] block "${def.id}" failed to render`, e);
			body.empty();
			emptyState(body, { icon: 'alert-triangle', title: `${def.name} couldn’t be displayed`, body: String(e), compact: true });
		}
	}
}

/** Header action area of a framed block (for small buttons like "Add"). */
export function blockActions(el: HTMLElement): HTMLElement | null {
	const frame = el.closest('.ws-block');
	return frame?.wsActions ?? null;
}

/**
 * Hide or show a block's whole frame (e.g. "Unused data" when there's nothing to show).
 * The grid cell collapses with it, so the page doesn't keep an empty gap.
 */
export function setBlockHidden(el: HTMLElement, hidden: boolean): void {
	const frame = el.closest('.ws-block');
	frame?.toggleClass('is-block-hidden', hidden);
	frame?.parentElement?.toggleClass('is-block-hidden', hidden && frame.parentElement.hasClass('ws-layout-grid__cell'));
}
