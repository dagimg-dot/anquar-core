import type { TitleExtractor, TitleExtractorParams } from "./types.ts";

/**
 * Title chain — tries multiple extractors in order and uses
 * the first successful result per chapter.
 *
 * This is the default strategy. It combines:
 *   1. NCX (most reliable for EPUB2 — has publisher-provided titles)
 *   2. Heading (fallback — scrapes h1/h2 from content)
 *   3. (Future) NAV, filename-based, etc.
 *
 * Each extractor in the chain is called once. Results are merged
 * with first-wins semantics — if NCX provides a title for a chapter,
 * the heading extractor's result for that chapter is ignored.
 */
export class TitleChain implements TitleExtractor {
  readonly name = "chain";

  constructor(private extractors: TitleExtractor[]) {}

  async extract(params: TitleExtractorParams): Promise<Map<string, string>> {
    const merged = new Map<string, string>();

    for (const ext of this.extractors) {
      const titles = await ext.extract(params);
      for (const [href, title] of titles) {
        if (!merged.has(href)) {
          merged.set(href, title);
        }
      }
    }

    return merged;
  }
}
