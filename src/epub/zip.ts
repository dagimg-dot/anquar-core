interface ZipEntry {
	text: string;
	binary: Uint8Array | null;
}

/** Structural views of the two zip backends, so this file depends on neither. */
interface JSZipEntry {
	dir: boolean;
	async(type: "string"): Promise<string>;
	async(type: "arraybuffer"): Promise<ArrayBuffer>;
}

export interface JSZipLike {
	files: Record<string, JSZipEntry>;
}

interface AdmZipLike {
	getEntries(): {
		entryName: string;
		isDirectory: boolean;
		getData(): Uint8Array;
	}[];
}

/**
 * Unified ZIP reader that works with both AdmZip (Node/Bun) and JSZip (browser).
 *
 * All access methods are synchronous — the JSZip path pre-loads every
 * entry into memory before any method is called. Both backends are injected
 * by the caller so neither runtime's package reaches the other's bundle.
 *
 * @example
 *   // Node / Bun — see parseEpub in anquar-core/node
 *   const zip = EpubZip.fromAdmZip(new AdmZip("book.epub"));
 *
 *   // Browser
 *   const zip = await EpubZip.fromJSZip(await JSZip.loadAsync(file));
 */
export class EpubZip {
	private entries = new Map<string, ZipEntry>();

	private constructor() {}

	/** Create from an AdmZip instance (Node/Bun). */
	static fromAdmZip(zip: AdmZipLike): EpubZip {
		const result = new EpubZip();
		const decoder = new TextDecoder();
		for (const entry of zip.getEntries()) {
			if (entry.isDirectory) continue;
			const bytes = entry.getData();
			result.entries.set(entry.entryName, {
				text: decoder.decode(bytes),
				binary: bytes,
			});
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

	has(path: string): boolean {
		return this.entries.has(path);
	}

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

	dirname(path: string): string {
		const i = path.lastIndexOf("/");
		return i >= 0 ? path.slice(0, i + 1) : "";
	}
}
