import type { ImageResolver, ImageResolverContext } from "./types.ts";

/**
 * Image chain — tries multiple resolvers in order and returns
 * the first successful result.
 */
export class ImageChain implements ImageResolver {
	readonly name = "chain";

	private readonly resolvers: ImageResolver[];

	constructor(resolvers: ImageResolver[]) {
		this.resolvers = resolvers;
	}

	resolve(ctx: ImageResolverContext): Uint8Array | null {
		for (const r of this.resolvers) {
			const bytes = r.resolve(ctx);
			if (bytes) return bytes;
		}
		return null;
	}
}
