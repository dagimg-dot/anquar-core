import { DomWalkerBlockExtractor } from "./extractors/block/dom-walker.ts";
import type { BlockExtractor } from "./extractors/block/types.ts";
import { ImageChain } from "./extractors/image/chain.ts";
import type { ImageResolver } from "./extractors/image/types.ts";
import { ManifestImageResolver } from "./extractors/image/via-manifest.ts";
import { RelativeImageResolver } from "./extractors/image/via-relative.ts";
import { TitleChain } from "./extractors/title/chain.ts";
import { HeadingTitleExtractor } from "./extractors/title/from-heading.ts";
import { NavTitleExtractor } from "./extractors/title/from-nav.ts";
import { NcxTitleExtractor } from "./extractors/title/from-ncx.ts";
import { TitleTagExtractor } from "./extractors/title/from-title.ts";
import type { TitleExtractor } from "./extractors/title/types.ts";

export interface ParseOptions {
	titleExtractor: TitleExtractor;
	imageResolver: ImageResolver;
	blockExtractor: BlockExtractor;
	debug: boolean;
}

const DEFAULT_TITLE_EXTRACTOR = new TitleChain([
	new NcxTitleExtractor(),
	new NavTitleExtractor(),
	new HeadingTitleExtractor(),
	new TitleTagExtractor(),
]);

const DEFAULT_IMAGE_RESOLVER = new ImageChain([
	new ManifestImageResolver(),
	new RelativeImageResolver(),
]);

const DEFAULT_BLOCK_EXTRACTOR = new DomWalkerBlockExtractor();

export const DEFAULT_PARSE_OPTIONS: ParseOptions = {
	titleExtractor: DEFAULT_TITLE_EXTRACTOR,
	imageResolver: DEFAULT_IMAGE_RESOLVER,
	blockExtractor: DEFAULT_BLOCK_EXTRACTOR,
	debug: false,
};
