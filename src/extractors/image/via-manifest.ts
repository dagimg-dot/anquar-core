import type { ImageResolver, ImageResolverContext } from "./types.ts";

/**
 * Resolve images by looking up the <img src> in the OPF manifest,
 * resolving the path relative to the OPF directory.
 *
 * This is the EPUB standard convention — all file references
 * in content documents should be resolvable via the manifest.
 *
 * Strategy:
 *   1. Try the raw src as a manifest href lookup
 *   2. Try resolving the src relative to the OPF directory
 *   3. Try matching by filename only (last path segment)
 */
export class ManifestImageResolver implements ImageResolver {
	readonly name = "manifest";

	resolve(ctx: ImageResolverContext): Uint8Array | null {
		const { zip, opf, src } = ctx;

		// 1. Try resolving relative to OPF dir
		const opfPath = zip.resolvePath(opf.opfDir, src);
		const bytes = zip.readBinary(opfPath);
		if (bytes) return bytes;

		// 2. Try matching by filename in manifest
		const filename = src.split("/").pop();
		if (filename) {
			for (const item of opf.manifest.values()) {
				if (item.href.endsWith(filename)) {
					const itemPath = zip.resolvePath(opf.opfDir, item.href);
					const b = zip.readBinary(itemPath);
					if (b) return b;
				}
			}
		}

		return null;
	}
}
