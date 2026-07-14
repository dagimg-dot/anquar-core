import type { EpubZip } from "../../epub/zip.ts";
import type { ParsedOpf } from "../../epub/opf.ts";

/**
 * Context passed to title extractors.
 * Provides access to all EPUB resources the extractor might need.
 */
export interface TitleExtractorParams {
  zip: EpubZip;
  opf: ParsedOpf;
  /** All XHTML content documents keyed by their manifest href. */
  xhtmlFiles: Map<string, string>;
}

/**
 * A title extractor determines chapter/section titles for
 * each XHTML content document.
 *
 * @returns a Map of manifest href → chapter title.
 *   Only include entries for which the extractor can provide a title.
 *   The chain merges multiple extractors' results (first wins).
 */
export interface TitleExtractor {
  readonly name: string;
  extract(params: TitleExtractorParams): Promise<Map<string, string>>;
}
