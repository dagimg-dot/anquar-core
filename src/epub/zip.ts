import AdmZip from "adm-zip";

interface ZipEntry {
	text: string;
	binary: Uint8Array | null;
}

/** Structural view of a JSZip instance, so this file needs no JSZip dependency. */
interface JSZipEntry {
	dir: boolean;
	async(type: "string"): Promise<string>;
	async(type: "arraybuffer"): Promise<ArrayBuffer>;
}

export interface JSZipLike {
	files: Record<string, JSZipEntry>;
}

/**
 * Unified ZIP reader that works with both AdmZip (Node/Bun) and JSZip (browser).
 *
 * All access methods are synchronous — the JSZip path pre-loads every
 * entry into memory before any method is called.
 *
 * @example
 *   // Node / Bun
 *   const zip = EpubZip.fromPath("book.epub");
 *
 *   // Browser
 *   const JSZip = await import("jszip");
 *   const zip = await EpubZip.fromJSZip(await JSZip.loadAsync(file));
 */
export class EpubZip {
	private entries = new Map<string, ZipEntry>();

	private constructor() {}

	/** Create from a file path (Node/Bun) or raw bytes. Uses AdmZip internally. */
	static fromPath(input: string | Uint8Array): EpubZip {
		const result = new EpubZip();
		const zip =
			typeof input === "string"
				? new AdmZip(input)
				: new AdmZip(input as unknown as Buffer);
		for (const entry of zip.getEntries()) {
			if (!entry.isDirectory) {
				const buf = entry.getData();
				result.entries.set(entry.entryName, {
					text: buf.toString("utf-8"),
					binary: buf,
				});
			}
		}
		return result;
	}

	/** Create from a JSZip instance (browser). */
	static async fromJSZip(jsZip: JSZipLike): Promise<EpubZip> {
		const result = new EpubZip();
		const promises: Promise<void>[] = [];
		for (const name of Object.keys(jsZip.files)) {
			const file = jsZip.files[name];
			if (file.dir) continue;
			promises.push(
				(async () => {
					const text = await file.async("string");
					const ab = await file.async("arraybuffer");
					result.entries.set(name, { text, binary: new Uint8Array(ab) });
				})(),
			);
		}
		await Promise.all(promises);
		return result;
	}

	/** Read a file as text. Returns empty string if not found. */
	readText(path: string): string {
		return this.entries.get(path)?.text ?? "";
	}

	/** Read a file as binary. Returns null if not found. */
	readBinary(path: string): Uint8Array | null {
		return this.entries.get(path)?.binary ?? null;
	}

	/** Check if a path exists. */
	has(path: string): boolean {
		return this.entries.has(path);
	}

	/** List entries matching a prefix. */
	list(prefix: string): string[] {
		const result: string[] = [];
		for (const key of this.entries.keys()) {
			if (key.startsWith(prefix)) result.push(key);
		}
		return result.sort();
	}

	/** Normalise a relative path against a base directory. */
	resolvePath(base: string, rel: string): string {
		if (rel.startsWith("/")) return rel.slice(1);
		const p = rel.startsWith("./") ? rel.slice(2) : rel;
		const parts = (base + p).split("/").filter(Boolean);
		const out: string[] = [];
		for (const seg of parts) {
			if (seg === "..") out.pop();
			else if (seg !== ".") out.push(seg);
		}
		return out.join("/");
	}

	/** Directory part of a path. */
	dirname(path: string): string {
		const i = path.lastIndexOf("/");
		return i >= 0 ? path.slice(0, i + 1) : "";
	}
}
