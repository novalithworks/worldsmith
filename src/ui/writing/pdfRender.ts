import { Platform } from 'obsidian';

/**
 * PDF from Obsidian's own renderer (0.29.3, desktop): the book's styled web page drawn by the
 * same engine that shows the preview, so the PDF has the studio's fonts and colours exactly. It
 * uses Electron's <webview>, whose printToPDF writes the file without a print dialog. Returns
 * null when that isn't available (phones, or a setup without webviews); the caller then writes
 * the PDF itself (services/writing/pdf.ts).
 */

type WebviewEl = HTMLElement & { printToPDF?: (o: Record<string, unknown>) => Promise<Uint8Array | ArrayBuffer> };

function b64(text: string): string {
	const bytes = new TextEncoder().encode(text);
	let bin = '';
	for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
	return btoa(bin);
}

export async function renderHtmlPdf(html: string, timeoutMs = 20000): Promise<Uint8Array | null> {
	if (!Platform.isDesktopApp) return null;
	const doc = activeDocument;
	const wv = createEl('webview' as keyof HTMLElementTagNameMap) as unknown as WebviewEl;
	// Without webview support the element is inert: don't wait for it.
	if (!('printToPDF' in wv) && typeof (wv as unknown as { getWebContentsId?: unknown }).getWebContentsId !== 'function') {
		doc.body.appendChild(wv);
		const upgraded = 'printToPDF' in wv;
		wv.remove();
		if (!upgraded) return null;
	}
	wv.setAttribute('src', `data:text/html;charset=utf-8;base64,${b64(html)}`);
	wv.setAttribute('aria-hidden', 'true');
	wv.setCssStyles({ position: 'fixed', left: '-20000px', top: '0', width: '900px', height: '700px', visibility: 'hidden' });
	doc.body.appendChild(wv);
	try {
		const loaded = await new Promise<boolean>((resolve) => {
			const t = window.setTimeout(() => resolve(false), timeoutMs);
			wv.addEventListener('did-finish-load', () => (window.clearTimeout(t), resolve(true)), { once: true });
			wv.addEventListener('did-fail-load', () => (window.clearTimeout(t), resolve(false)), { once: true });
		});
		if (!loaded || typeof wv.printToPDF !== 'function') return null;
		// A moment for the embedded fonts to be ready.
		await new Promise((r) => window.setTimeout(r, 500));
		const data = await wv.printToPDF({ printBackground: true, preferCSSPageSize: true, margins: { top: 0, bottom: 0, left: 0, right: 0 }, marginsType: 1 });
		const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
		// A real PDF starts with "%PDF".
		return bytes.length > 100 && bytes[0] === 0x25 && bytes[1] === 0x50 ? bytes : null;
	} catch (e) {
		console.warn('[Worldsmith] PDF through Obsidian’s renderer failed; writing it directly', e);
		return null;
	} finally {
		wv.remove();
	}
}
