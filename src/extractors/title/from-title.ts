import { parseHTML } from "linkedom";
import type { TitleExtractor, TitleExtractorParams } from "./types.ts";

/**
 * Extract chapter titles from <title> tags in XHTML.
 *
 * Some publishers put chapter numbers or names in <title>
 * but not in visible <h1>/<h2> elements.
 *
 * Strategy: For each XHTML file, extract the <title> element
 * content and use it if it looks like a meaningful title
 * (not just the book name repeated).
 *
 * Falls back to null for files where:
 *  - The <title> is identical to the book title (likely front/back matter)
 *  - The <title> is empty
 */
const MAX_TITLE_LENGTH = 60;

export class TitleTagExtractor implements TitleExtractor {
  readonly name = "title-tag";

  async extract(params: TitleExtractorParams): Promise<Map<string, string>> {
    const titles = new Map<string, string>();

    // Try to detect the book title so we can skip files that just repeat it
    const bookTitle = this.guessBookTitle(params);

    for (const [href, html] of params.xhtmlFiles) {
      const { document } = parseHTML(html);
      const titleEl = document.querySelector("title");
      if (!titleEl) continue;

      const text = (titleEl.textContent || "").trim();
      if (!text) continue;

      // Skip boilerplate: book title repeated, file names, "Untitled"
      if (this.isBoilerplate(text, bookTitle, href)) continue;

      titles.set(href, text);
    }

    return titles;
  }

  private guessBookTitle(params: TitleExtractorParams): string {
    const dcTitle = params.opfXml.match(/<dc:title[^>]*>([^<]*)<\/dc:title>/i);
    return (dcTitle?.[1] || "").trim().toLowerCase();
  }

  private isBoilerplate(text: string, bookTitle: string, href: string): boolean {
    const lower = text.toLowerCase();
    if (lower === bookTitle) return true;
    if (lower === "untitled") return true;
    // Single dots, dashes, or empty
    if (/^[.\s-]+$/.test(text)) return true;
    // Filename-like titles
    if (
      text ===
      href
        .split("/")
        .pop()
        ?.replace(/\.x?html?$/, "")
    )
      return true;
    if (text.length > MAX_TITLE_LENGTH) return true;
    return false;
  }
}
