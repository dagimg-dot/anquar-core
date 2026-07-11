import { parseNcx } from "../../epub/ncx.ts";
import type { TitleExtractor, TitleExtractorParams } from "./types.ts";

/**
 * Find the NCX file path from the OPF manifest.
 * Falls back to common paths if not found in manifest.
 */
function findNcxPath(params: TitleExtractorParams): string | null {
  // First, look in the OPF manifest for an item with NCX media-type
  for (const item of params.opf.manifest.values()) {
    if (item.mediaType === "application/x-dtbncx+xml") {
      return params.zip.resolvePath(params.opf.opfDir, item.href);
    }
  }
  // Fallback: try common locations
  for (const guess of ["toc.ncx", "OEBPS/toc.ncx"]) {
    if (params.zip.has(guess)) return guess;
  }
  return null;
}

/**
 * Normalise a path so it's relative to the OPF directory.
 * This ensures NCX-sourced keys match manifest hrefs.
 *
 * Example:
 *   opfDir = "OEBPS/" , path = "OEBPS/html/ch1.xhtml"
 *   → "html/ch1.xhtml"
 */
function stripOpfDir(opfDir: string, path: string): string {
  return path.startsWith(opfDir) ? path.slice(opfDir.length) : path;
}

/**
 * Extract chapter titles from the EPUB2 NCX (Navigation Control XML).
 *
 * This is the most reliable source for EPUB2 books — publishers
 * are required to include an NCX with proper chapter titles.
 *
 * Keys are normalised to match manifest hrefs (relative to OPF dir).
 */
export class NcxTitleExtractor implements TitleExtractor {
  readonly name = "ncx";

  async extract(params: TitleExtractorParams): Promise<Map<string, string>> {
    const titles = new Map<string, string>();

    const ncxPath = findNcxPath(params);
    if (!ncxPath) return titles;

    const ncxXml = params.zip.readText(ncxPath);
    if (!ncxXml) return titles;

    const ncxTitles = parseNcx(ncxXml);
    const ncxDir = params.zip.dirname(ncxPath);

    for (const [href, title] of ncxTitles) {
      const resolved = ncxDir ? params.zip.resolvePath(ncxDir, href) : href;
      const key = stripOpfDir(params.opf.opfDir, resolved);
      if (!titles.has(key)) {
        titles.set(key, title);
      }
    }

    return titles;
  }
}
