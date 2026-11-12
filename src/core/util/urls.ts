/**
 * A link that's safe to open: web addresses (a bare "example.com" becomes https://), mail
 * and Obsidian links. Anything else — javascript:, data:, file: — is refused, including in
 * links that arrive by sync.
 */
export function safeUrl(raw: string): string | null {
	const t = raw.trim();
	if (!t) return null;
	const found = /^([a-z][a-z0-9+.-]*):/i.exec(t)?.[1]?.toLowerCase();
	// "example.com:8080" is a host and port, not a scheme.
	const scheme = found && !found.includes('.') ? found : undefined;
	if (!scheme) return /^[\w-]+(\.[\w-]+)+/.test(t) ? `https://${t}` : null;
	return ['http', 'https', 'mailto', 'obsidian'].includes(scheme) ? t : null;
}
