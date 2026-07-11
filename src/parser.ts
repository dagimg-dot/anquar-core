import type { ParsedBook, ParsedChapter, Block } from "./types.ts";
import type { ParseOptions } from "./config.ts";
import { DEFAULT_PARSE_OPTIONS } from "./config.ts";

import { EpubZip } from "./epub/zip.ts";
import { getOpfPath } from "./epub/container.ts";
import { parseOpf } from "./epub/opf.ts";
import type { TitleExtractorParams } from "./extractors/title/types.ts";
import type { ImageResolverContext } from "./extractors/image/types.ts";
import type { StyleMapping } from "./extractors/block/types.ts";
import { decodeEntities } from "./utils/entities.ts";

/** Minimal CSS class → style parser. */
function parseCssMap(css: string): Map<string, StyleMapping> {
  const map = new Map<string, StyleMapping>();
  const ruleRe = /\.([a-zA-Z0-9_-]+)\s*\{([^}]+)\}/g;
  let m: RegExpExecArray | null;
  while ((m = ruleRe.exec(css)) !== null) {
    const cls = m[1];
    const body = m[2];
    const bold = /\bfont-weight\s*:\s*bold\b/i.test(body);
    const italic = /\bfont-style\s*:\s*italic\b/i.test(body);
    if (bold || italic) map.set(cls, { bold, italic });
  }
  return map;
}

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

  // 1. Locate and parse OPF
  const opfRel = getOpfPath(zip);
  const opfXml = zip.readText(opfRel);
  if (!opfXml) {
    throw new Error(`OPF file not found at ${opfRel}`);
  }
  const opf = parseOpf(opfXml, opfRel);

  const bookTitle = opfXml.match(/<dc:title[^>]*>([^<]*)<\/dc:title>/i)?.[1] || "Unknown";
  const bookAuthor = opfXml.match(/<dc:creator[^>]*>([^<]*)<\/dc:creator>/i)?.[1] || "Unknown";

  // 2. Build XHTML content map (for title extractors)
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

  // 2b. Build CSS class → style map from all CSS files in the manifest
  const cssMap = new Map<string, StyleMapping>();
  for (const item of opf.manifest.values()) {
    if (item.mediaType === "text/css") {
      const cssPath = zip.resolvePath(opf.opfDir, item.href);
      const css = zip.readText(cssPath);
      if (css) {
        const parsed = parseCssMap(css);
        for (const [k, v] of parsed) {
          if (!cssMap.has(k)) cssMap.set(k, v);
        }
      }
    }
  }

  // 3. Extract chapter titles
  const titleParams: TitleExtractorParams = { zip, opf, opfXml, xhtmlFiles };
  const titleMap = await opts.titleExtractor.extract(titleParams);

  if (opts.debug) {
    console.error(`[parser] title strategy: ${opts.titleExtractor.name}`);
    for (const [href, t] of titleMap) {
      console.error(`[title] ${href} → "${t}"`);
    }
  }

  // 4. Process spine → blocks
  const chapters: ParsedChapter[] = [];
  let chapterIndex = 0;

  for (const { href: xhtmlPath, itemId } of spineMap) {
    const item = opf.manifest.get(itemId);
    if (!item) continue;

    const html = zip.readText(xhtmlPath);
    if (!html) continue;

    const rawBlocks = opts.blockExtractor.extract(html, cssMap);
    if (rawBlocks.length === 0) continue;

    const chapterTitle = decodeEntities(titleMap.get(item.href) || `Chapter ${chapterIndex + 1}`);

    const blocks: Block[] = rawBlocks.map((b, i) => {
      if (b.type === "text") {
        return {
          type: "text",
          id: `c${chapterIndex}-${i}`,
          content: b.content,
          runs: b.runs,
          charCount: b.content.length,
          chapterIndex,
          position: i,
        } as const;
      }

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
