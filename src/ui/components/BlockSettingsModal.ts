import { Component } from 'obsidian';
import type { WorldsmithContext } from '../../app/context';
import type { BlockDefinition } from '../../blocks/BlockRegistry';
import type { BlockInstance, EntitySchema, FieldDefinition } from '../../core/types';
import type { WorldSession } from '../../services/WorldSession';
import { button, cx } from './dom';
import { WorldsmithModal } from './modals';

/**
 * Settings of one widget: its title plus the block's own `configFields`, edited with the
 * standard field editors. Changes apply immediately.
 */
export class BlockSettingsModal extends WorldsmithModal {
	private ws_scope = new Component();
	private ws_instance: BlockInstance;
	private ws_closed = false;

	constructor(
		private readonly ws_ctx: WorldsmithContext,
		private readonly ws_session: WorldSession,
		instance: BlockInstance,
		private readonly ws_def: BlockDefinition,
		private readonly ws_save: (next: BlockInstance) => void,
		private readonly ws_schema?: EntitySchema,
	) {
		super(ws_ctx.app);
		this.ws_instance = instance;
		this.modalEl.addClass('ws-block-settings');
	}

	override onOpen(): void {
		this.ws_scope.load();
		const def = this.ws_def;
		this.setTitle(`${def.name} settings`);
		const c = this.contentEl;
		c.createDiv({ cls: 'ws-fm__hint', text: def.description });
		const grid = c.createDiv({ cls: 'ws-fields ws-bs__fields' });

		const titleRow = grid.createDiv({ cls: 'ws-prop ws-prop--full' });
		titleRow.createDiv({ cls: 'ws-prop__label', text: 'Title' });
		const title = titleRow.createDiv({ cls: 'ws-prop__value' }).createEl('input', {
			cls: 'ws-input',
			attr: { type: 'text', placeholder: def.name, 'aria-label': 'Title' },
		});
		title.value = this.ws_instance.title ?? '';
		title.addEventListener('change', () => this.apply({ title: title.value.trim() || null }));

		const fieldsHost = grid.createDiv({ cls: 'ws-bs__rows' });
		const fieldsFor = (): FieldDefinition[] => {
			const merged = { ...def.defaultConfig, ...this.ws_instance.config };
			return typeof def.configFields === 'function' ? def.configFields(this.ws_session, { schema: this.ws_schema, config: merged }) : (def.configFields ?? []);
		};
		/** Which rows (and choices) the dialog shows; a rebuild happens only when it changes. */
		const signature = (fields: FieldDefinition[]) =>
			JSON.stringify(fields.map((f) => [f.id, f.type, f.label, f.description ?? '', Array.isArray(f.config?.options) ? (f.config.options as Array<{ id: string }>).map((o) => o.id) : null]));
		let shown = '';
		const paintFields = (focusId?: string): number => {
			fieldsHost.empty();
			this.ws_scope.unload();
			this.ws_scope = new Component();
			this.ws_scope.load();
			const fields = fieldsFor();
			shown = signature(fields);
			for (const f of fields) {
				const kind = this.ws_ctx.fieldTypes.for(f);
				const row = fieldsHost.createDiv({ cls: cx('ws-prop', `ws-prop--${f.width ?? 'half'}`), attr: { 'data-setting': f.id } });
				row.createDiv({ cls: 'ws-prop__label', text: f.label });
				const val = row.createDiv({ cls: 'ws-prop__value' });
				kind.ui?.createEditor(val, {
					app: this.app,
					field: f,
					entity: null,
					component: this.ws_scope,
					value: ((v) => (f.type === 'select' && typeof v === 'number' ? String(v) : v))(f.id in this.ws_instance.config ? this.ws_instance.config[f.id] : def.defaultConfig[f.id]),
					onChange: (v) => {
						let config = { ...this.ws_instance.config };
						if (kind.isEmpty(v)) {
							// Clearing a setting whose default isn't empty must stick (e.g. a heading
							// with no text) — otherwise the default would quietly come back.
							const d = def.defaultConfig[f.id];
							if (Array.isArray(d) && d.length) config[f.id] = [];
							else if (typeof d === 'string' && d) config[f.id] = '';
							else delete config[f.id];
						} else {
							const res = kind.coerce(v, f);
							if (!res.ok) return;
							config[f.id] = res.value;
						}
						// The widget may clear settings that depended on this one.
						const before = JSON.stringify({ ...config, [f.id]: null });
						if (def.onSettingChange) config = def.onSettingChange(f.id, config);
						const cleared = JSON.stringify({ ...config, [f.id]: null }) !== before;
						this.apply({ config });
						if (typeof def.configFields !== 'function' && !cleared) return;
						// Rebuild only when the rows themselves change (a new type → its fields),
						// after this editor has finished, keeping focus on the setting just changed.
						window.setTimeout(() => {
							if (this.ws_closed) return;
							if (cleared || signature(fieldsFor()) !== shown) paintFields(f.id);
						}, 0);
					},
				});
				if (f.description) val.createDiv({ cls: 'ws-fm__hint ws-bs__hint', text: f.description });
			}
			if (focusId) fieldsHost.querySelector<HTMLElement>(`[data-setting="${focusId}"] :is(button, input, textarea)`)?.focus();
			return fields.length;
		};
		const count = paintFields();
		if (!count) c.createDiv({ cls: 'ws-fm__hint', text: 'This widget has no other settings.' });
		const actions = c.createDiv({ cls: 'ws-modal-actions' });
		button(actions, { label: 'Done', variant: 'primary', onClick: () => this.close() });
	}

	private apply(patch: Partial<BlockInstance>): void {
		this.ws_instance = { ...this.ws_instance, ...patch };
		this.ws_save(this.ws_instance);
	}

	override onClose(): void {
		this.ws_closed = true;
		this.ws_scope.unload();
		this.contentEl.empty();
	}
}
