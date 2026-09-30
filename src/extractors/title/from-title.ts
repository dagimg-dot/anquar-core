import { parseHTML } from "linkedom";
import type { TitleExtractor, TitleExtractorParams } from "./types.ts";

const MAX_TITLE_LENGTH = 60;

const CONVERTER_PLACEHOLDER_TITLE =
	/^(index|untitled|unknown|document|html|text|content|[\w-]*split[\w-]*|(part|text|section|index|page)[_-]?\d+)$/i;

const BOOK_TITLE_DECORATION = /^(other|continued|cont|part \d+|\d+)?$/;

export class TitleTagExtractor implements TitleExtractor {
	readonly name = "title-tag";

	async extract(params: TitleExtractorParams): Promise<Map<string, string>> {
		const titles = new Map<string, string>();
		const bookTitle = (params.opf.title || "").toLowerCase();

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
			if (this.isBoilerplate(text, bookTitle, href)) continue;

			titles.set(href, text);
		}

		return titles;
	}

	private isBoilerplate(
		text: string,
		bookTitle: string,
		href: string,
	): boolean {
		const lower = text.toLowerCase();
		if (bookTitle && lower.includes(bookTitle)) {
			const decoration = lower
				.replace(bookTitle, "")
				.replace(/[^\p{L}\p{N}]+/gu, " ")
				.trim();
			if (BOOK_TITLE_DECORATION.test(decoration)) return true;
		}
		if (CONVERTER_PLACEHOLDER_TITLE.test(text)) return true;
		if (/^[.\s-]+$/.test(text)) return true;
		if (
			text ===
			href
				.split("/")
				.pop()
				?.replace(/\.x?html?$/, "")
		)
			return true;
		return text.length > MAX_TITLE_LENGTH;
	}
}
