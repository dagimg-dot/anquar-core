import { parseHTML } from "linkedom";
import { Readability } from "@mozilla/readability";
import type { ParsedArticle, Block, ChunkConfig } from "../types.ts";
import { DEFAULT_CHUNK_CONFIG } from "../types.ts";
import { chunkBlocks } from "../chunker.ts";
import { DomWalkerBlockExtractor } from "../extractors/block/dom-walker.ts";
import { decodeEntities } from "../utils/entities.ts";

/**
 * Options for article parsing.
 */
export interface ArticleOptions {
  /** Chunking config. Defaults to 80–300 chars. */
  chunkConfig?: ChunkConfig;
  /** User-agent for HTTP fetch. */
  userAgent?: string;
}

const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Linux; Android 14; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Mobile Safari/537.36";

/**
 * Parse a blog post/article into an Anquar article.
 *
 * Accepts either:
 *   - A URL string (fetched and parsed live)
 *   - An object with raw HTML + optional metadata overrides
 */
export async function parseArticle(
  input: string | { html: string; url?: string; title?: string; author?: string },
  options?: ArticleOptions,
): Promise<ParsedArticle> {
  const config = options?.chunkConfig ?? DEFAULT_CHUNK_CONFIG;

  let html: string;
  let url: string;
  let titleOverride: string | undefined;
  let authorOverride: string | undefined;

  if (typeof input === "string") {
    url = input;
    const resp = await fetch(url, {
      headers: { "User-Agent": options?.userAgent ?? DEFAULT_USER_AGENT },
    });
    if (!resp.ok) {
      throw new Error(`Failed to fetch ${url}: ${resp.status} ${resp.statusText}`);
    }
    html = await resp.text();
  } else {
    html = input.html;
    url = input.url ?? "";
    titleOverride = input.title;
    authorOverride = input.author;
  }

  const { document: rawDoc } = parseHTML(html);
  const reader = new Readability(rawDoc);
  const article = reader.parse();

  if (!article || !article.content) {
    throw new Error("Could not extract article content – page may not be reader-able");
  }

  // Readability returns a fragment; wrap so linkedom body populates for the walker.
  const wrappedHtml = `<!DOCTYPE html><html><body>${article.content}</body></html>`;
  const extractor = new DomWalkerBlockExtractor();
  const rawBlocks = extractor.extract(wrappedHtml, new Map());

  const blocks: Block[] = rawBlocks.map((b, i) => {
    if (b.type === "text") {
      return {
        type: "text",
        id: `a-${i}`,
        content: b.content,
        runs: b.runs,
        charCount: b.content.length,
        chapterIndex: 0,
        position: i,
      } as const;
    }
    return {
      type: "image",
      id: `a-${i}`,
      src: b.content,
      alt: b.alt,
      data: null,
      chapterIndex: 0,
      position: i,
    } as const;
  });

  const chunked = chunkBlocks(blocks, 0, config);

  return {
    title: decodeEntities(titleOverride ?? article.title ?? ""),
    author: decodeEntities(authorOverride ?? article.byline ?? ""),
    siteName: article.siteName ?? "",
    url,
    published: article.publishedTime ?? undefined,
    blocks: chunked,
  };
}
