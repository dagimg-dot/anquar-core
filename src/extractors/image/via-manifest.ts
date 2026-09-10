import type { ImageResolver, ImageResolverContext } from "./types.ts";

/**
 * Resolve images by looking up the <img src> in the OPF manifest,
 * resolving the path relative to the OPF directory.
 *
 * This is the EPUB standard convention — all file references
 * in content documents should be resolvable via the manifest.
 */
export class ManifestImageResolver implements ImageResolver {
	readonly name = "manifest";

	resolve(ctx: ImageResolverContext): Uint8Array | null {
		const { zip, opf, src } = ctx;

		const opfPath = zip.resolvePath(opf.opfDir, src);
		const bytes = zip.readBinary(opfPath);
		if (bytes) return bytes;

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
