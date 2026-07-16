import type { ImageResolver } from "./types.ts";

/**
 * Resolver for image src attributes that are already absolute URLs.
 * Returns the URL as-is for the frontend to fetch.
 * Since we don't download images during parsing, data is always null.
 */
export const ViaAbsoluteResolver: ImageResolver = {
  name: "via-absolute",
  resolve(ctx) {
    return ctx.src.startsWith("http://") || ctx.src.startsWith("https://") ? null : null;
  },
};
