import { parseHTML } from "linkedom";
import { normalizeTitleKey } from "../../utils/path.ts";
import type { TitleExtractor, TitleExtractorParams } from "./types.ts";

/**
 * Extract chapter titles from the EPUB3 nav.xhtml file.
 *
 * EPUB3 uses an XHTML navigation document with <nav epub:type="toc">
 * as the canonical table of contents. This is often richer than the
 * legacy NCX (more entries, better titles).
 *
 * Strategy:
 *   1. Find nav.xhtml via the OPF manifest or common paths
 *   2. Parse it and extract all <a> href+text from the TOC nav element
 *   3. Return a Map of href (anchor-stripped) → title
 */
export class NavTitleExtractor implements TitleExtractor {
	readonly name = "nav";

	async extract(params: TitleExtractorParams): Promise<Map<string, string>> {
		const titles = new Map<string, string>();

		// Find nav.xhtml path from manifest or common locations
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

		// Extract all <a> tags recursively from the TOC nav
		const links = tocNav.querySelectorAll("a");
		const navDir = params.zip.dirname(navPath);

		for (const link of links) {
			const href = link.getAttribute("href");
			const text = (link.textContent || "").trim();
			if (!href || !text) continue;

			// Strip fragment and normalize path
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
		// 1. Look in OPF manifest for nav item
		for (const item of params.opf.manifest.values()) {
			if (
				item.mediaType === "application/xhtml+xml" &&
				(item.id.toLowerCase().includes("nav") ||
					item.href.toLowerCase().includes("nav"))
			) {
				return params.zip.resolvePath(params.opf.opfDir, item.href);
			}
		}

		// 2. Try common paths
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
