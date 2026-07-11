import { parseHTML } from "linkedom";
import type { TitleExtractor, TitleExtractorParams } from "./types.ts";

/**
 * Extract chapter titles from <h1> or <h2> elements in the XHTML body.
 *
 * This is a fallback for books without NCX entries or with missing
 * NCX titles for some chapters (e.g. front/back matter).
 *
 * Strategy: For each XHTML file, find the first <h1> or <h2>
 * in the body and use its text content as the title.
 * Returns null for files where no heading is found.
 */
export class HeadingTitleExtractor implements TitleExtractor {
  readonly name = "heading";

  async extract(params: TitleExtractorParams): Promise<Map<string, string>> {
    const titles = new Map<string, string>();

    for (const [href, html] of params.xhtmlFiles) {
      const { document } = parseHTML(html);
      const body = document.querySelector("body");
      if (!body) continue;

      // Find first h1 or h2
      const heading =
        body.querySelector("h1") || body.querySelector("h2");
      if (!heading) continue;

      const text = (heading.textContent || "").trim();
      if (!text) continue;

      titles.set(href, text);
    }

    return titles;
  }
}
