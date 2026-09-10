import type { ImageResolver, ImageResolverContext } from "./types.ts";

/**
 * Resolve images by interpreting the <img src> relative to the
 * XHTML file's own location in the ZIP.
 *
 * Some EPUBs (especially those converted from other formats)
 * use paths relative to the content document rather than the OPF.
 * Example: XHTML at "OEBPS/chapter-1.xhtml" with
 * `src="../Images/foo.jpg"` → resolves to "Images/foo.jpg".
 *
 * Strategy:
 *   1. Resolve src relative to the XHTML file's directory
 *   2. Fall back to trying the raw src as-is
 */
export class RelativeImageResolver implements ImageResolver {
	readonly name = "relative";

	resolve(ctx: ImageResolverContext): Uint8Array | null {
		const { zip, xhtmlPath, src } = ctx;

		// 1. Resolve relative to XHTML file location
		const xhtmlDir = zip.dirname(xhtmlPath);
		const resolved = zip.resolvePath(xhtmlDir, src);
		const bytes = zip.readBinary(resolved);
		if (bytes) return bytes;

		// 2. Try raw src as-is
		if (src !== resolved) {
			const raw = zip.readBinary(src);
			if (raw) return raw;
		}

		return null;
	}
}
