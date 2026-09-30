import { parseHTML } from "linkedom";
import type { TitleExtractor, TitleExtractorParams } from "./types.ts";

const NUMBER_ONLY_HEADING = /^([0-9]+|[ivxlcdm]+)\.?$/i;

function headingText(el: Element): string {
	const text = (el.textContent || "").replace(/\s+/g, " ").trim();
	if (text) return text;
	return [...el.querySelectorAll("img")]
		.map((img) => img.getAttribute("alt")?.trim() ?? "")
		.filter(Boolean)
		.join(" ");
}

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

			const [first, second] = body.querySelectorAll("h1, h2, h3");
			if (!first) continue;

			let text = headingText(first);
			if (NUMBER_ONLY_HEADING.test(text) && second) {
				const rest = headingText(second);
				if (rest) text = `${text.replace(/\.$/, "")}. ${rest}`;
			}
			if (text) titles.set(href, text);
		}

		return titles;
	}
}
