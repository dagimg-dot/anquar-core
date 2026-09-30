import { parseHTML } from "linkedom";
import { findNavPath } from "../../epub/semantics.ts";
import { normalizeTitleKey } from "../../utils/path.ts";
import { atTopOfFile } from "./anchors.ts";
import type { TitleExtractor, TitleExtractorParams } from "./types.ts";

export class NavTitleExtractor implements TitleExtractor {
	readonly name = "nav";

	async extract(params: TitleExtractorParams): Promise<Map<string, string>> {
		const titles = new Map<string, string>();

		const navPath = findNavPath(params.zip, params.opf);
		if (!navPath) return titles;

		const navHtml = params.zip.readText(navPath);
		if (!navHtml) return titles;

		let doc: ReturnType<typeof parseHTML>["document"];
		try {
			doc = parseHTML(navHtml).document;
		} catch {
			return titles;
		}

		const allNavs = doc.querySelectorAll("nav");
		let tocNav: Element | null = null;
		for (const nav of allNavs) {
			const epubType =
				nav.getAttribute("epub:type") || nav.getAttribute("type");
			if (epubType === "toc") {
				tocNav = nav;
				break;
			}
		}
		if (!tocNav) return titles;

		const links = tocNav.querySelectorAll("a");
		const navDir = params.zip.dirname(navPath);

		for (const link of links) {
			const href = link.getAttribute("href");
			const text = (link.textContent || "").trim();
			if (!href || !text) continue;

			const [base, fragment = ""] = href.split("#");
			const resolved = navDir ? params.zip.resolvePath(navDir, base) : base;
			const key = normalizeTitleKey(params.opf.opfDir, resolved);

			if (titles.has(key)) continue;
			if (!atTopOfFile(params.xhtmlFiles.get(key), fragment)) continue;
			titles.set(key, text);
		}

		return titles;
	}
}
