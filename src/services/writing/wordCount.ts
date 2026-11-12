import { splitNote } from '../../core/util/strings';

/**
 * Words in a manuscript note, the way a writer counts them: the front matter, comments
 * (`%% … %%` and `<!-- … -->`), embeds and link targets don't count; a link counts by the
 * words it shows. Hyphenated words and contractions are one word ("well-known", "don't").
 * Chinese, Japanese and Korean characters count one each, as Obsidian does.
 *
 * Pure and synchronous: the ManuscriptIndex caches the result per note.
 */
export function countWords(md: string): number {
	return countWordsInText(proseOf(md));
}

/** The text of a note that counts: no front matter, comments, embeds or link targets. */
export function proseOf(md: string): string {
	return (
		splitNote(md)
			.body.replace(/%%[\s\S]*?(?:%%|$)/g, ' ')
			.replace(/<!--[\s\S]*?(?:-->|$)/g, ' ')
			.replace(/!\[\[[^\]]*\]\]/g, ' ')
			.replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
			.replace(/\[\[([^\]|]*)\|([^\]]*)\]\]/g, '$2')
			.replace(/\[\[([^\]]*)\]\]/g, (_m, target: string) => target.replace(/#.*$/, ''))
			.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
			// Bare URLs are not prose.
			.replace(/\b[a-z][a-z0-9+.-]*:\/\/\S+/gi, ' ')
	);
}

const CJK = /[぀-ヿ㐀-䶿一-鿿豈-﫿가-힯ｦ-ﾟ]/gu;
const WORD = /[\p{L}\p{N}\p{M}]+(?:['’\-_.][\p{L}\p{N}\p{M}]+)*/gu;

export function countWordsInText(text: string): number {
	let n = 0;
	const rest = text.replace(CJK, () => {
		n++;
		return ' ';
	});
	return n + (rest.match(WORD)?.length ?? 0);
}
