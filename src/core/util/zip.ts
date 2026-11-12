/**
 * A small, dependency-free ZIP writer and a defensive ZIP reader (0.19 world archives).
 *
 * Writing: entries in the order given, UTF-8 names, DEFLATE through the platform's own
 * CompressionStream when it makes the entry smaller (stored otherwise, and always for
 * formats that are already compressed). Plain ZIP (no ZIP64): at most 65,535 entries and
 * 4 GB, which `zip()` refuses to exceed rather than writing a broken file.
 *
 * Reading never trusts the archive: names are checked (no absolute paths, `..`, `\`, drive
 * letters, control characters), duplicates are refused (also ones differing only in case),
 * encrypted or unknown methods are refused, sizes are capped before and while inflating
 * (decompression bombs), and every entry's CRC-32 and size are checked. Nothing in an
 * archive is ever executed.
 */

export interface ZipInput {
	path: string;
	data: Uint8Array;
	/** Modification time (ms). Defaults to the archive's time. */
	mtime?: number;
}

export interface ZipLimits {
	/** Most entries accepted. */
	maxEntries: number;
	/** Most bytes after inflating, all entries together. */
	maxTotalBytes: number;
	/** Most bytes after inflating, one entry. */
	maxEntryBytes: number;
	/** An entry inflating more than this many times its stored size (and over 1 MB) is refused. */
	maxRatio: number;
}

export const DEFAULT_ZIP_LIMITS: ZipLimits = {
	maxEntries: 60_000,
	maxTotalBytes: 2 * 1024 * 1024 * 1024,
	maxEntryBytes: 1024 * 1024 * 1024,
	maxRatio: 200,
};

export class ZipError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'ZipError';
	}
}

// ── CRC-32 ──────────────────────────────────────────────────────────────────

let CRC_TABLE: Uint32Array | null = null;
function crcTable(): Uint32Array {
	if (CRC_TABLE) return CRC_TABLE;
	const t = new Uint32Array(256);
	for (let n = 0; n < 256; n++) {
		let c = n;
		for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
		t[n] = c >>> 0;
	}
	CRC_TABLE = t;
	return t;
}

export function crc32(data: Uint8Array): number {
	const t = crcTable();
	let c = 0xffffffff;
	for (let i = 0; i < data.length; i++) c = t[(c ^ data[i]!) & 0xff]! ^ (c >>> 8);
	return (c ^ 0xffffffff) >>> 0;
}

// ── names ───────────────────────────────────────────────────────────────────

/**
 * Why an archive path isn't a safe relative path, or null when it is. Refuses absolute
 * paths, drive letters, backslashes, `.`/`..`/empty segments, control characters, and
 * names Windows can't hold.
 */
