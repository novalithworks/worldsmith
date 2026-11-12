import { RangeSetBuilder, StateField, type EditorState, type Extension } from '@codemirror/state';
import { Decoration, EditorView, type DecorationSet } from '@codemirror/view';
import { NOTE_MARKER as MARKER } from '../../core/noteMarkers';

/**
 * Hide Worldsmith's section markers in native notes while editing (0.30.5). The markers
 * (`%% ws-start view:… %%`, `%% ws-end … %%`) tell Worldsmith which parts of a note it keeps up
 * to date; Obsidian hides `%%` comments in Reading view but shows them, faded, in Live Preview
 * and Source mode. Here each marker line is hidden (it stays in the file) and the cursor steps
 * over it, so the note reads cleanly and the markers can't be edited by accident.
 */


function build(state: EditorState): DecorationSet {
	// If anything goes wrong, hide nothing rather than break the editor.
	try {
		return markers(state);
	} catch (e) {
		console.warn('[Worldsmith] couldn’t hide the note markers', e);
		return Decoration.none;
	}
}

function markers(state: EditorState): DecorationSet {
	const b = new RangeSetBuilder<Decoration>();
	const doc = state.doc;
	for (let i = 1; i <= doc.lines; i++) {
		const line = doc.line(i);
		if (line.length > 8 && line.text.charCodeAt(0) === 37 && MARKER.test(line.text)) b.add(line.from, line.to, Decoration.replace({ block: true }));
	}
	return b.finish();
}

export function hideNoteMarkers(): Extension {
	const field = StateField.define<DecorationSet>({
		create: build,
		update: (value, tr) => (tr.docChanged ? build(tr.state) : value),
		provide: (f) => [EditorView.decorations.from(f), EditorView.atomicRanges.of((view) => view.state.field(f))],
	});
	return field;
}
