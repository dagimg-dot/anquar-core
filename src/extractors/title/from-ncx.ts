import { parseNcx } from "../../epub/ncx.ts";
import type { TitleExtractor, TitleExtractorParams } from "./types.ts";

const NCX_PATHS = ["toc.ncx", "OEBPS/toc.ncx"];

/**
 * Extract chapter titles from the EPUB2 NCX (Navigation Control XML).
 *
 * This is the most reliable source for EPUB2 books — publishers
 * are required to include an NCX with proper chapter titles.
 *
 * Strategy: Look for toc.ncx in common locations and parse it.
 * Returns an href → title map from the NCX <navPoint> entries.
 */
export class NcxTitleExtractor implements TitleExtractor {
  readonly name = "ncx";

  async extract(params: TitleExtractorParams): Promise<Map<string, string>> {
    const titles = new Map<string, string>();

    // Try known NCX paths
    for (const path of NCX_PATHS) {
      const ncxXml = params.zip.readText(path);
      if (!ncxXml) continue;

      const ncxTitles = parseNcx(ncxXml);
      // Resolve relative hrefs against the NCX location
      const ncxDir = params.zip.dirname(path);
      for (const [href, title] of ncxTitles) {
        const resolved = ncxDir ? params.zip.resolvePath(ncxDir, href) : href;
        if (!titles.has(resolved)) {
          titles.set(resolved, title);
        }
      }
      break; // Use first NCX found
    }

    return titles;
  }
}
