import { parseHTML } from "linkedom";
import type { TitleExtractor, TitleExtractorParams } from "./types.ts";

/**
 * Extract chapter titles from <h1> or <h2> elements in the XHTML body.
 *
 * This is a fallback for books without NCX entries or with missing
 * NCX titles for some chapters (e.g. front/back matter).
 */
export class HeadingTitleExtractor implements TitleExtractor {
	readonly name = "heading";

	async extract(params: TitleExtractorParams): Promise<Map<string, string>> {
		const titles = new Map<string, string>();

		for (const [href, html] of params.xhtmlFiles) {
			let doc: ReturnType<typeof parseHTML>["document"];
			try {
				doc = parseHTML(html).document;
			} catch {
				continue;
			}
			const body = doc.querySelector("body");
			if (!body) continue;

			const heading = body.querySelector("h1") || body.querySelector("h2");
			if (!heading) continue;

			const text = (heading.textContent || "").trim();
			if (!text) continue;

			titles.set(href, text);
		}

		return titles;
	}
}
