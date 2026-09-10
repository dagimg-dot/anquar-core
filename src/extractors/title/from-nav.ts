import { parseHTML } from "linkedom";
import { normalizeTitleKey } from "../../utils/path.ts";
import type { TitleExtractor, TitleExtractorParams } from "./types.ts";

/**
 * Extract chapter titles from the EPUB3 nav.xhtml file.
 *
 * EPUB3 uses an XHTML navigation document with <nav epub:type="toc">
 * as the canonical table of contents. This is often richer than the
 * legacy NCX (more entries, better titles).
 */
export class NavTitleExtractor implements TitleExtractor {
	readonly name = "nav";

	async extract(params: TitleExtractorParams): Promise<Map<string, string>> {
		const titles = new Map<string, string>();

		const navPath = this.findNavPath(params);
		if (!navPath) return titles;

		const navHtml = params.zip.readText(navPath);
		if (!navHtml) return titles;

		let doc: ReturnType<typeof parseHTML>["document"];
		try {
			doc = parseHTML(navHtml).document;
		} catch {
			return titles;
		}

		// Find <nav epub:type="toc"> — the canonical TOC
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

			const base = href.split("#")[0];
			const resolved = navDir ? params.zip.resolvePath(navDir, base) : base;
			const key = normalizeTitleKey(params.opf.opfDir, resolved);

			if (!titles.has(key)) {
				titles.set(key, text);
			}
		}

		return titles;
	}

	private findNavPath(params: TitleExtractorParams): string | null {
		for (const item of params.opf.manifest.values()) {
			if (
				item.mediaType === "application/xhtml+xml" &&
				(item.id.toLowerCase().includes("nav") ||
					item.href.toLowerCase().includes("nav"))
			) {
				return params.zip.resolvePath(params.opf.opfDir, item.href);
			}
		}

		for (const guess of [
			"nav.xhtml",
			"OEBPS/nav.xhtml",
			"OPS/nav.xhtml",
			`${params.opf.opfDir}nav.xhtml`,
		]) {
			if (params.zip.has(guess)) return guess;
		}

		return null;
	}
}
