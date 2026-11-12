import { joinPath, parentPath, type StorageAdapter } from './StorageAdapter';

/**
 * Crash-tolerant JSON file IO.
 *
 * write(): serialize → write `path.tmp` → read back & compare → (optionally rotate the
 *          current file to `path.bak`) → replace `path` with the tmp file.
 * read():  `path` → `path.tmp` → `path.bak`, first one that parses wins. A file that
 *          exists but cannot be parsed is copied to the quarantine folder and reported —
 *          it is never deleted or silently overwritten.
 *
 * DataAdapter.rename refuses to overwrite an existing target, so replacement is
 * remove-then-rename; the read-side recovery covers a crash between those two steps.
 */
export interface AtomicIOOptions {
	/** Keep the previous version as `path.bak` (used for singleton files). */
	backup?: boolean;
}

export interface ReadResult<T> {
	value: T | null;
	/** Which file the value came from, if not the primary. */
	recoveredFrom?: 'tmp' | 'bak';
	/** Set when a corrupt file was moved aside. */
	quarantined?: string;
	error?: string;
}

export class AtomicJsonFile {
	private madeDirs = new Set<string>();

	constructor(
		private readonly adapter: StorageAdapter,
		private readonly quarantineDir: string,
	) {}

	async ensureDir(dir: string): Promise<void> {
		if (!dir || this.madeDirs.has(dir)) return;
		const parts = dir.split('/');
		let cur = '';
		for (const part of parts) {
			cur = cur ? `${cur}/${part}` : part;
			if (this.madeDirs.has(cur)) continue;
			if (!(await this.adapter.exists(cur))) await this.adapter.mkdir(cur);
			this.madeDirs.add(cur);
		}
	}

	async write(path: string, value: unknown, opts: AtomicIOOptions = {}): Promise<void> {
		const data = JSON.stringify(value, null, 2) + '\n';
		const tmp = `${path}.tmp`;
		await this.ensureDir(parentPath(path));
		await this.adapter.write(tmp, data);

		const check = await this.adapter.read(tmp);
		if (check !== data) {
			throw new Error(`[Worldsmith] write verification failed for ${path}`);
		}

		if (await this.adapter.exists(path)) {
			if (opts.backup) {
				const bak = `${path}.bak`;
				if (await this.adapter.exists(bak)) await this.adapter.remove(bak);
				await this.adapter.rename(path, bak);
			} else {
				await this.adapter.remove(path);
			}
		}
		await this.adapter.rename(tmp, path);
	}

	async read<T>(path: string): Promise<ReadResult<T>> {
		const primary = await this.tryRead<T>(path);
		if (primary.kind === 'ok') return { value: primary.value };

		for (const [suffix, label] of [['.tmp', 'tmp'], ['.bak', 'bak']] as const) {
			const alt = await this.tryRead<T>(path + suffix);
			if (alt.kind === 'ok') {
				const result: ReadResult<T> = { value: alt.value, recoveredFrom: label };
				if (primary.kind === 'corrupt') result.quarantined = await this.quarantine(path, primary.raw);
				return result;
			}
		}

		if (primary.kind === 'corrupt') {
			return { value: null, quarantined: await this.quarantine(path, primary.raw), error: primary.error };
		}
		return { value: null };
	}

	async remove(path: string): Promise<void> {
		for (const p of [path, `${path}.tmp`, `${path}.bak`]) {
			if (await this.adapter.exists(p)) await this.adapter.remove(p);
		}
	}

	private async tryRead<T>(
		path: string,
	): Promise<{ kind: 'ok'; value: T } | { kind: 'missing' } | { kind: 'corrupt'; raw: string; error: string }> {
		if (!(await this.adapter.exists(path))) return { kind: 'missing' };
		let raw: string;
		try {
			raw = await this.adapter.read(path);
		} catch (e) {
			return { kind: 'corrupt', raw: '', error: String(e) };
		}
		try {
			return { kind: 'ok', value: JSON.parse(raw) as T };
		} catch (e) {
			return { kind: 'corrupt', raw, error: String(e) };
		}
	}

	private async quarantine(path: string, raw: string): Promise<string> {
		const stamp = new Date().toISOString().replace(/[:.]/g, '-');
		const target = joinPath(this.quarantineDir, `${stamp}__${path.replace(/[\\/]/g, '__')}`);
		try {
			await this.ensureDir(this.quarantineDir);
			await this.adapter.write(target, raw);
		} catch (e) {
			console.error('[Worldsmith] could not quarantine', path, e);
		}
		console.warn(`[Worldsmith] ${path} could not be parsed; a copy was saved to ${target}`);
		return target;
	}
}
