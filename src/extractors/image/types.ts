import type { ParsedOpf } from "../../epub/opf.ts";
import type { EpubZip } from "../../epub/zip.ts";

/**
 * Context for resolving an <img src=""> to binary bytes.
 */
export interface ImageResolverContext {
	zip: EpubZip;
	opf: ParsedOpf;
	/** The <img src> attribute value (as it appears in XHTML). */
	src: string;
	/** Path of the XHTML file containing this <img> tag, relative to ZIP root. */
	xhtmlPath: string;
}

/**
 * An image resolver converts an <img src> attribute into
 * the image's binary content (bytes).
 *
 * Multiple strategies exist because different EPUBs use
 * different path conventions:
 *   - Some resolve relative to OPF dir (standard)
 *   - Some resolve relative to the XHTML file (common)
 *   - Some use absolute paths within the ZIP
 *   - Some embed images as base64 data URIs
 */
export interface ImageResolver {
	readonly name: string;
	resolve(ctx: ImageResolverContext): Uint8Array | null;
}
