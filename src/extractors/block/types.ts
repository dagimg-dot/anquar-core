import type { StyleRun } from "../../types.ts";

/**
 * Raw block extracted from XHTML — before chapter assignment
 * and image binary resolution.
 */
export interface RawTextBlock {
  type: "text";
  content: string;
  runs: StyleRun[];
}

export interface RawImageBlock {
  type: "image";
  content: string; // img src
  alt: string;
}

export type RawBlock = RawTextBlock | RawImageBlock;

/** Class → style mapping extracted from CSS files. */
export interface StyleMapping {
  bold: boolean;
  italic: boolean;
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
  extract(html: string, cssMap?: Map<string, StyleMapping>): RawBlock[];
}
