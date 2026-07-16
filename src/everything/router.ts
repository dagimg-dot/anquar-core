import type { ParsedBook, ParsedArticle, ChunkConfig } from "../types.ts";
import { DEFAULT_CHUNK_CONFIG } from "../types.ts";
import { parseEpub } from "../parser.ts";
import { parseArticle, type ArticleOptions } from "./article.ts";
import type { ParseOptions } from "../config.ts";

export type DocumentResult =
  { type: "epub"; data: ParsedBook } | { type: "article"; data: ParsedArticle };

export interface DocumentOptions {
  /** EPUB-specific parse options. */
  epub?: Partial<ParseOptions>;
  /** Article-specific parse options. */
  article?: ArticleOptions;
  /** Shared chunk config (applied to both EPUBs and articles). */
  chunkConfig?: ChunkConfig;
}

/**
 * Auto-detect input type and route to the correct parser.
 *
 * - `string` ending in `.epub` → EPUB
 * - `string` starting with `http://` or `https://` → article
 * - `Uint8Array` → EPUB (bytes)
 * - `{ html: string }` → article (raw HTML)
 */
export function parseDocument(
  input: string | Uint8Array | { html: string },
  options?: DocumentOptions,
): Promise<DocumentResult>;

export async function parseDocument(
  input: string | Uint8Array | { html: string },
  options?: DocumentOptions,
): Promise<DocumentResult> {
  const bookConfig = options?.chunkConfig ?? DEFAULT_CHUNK_CONFIG;

  if (isEpubInput(input)) {
    const book = await parseEpub(input, options?.epub);
    return { type: "epub", data: book };
  }

  const article = await parseArticle(input as string | { html: string }, {
    ...options?.article,
    chunkConfig: bookConfig,
  });
  return { type: "article", data: article };
}

function isEpubInput(input: string | Uint8Array | { html: string }): input is string | Uint8Array {
  if (input instanceof Uint8Array) return true;
  if (typeof input === "string") {
    const lower = input.toLowerCase();
    return lower.endsWith(".epub") || !lower.startsWith("http");
  }
  return false;
}
