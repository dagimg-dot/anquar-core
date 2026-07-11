/**
 * Parse the NCX (Navigation Control XML) file.
 *
 * The NCX is the EPUB2 standard for tables of contents.
 * It maps chapter/section titles to content document hrefs.
 *
 * Note: EPUB3 uses nav.xhtml instead — if NCX is missing,
 * we just return an empty map and let other strategies handle it.
 */

import { decodeEntities } from "../utils/entities.ts";

const NCX_REGEX =
  /<navPoint[^>]*>[\s\S]*?<text>([^<]*)<\/text>[\s\S]*?<content[^>]*src="([^"]*)"[\s\S]*?<\/navPoint>/gi;

/**
 * Parse the NCX XML into a filename → title map.
 * The key is the base filename (anchor stripped, e.g. "chapter-1.xhtml").
 * HTML entities in titles are decoded.
 *
 * @param ncxXml — raw XML of the toc.ncx file
 * @returns a map of href → title (href is relative to OPF dir, anchor stripped)
 */
export function parseNcx(ncxXml: string): Map<string, string> {
  const titles = new Map<string, string>();

  let m: RegExpExecArray | null;
  while ((m = NCX_REGEX.exec(ncxXml)) !== null) {
    const title = decodeEntities(m[1].trim());
    const href = m[2].split("#")[0]; // strip anchor
    if (!titles.has(href)) {
      titles.set(href, title);
    }
  }

  return titles;
}
