/**
 * Which backups to delete (0.20). Pure, so the rules are tested directly.
 *
 * Each class keeps its newest N: automatic, manual, and safety backups (made before a
 * restore or a migration). Never deleted: the backup just made, and the newest backup that
 * passed verification (so a run of failed backups can never push out the last good one).
 * Backups that failed verification count toward their class like any other.
 */

export type BackupKind = 'auto' | 'manual' | 'before-restore' | 'before-migration' | 'before-delete';

export interface RetentionLimits {
	auto: number;
	manual: number;
	safety: number;
}

export function retentionClass(kind: string): keyof RetentionLimits {
	return kind === 'auto' ? 'auto' : kind === 'manual' ? 'manual' : 'safety';
}

export function planRetention(entries: Array<{ file: string; kind: string; createdAt: number; verified: string }>, limits: RetentionLimits, justMade: string | null): string[] {
	const newestFirst = [...entries].sort((a, b) => b.createdAt - a.createdAt);
	const protectedFiles = new Set<string>();
	if (justMade) protectedFiles.add(justMade);
	const lastGood = newestFirst.find((e) => e.verified === 'ok');
	if (lastGood) protectedFiles.add(lastGood.file);
	const seen: Record<keyof RetentionLimits, number> = { auto: 0, manual: 0, safety: 0 };
	const drop: string[] = [];
	for (const e of newestFirst) {
		const c = retentionClass(e.kind);
		seen[c]++;
		if (seen[c] > Math.max(1, limits[c]) && !protectedFiles.has(e.file)) drop.push(e.file);
	}
	return drop;
}

/** Plain words for a failed write; out-of-space gets its own message. */
export function writeProblem(e: unknown): string {
	const m = e instanceof Error ? e.message : String(e);
	if (/ENOSPC|no space|disk full|quota/i.test(m)) return 'There isn’t enough free disk space.';
	if (/EACCES|EPERM|read-only|EROFS/i.test(m)) return 'The vault folder can’t be written to (it may be read-only).';
	return m;
}

