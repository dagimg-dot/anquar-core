import type { BlockExtractor } from "./extractors/block/types.ts";
import type { TitleExtractor } from "./extractors/title/types.ts";
import type { ImageResolver } from "./extractors/image/types.ts";

import { DomWalkerBlockExtractor } from "./extractors/block/dom-walker.ts";
import { NcxTitleExtractor } from "./extractors/title/from-ncx.ts";
import { NavTitleExtractor } from "./extractors/title/from-nav.ts";
import { HeadingTitleExtractor } from "./extractors/title/from-heading.ts";
import { TitleTagExtractor } from "./extractors/title/from-title.ts";
import { TitleChain } from "./extractors/title/chain.ts";
import { ManifestImageResolver } from "./extractors/image/via-manifest.ts";
import { RelativeImageResolver } from "./extractors/image/via-relative.ts";
import { ImageChain } from "./extractors/image/chain.ts";

/**
 * Pluggable strategy selection for EPUB parsing.
 * Every field has a safe default — you only override what you want.
 */
export interface ParseOptions {
  /** How to extract chapter titles from XHTML documents. */
  titleExtractor: TitleExtractor;
  /** How to resolve <img src> attributes to binary bytes. */
  imageResolver: ImageResolver;
  /** How to walk XHTML DOM to extract text + image segments. */
  blockExtractor: BlockExtractor;
  /** Print extractor provenance to stderr. */
  debug: boolean;
}

export const DEFAULT_TITLE_EXTRACTOR = new TitleChain([
  new NcxTitleExtractor(),
  new NavTitleExtractor(),
  new HeadingTitleExtractor(),
  new TitleTagExtractor(),
]);

export const DEFAULT_IMAGE_RESOLVER = new ImageChain([
  new ManifestImageResolver(),
  new RelativeImageResolver(),
]);

export const DEFAULT_BLOCK_EXTRACTOR = new DomWalkerBlockExtractor();

export const DEFAULT_PARSE_OPTIONS: ParseOptions = {
  titleExtractor: DEFAULT_TITLE_EXTRACTOR,
  imageResolver: DEFAULT_IMAGE_RESOLVER,
  blockExtractor: DEFAULT_BLOCK_EXTRACTOR,
  debug: false,
};
