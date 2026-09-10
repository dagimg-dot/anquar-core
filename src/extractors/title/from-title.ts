import { parseHTML } from "linkedom";
import type { TitleExtractor, TitleExtractorParams } from "./types.ts";

/**
 * Extract chapter titles from <title> tags in XHTML.
 *
 * Some publishers put chapter numbers or names in <title>
 * but not in visible <h1>/<h2> elements.
 */
const MAX_TITLE_LENGTH = 60;

export class TitleTagExtractor implements TitleExtractor {
	readonly name = "title-tag";

	async extract(params: TitleExtractorParams): Promise<Map<string, string>> {
		const titles = new Map<string, string>();

		// Try to detect the book title so we can skip files that just repeat it
		const bookTitle = this.guessBookTitle(params);

		for (const [href, html] of params.xhtmlFiles) {
			let doc: ReturnType<typeof parseHTML>["document"];
			try {
				doc = parseHTML(html).document;
			} catch {
				continue;
			}
			const titleEl = doc.querySelector("title");
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
		return (params.opf.title || "").toLowerCase();
	}

	private isBoilerplate(
		text: string,
		bookTitle: string,
		href: string,
	): boolean {
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