export function unsafeZipPath(p: string): string | null {
	if (!p) return 'empty name';
	if (p.length > 1024) return 'name too long';
	if (p.startsWith('/')) return 'absolute path';
	if (/^[A-Za-z]:/.test(p)) return 'drive letter';
	if (p.includes('\\')) return 'backslash in name';
	// eslint-disable-next-line no-control-regex -- refusing ZIP entry names that contain control characters is the point of this check
	if (/[\u0000-\u001f\u007f]/.test(p)) return 'control character in name';
	const parts = p.split('/');
	for (const s of parts) {
		if (s === '' || s === '.' || s === '..') return 'empty, “.” or “..” segment';
		if (/[<>:"|?*]/.test(s)) return 'character Windows can’t store';
		if (/[ .]$/.test(s)) return 'name ending in a space or dot';
	}
	return null;
}

// ── compression through the platform ───────────────────────────────────────

const STORED_EXT = /\.(png|jpe?g|gif|webp|avif|heic|mp3|mp4|m4a|ogg|webm|mov|zip|gz|7z|pdf|woff2?)$/i;

function hasStreams(): boolean {
	return typeof CompressionStream === 'function' && typeof DecompressionStream === 'function';
}

async function pump(stream: ReadableStream<Uint8Array>, max: number): Promise<Uint8Array> {
	const reader = stream.getReader();
	const chunks: Uint8Array[] = [];
	let total = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		total += value.length;
		if (total > max) {
			await reader.cancel().catch(() => undefined);
			throw new ZipError('an entry is larger than it says (possible decompression bomb)');
		}
		chunks.push(value);
	}
	const out = new Uint8Array(total);
	let o = 0;
	for (const c of chunks) {
		out.set(c, o);
		o += c.length;
	}
	return out;
}

async function through(data: Uint8Array, ts: TransformStream<Uint8Array, Uint8Array>, max: number): Promise<Uint8Array> {
	const writer = ts.writable.getWriter();
	const done = (async () => {
		await writer.write(data);
		await writer.close();
	})();
	const out = pump(ts.readable, max);
	const [, result] = await Promise.all([done.catch((e: unknown) => Promise.reject(e instanceof Error ? e : new Error(String(e)))), out]);
	return result;
}

async function deflateRaw(data: Uint8Array): Promise<Uint8Array> {
	return through(data, new CompressionStream('deflate-raw') as unknown as TransformStream<Uint8Array, Uint8Array>, Number.MAX_SAFE_INTEGER);
}

async function inflateRaw(data: Uint8Array, max: number): Promise<Uint8Array> {
	try {
		return await through(data, new DecompressionStream('deflate-raw') as unknown as TransformStream<Uint8Array, Uint8Array>, max);
	} catch (e) {
		if (e instanceof ZipError) throw e;
		throw new ZipError('an entry’s compressed data is damaged');
	}
}

// ── writing ─────────────────────────────────────────────────────────────────

function dosTime(ms: number): { time: number; date: number } {
	const d = new Date(ms);
	const year = Math.max(1980, Math.min(2107, d.getFullYear()));
	return {
		time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
		date: ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
	};
}

/** Build a ZIP file. Paths must be safe (see `unsafeZipPath`) and unique. */
export async function zip(entries: ZipInput[], o: { mtime?: number; onProgress?: (done: number, total: number) => void } = {}): Promise<Uint8Array> {
	if (entries.length > 65_535) throw new ZipError('too many files for one archive (65,535 at most)');
	const enc = new TextEncoder();
	const seen = new Set<string>();
	const parts: Uint8Array[] = [];
	const central: Uint8Array[] = [];
	let offset = 0;
	const now = o.mtime ?? Date.now();
	const canDeflate = hasStreams();
	let i = 0;
	for (const e of entries) {
		const bad = unsafeZipPath(e.path);
		if (bad) throw new ZipError(`can’t store “${e.path}” (${bad})`);
		const key = e.path.toLowerCase();
		if (seen.has(key)) throw new ZipError(`“${e.path}” is listed twice`);
		seen.add(key);
		const name = enc.encode(e.path);
		const crc = crc32(e.data);
		let method = 0;
		let body = e.data;
		if (canDeflate && e.data.length > 64 && !STORED_EXT.test(e.path)) {
			const z = await deflateRaw(e.data);
			if (z.length < e.data.length) {
				method = 8;
				body = z;
			}
		}
		const { time, date } = dosTime(e.mtime ?? now);
		const local = new DataView(new ArrayBuffer(30));
		local.setUint32(0, 0x04034b50, true);
		local.setUint16(4, 20, true);
		local.setUint16(6, 0x0800, true); // UTF-8 names
		local.setUint16(8, method, true);
		local.setUint16(10, time, true);
		local.setUint16(12, date, true);
		local.setUint32(14, crc, true);
		local.setUint32(18, body.length, true);
		local.setUint32(22, e.data.length, true);
		local.setUint16(26, name.length, true);
		local.setUint16(28, 0, true);
		const cd = new DataView(new ArrayBuffer(46));
		cd.setUint32(0, 0x02014b50, true);
		cd.setUint16(4, 20, true);
		cd.setUint16(6, 20, true);
		cd.setUint16(8, 0x0800, true);
		cd.setUint16(10, method, true);
		cd.setUint16(12, time, true);
		cd.setUint16(14, date, true);
		cd.setUint32(16, crc, true);
		cd.setUint32(20, body.length, true);
		cd.setUint32(24, e.data.length, true);
		cd.setUint16(28, name.length, true);
		cd.setUint32(42, offset, true);
		parts.push(new Uint8Array(local.buffer), name, body);
		central.push(new Uint8Array(cd.buffer), name);
		offset += 30 + name.length + body.length;
		if (offset > 0xfffffff0) throw new ZipError('the archive would be larger than 4 GB');
		o.onProgress?.(++i, entries.length);
	}
	const cdSize = central.reduce((n, c) => n + c.length, 0);
	const end = new DataView(new ArrayBuffer(22));
	end.setUint32(0, 0x06054b50, true);
	end.setUint16(8, entries.length, true);
	end.setUint16(10, entries.length, true);
	end.setUint32(12, cdSize, true);
	end.setUint32(16, offset, true);
	const all = [...parts, ...central, new Uint8Array(end.buffer)];
	const out = new Uint8Array(all.reduce((n, c) => n + c.length, 0));
	let p = 0;
	for (const c of all) {
		out.set(c, p);
		p += c.length;
	}
	return out;
}

// ── reading ─────────────────────────────────────────────────────────────────

export interface ZipEntryInfo {
	path: string;
	size: number;
	compressedSize: number;
	method: number;
	crc: number;
	offset: number;
}

/** The archive's table of contents, checked (names, duplicates, sizes, methods). */
export function listZip(bytes: Uint8Array, limits: ZipLimits = DEFAULT_ZIP_LIMITS): ZipEntryInfo[] {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	if (bytes.length < 22) throw new ZipError('not a ZIP file (too short)');
	let eocd = -1;
	for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 65_535); i--) {
		if (view.getUint32(i, true) === 0x06054b50) {
			eocd = i;
			break;
		}
	}
	if (eocd < 0) throw new ZipError('not a ZIP file (no directory at the end)');
	const count = view.getUint16(eocd + 10, true);
	const cdSize = view.getUint32(eocd + 12, true);
	const cdOffset = view.getUint32(eocd + 16, true);
	if (view.getUint16(eocd + 4, true) !== 0 || view.getUint16(eocd + 8, true) !== count) throw new ZipError('multi-part archives aren’t supported');
	if (count === 0xffff || cdOffset === 0xffffffff) throw new ZipError('ZIP64 archives aren’t supported');
	if (count > limits.maxEntries) throw new ZipError(`too many files (${count})`);
	if (cdOffset + cdSize > eocd) throw new ZipError('the archive’s directory is damaged');
	const dec = new TextDecoder('utf-8', { fatal: true });
	const out: ZipEntryInfo[] = [];
	const seen = new Set<string>();
	let total = 0;
	let p = cdOffset;
	for (let n = 0; n < count; n++) {
		if (p + 46 > eocd || view.getUint32(p, true) !== 0x02014b50) throw new ZipError('the archive’s directory is damaged');
		const flags = view.getUint16(p + 8, true);
		const method = view.getUint16(p + 10, true);
		const crc = view.getUint32(p + 16, true);
		const csize = view.getUint32(p + 20, true);
		const usize = view.getUint32(p + 24, true);
		const nlen = view.getUint16(p + 28, true);
		const xlen = view.getUint16(p + 30, true);
		const clen = view.getUint16(p + 32, true);
		const offset = view.getUint32(p + 42, true);
		if (p + 46 + nlen > eocd) throw new ZipError('the archive’s directory is damaged');
		let name: string;
		try {
			name = dec.decode(bytes.subarray(p + 46, p + 46 + nlen));
		} catch {
			throw new ZipError('a file name isn’t valid text');
		}
		p += 46 + nlen + xlen + clen;
		if (name.endsWith('/')) continue; // folder entries carry nothing
		const bad = unsafeZipPath(name);
		if (bad) throw new ZipError(`unsafe file name “${name}” (${bad})`);
		const key = name.toLowerCase();
		if (seen.has(key)) throw new ZipError(`“${name}” appears twice`);
		seen.add(key);
		if (flags & 0x1) throw new ZipError(`“${name}” is encrypted`);
		if (method !== 0 && method !== 8) throw new ZipError(`“${name}” uses an unsupported compression`);
		if (method === 0 && csize !== usize) throw new ZipError(`“${name}” is damaged`);
		if (usize > limits.maxEntryBytes) throw new ZipError(`“${name}” is too large`);
		if (usize > 1024 * 1024 && csize > 0 && usize / csize > limits.maxRatio) throw new ZipError(`“${name}” expands suspiciously (possible decompression bomb)`);
		total += usize;
		if (total > limits.maxTotalBytes) throw new ZipError('the archive is too large to open');
		if (offset + 30 > cdOffset) throw new ZipError(`“${name}” is damaged`);
		out.push({ path: name, size: usize, compressedSize: csize, method, crc, offset });
	}
	return out;
}

