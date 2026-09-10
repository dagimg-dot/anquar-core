import type { ImageResolver, ImageResolverContext } from "./types.ts";

/**
 * Image chain — tries multiple resolvers in order and returns
 * the first successful result.
 *
 * Default order:
 *   1. via-manifest (standards-compliant EPUBs)
 *   2. via-relative (EPUBs with paths relative to XHTML)
 *   3. (Future) via-base64 (embedded data URIs)
 */
export class ImageChain implements ImageResolver {
	readonly name = "chain";

	constructor(private resolvers: ImageResolver[]) {}

	resolve(ctx: ImageResolverContext): Uint8Array | null {
		for (const r of this.resolvers) {
			const bytes = r.resolve(ctx);
			if (bytes) return bytes;
		}
		return null;
	}
}
