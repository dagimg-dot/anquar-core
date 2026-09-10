import AdmZip from "adm-zip";
import type { ParseOptions } from "./config.ts";
import { DEFAULT_PARSE_OPTIONS } from "./config.ts";
import { EpubZip } from "./epub/zip.ts";
import { parseEpubFromZip } from "./parser.ts";
import type { ParsedBook } from "./types.ts";

export * from "./anquar-core.ts";

/**
 * Parse an EPUB from a file path or raw bytes.
 *
 * Node/Bun only — it reaches for AdmZip, which is why it lives behind the
 * `anquar-core/node` entry point rather than the main one. Browsers use
 * `parseEpubFromFile`.
 *
 * Uses pluggable extractors for title resolution, image resolution, and block
 * extraction — pass a custom `ParseOptions` to override any strategy.
 */
export async function parseEpub(
	input: string | Uint8Array,
	options?: Partial<ParseOptions>,
): Promise<ParsedBook> {
	const opts: ParseOptions = { ...DEFAULT_PARSE_OPTIONS, ...options };
	const zip = EpubZip.fromAdmZip(
		typeof input === "string"
			? new AdmZip(input)
			: new AdmZip(input as unknown as Buffer),
	);
	return parseEpubFromZip(zip, opts);
}
