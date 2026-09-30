import { parseHTML } from "linkedom";
import type { TitleExtractor, TitleExtractorParams } from "./types.ts";

const MAX_TITLE_LENGTH = 60;

export class TitleTagExtractor implements TitleExtractor {
	readonly name = "title-tag";

	async extract(params: TitleExtractorParams): Promise<Map<string, string>> {
		const titles = new Map<string, string>();

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
		if (/^[.\s-]+$/.test(text)) return true;
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
