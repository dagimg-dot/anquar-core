/**
 * Raw block extracted from XHTML — before chapter assignment
 * and image binary resolution.
 */
export interface RawBlock {
  type: "text" | "image";
  content: string; // text content for text blocks, img src for image blocks
}

/**
 * A block extractor walks XHTML DOM and returns interleaved
 * text + image segments.
 *
 * Multiple implementations can exist (e.g. DOM-walker, regex-based,
 * streaming parser) as long as they implement this interface.
 */
export interface BlockExtractor {
  readonly name: string;
  extract(html: string): RawBlock[];
}
