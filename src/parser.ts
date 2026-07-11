import type { ParsedBook, ParsedChapter, Block } from "./types.ts";
import type { ParseOptions } from "./config.ts";
import { DEFAULT_PARSE_OPTIONS } from "./config.ts";

import { EpubZip } from "./epub/zip.ts";
import { getOpfPath } from "./epub/container.ts";
import { parseOpf } from "./epub/opf.ts";
import type { TitleExtractorParams } from "./extractors/title/types.ts";
import type { ImageResolverContext } from "./extractors/image/types.ts";

// ─── Public API ─────────────────────────────────────────────────────

/**
 * Parse an EPUB file into structured chapters with interleaved
 * text and image blocks.
 *
 * Uses pluggable extractors for title resolution, image resolution,
 * and block extraction — pass a custom `ParseOptions` to override
 * any strategy.
 *
 * @param filePath — path to the .epub file
 * @param options — optional strategy overrides (all fields have safe defaults)
 */
export async function parseEpub(
  filePath: string,
  options?: Partial<ParseOptions>,
): Promise<ParsedBook> {
  const opts: ParseOptions = {
    titleExtractor: options?.titleExtractor ?? DEFAULT_PARSE_OPTIONS.titleExtractor,
    imageResolver: options?.imageResolver ?? DEFAULT_PARSE_OPTIONS.imageResolver,
    blockExtractor: options?.blockExtractor ?? DEFAULT_PARSE_OPTIONS.blockExtractor,
    debug: options?.debug ?? DEFAULT_PARSE_OPTIONS.debug,
  };
  const zip = new EpubZip(filePath);

  // ── 1. Locate and parse OPF ──────────────────────────────────────
  const opfRel = getOpfPath(zip);
  const opfXml = zip.readText(opfRel);
  if (!opfXml) {
    throw new Error(`OPF file not found at ${opfRel}`);
  }
  const opf = parseOpf(opfXml, opfRel);

  // Metadata
  const bookTitle = opfXml.match(/<dc:title[^>]*>([^<]*)<\/dc:title>/i)?.[1] || "Unknown";
  const bookAuthor = opfXml.match(/<dc:creator[^>]*>([^<]*)<\/dc:creator>/i)?.[1] || "Unknown";

  // ── 2. Build XHTML content map (for title extractors) ────────────
  const xhtmlFiles = new Map<string, string>();
  const spineMap: { href: string; itemId: string }[] = [];

  for (const sp of opf.spine) {
    const item = opf.manifest.get(sp.idref);
    if (!item) continue;
    if (!item.mediaType.includes("xhtml") && !item.mediaType.includes("html")) continue;

    const xhtmlPath = zip.resolvePath(opf.opfDir, item.href);
    const html = zip.readText(xhtmlPath);
    if (!html) continue;

    xhtmlFiles.set(item.href, html);
    spineMap.push({ href: xhtmlPath, itemId: sp.idref });
  }

  // ── 3. Extract chapter titles ────────────────────────────────────
  const titleParams: TitleExtractorParams = { zip, opf, opfXml, xhtmlFiles };
  const titleMap = await opts.titleExtractor.extract(titleParams);

  if (opts.debug) {
    console.error(`[parser] title strategy: ${opts.titleExtractor.name}`);
    for (const [href, t] of titleMap) {
      console.error(`[title] ${href} → "${t}"`);
    }
  }

  // ── 4. Process spine → blocks ────────────────────────────────────
  const chapters: ParsedChapter[] = [];
  let chapterIndex = 0;

  for (const { href: xhtmlPath, itemId } of spineMap) {
    const item = opf.manifest.get(itemId);
    if (!item) continue;

    const html = zip.readText(xhtmlPath);
    if (!html) continue;

    // Extract raw blocks (text + image references)
    const rawBlocks = opts.blockExtractor.extract(html);
    if (rawBlocks.length === 0) continue;

    // Resolve title
    const chapterTitle = decodeEntities(titleMap.get(item.href) || `Chapter ${chapterIndex + 1}`);

    // Resolve image blocks → include binary data
    const blocks: Block[] = rawBlocks.map((b, i) => {
      if (b.type === "text") {
        return {
          type: "text",
          id: `c${chapterIndex}-${i}`,
          content: b.content,
          charCount: b.content.length,
          chapterIndex,
          position: i,
        } as const;
      }

      // Resolve image
      const imgCtx: ImageResolverContext = {
        zip,
        opf,
        src: b.content,
        xhtmlPath,
      };
      const data = opts.imageResolver.resolve(imgCtx);

      if (opts.debug && !data) {
        console.error(`[image] ${opts.imageResolver.name} failed: ${b.content}`);
      }

      return {
        type: "image",
        id: `c${chapterIndex}-${i}`,
        src: b.content,
        alt: "",
        data,
        chapterIndex,
        position: i,
      } as const;
    });

    chapters.push({
      index: chapterIndex,
      title: chapterTitle,
      blocks,
    });
    chapterIndex++;
  }

  return { title: decodeEntities(bookTitle), author: decodeEntities(bookAuthor), chapters };
}

// ─── Helpers ─────────────────────────────────────────────────────────

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#821[67];/g, "'")
    .replace(/&#821[12];/g, "–")
    .replace(/&#821[23];/g, "—")
    .replace(/&#8230;/g, "…")
    .replace(/&#x201[89];/g, "'")
    .replace(/&#x201[34];/g, "–")
    .replace(/&#x2014;/g, "—")
    .replace(/&#x2026;/g, "…")
    .replace(/&#160;/g, " ")
    .replace(/&#x00A0;/g, " ");
}