/** One entry's bytes, checked against its size and CRC-32. */
export async function readZipEntry(bytes: Uint8Array, e: ZipEntryInfo): Promise<Uint8Array> {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	if (view.getUint32(e.offset, true) !== 0x04034b50) throw new ZipError(`“${e.path}” is damaged`);
	const nlen = view.getUint16(e.offset + 26, true);
	const xlen = view.getUint16(e.offset + 28, true);
	const start = e.offset + 30 + nlen + xlen;
	// The local header must agree with the directory (0.26): name, method, and checksum and
	// sizes unless they come after the data (flag bit 3, written by some tools).
	if (e.offset + 30 + nlen > bytes.length) throw new ZipError(`“${e.path}” is cut off`);
	const localName = bytes.subarray(e.offset + 30, e.offset + 30 + nlen);
	const want = new TextEncoder().encode(e.path);
	if (localName.length !== want.length || localName.some((b, i) => b !== want[i])) throw new ZipError(`“${e.path}” is damaged (its headers disagree)`);
	if (view.getUint16(e.offset + 8, true) !== e.method) throw new ZipError(`“${e.path}” is damaged (its headers disagree)`);
	if (!(view.getUint16(e.offset + 6, true) & 0x8)) {
		if (view.getUint32(e.offset + 14, true) !== e.crc || view.getUint32(e.offset + 18, true) !== e.compressedSize || view.getUint32(e.offset + 22, true) !== e.size) throw new ZipError(`“${e.path}” is damaged (its headers disagree)`);
	}
	if (start + e.compressedSize > bytes.length) throw new ZipError(`“${e.path}” is cut off`);
	const raw = bytes.subarray(start, start + e.compressedSize);
	let data: Uint8Array;
	if (e.method === 0) data = raw.slice();
	else {
		if (!hasStreams()) throw new ZipError('this device can’t decompress archives');
		data = await inflateRaw(raw, e.size);
	}
	if (data.length !== e.size) throw new ZipError(`“${e.path}” has the wrong size`);
	if (crc32(data) !== e.crc) throw new ZipError(`“${e.path}” is corrupted (checksum mismatch)`);
	return data;
}

/** Every entry, path → bytes (checked). */
export async function unzip(bytes: Uint8Array, limits: ZipLimits = DEFAULT_ZIP_LIMITS): Promise<Map<string, Uint8Array>> {
	const out = new Map<string, Uint8Array>();
	for (const e of listZip(bytes, limits)) out.set(e.path, await readZipEntry(bytes, e));
	return out;
}

// ── hashing ─────────────────────────────────────────────────────────────────

/** SHA-256 as lowercase hex, through the platform's Web Crypto. */
export async function sha256Hex(data: Uint8Array): Promise<string> {
	const buf = await crypto.subtle.digest('SHA-256', data as unknown as ArrayBuffer);
	return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
