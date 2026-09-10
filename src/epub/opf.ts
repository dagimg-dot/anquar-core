import { parseHTML } from "linkedom";

export interface OpfItem {
	id: string;
	href: string;
	mediaType: string;
}

export interface ParsedOpf {
	opfDir: string;
	manifest: Map<string, OpfItem>;
	spine: { idref: string }[];
	/** Book title from OPF metadata. */
	title: string;
	/** Book author from OPF metadata. */
	author: string;
}

/**
 * Parse raw OPF XML into a structured manifest + spine + metadata.
 * Uses linkedom DOM for robust handling of namespaces and formatting.
 */
export function parseOpf(opfXml: string, opfPath: string): ParsedOpf {
	const manifest = new Map<string, OpfItem>();
	const spine: { idref: string }[] = [];
	const opfDir = opfPath.includes("/")
		? `${opfPath.replace(/\/[^/]+$/, "")}/`
		: "";

	let doc: ReturnType<typeof parseHTML>["document"];
	try {
		doc = parseHTML(opfXml).document;
	} catch {
		return { opfDir, manifest, spine, title: "Unknown", author: "Unknown" };
	}

	// Namespaced elements like dc:title aren't reliably queriable,
	// so iterate all elements and match on tag name.
	// A book may carry several dc:title elements — typically the title and its
	// subtitle. EPUB 3 marks the real one with a title-type refinement; without
	// that, the first is the title and the rest are subtitles.
	const titles: { id: string; text: string }[] = [];
	let mainTitleId = "";
	let author = "Unknown";

	for (const el of doc.querySelectorAll("*")) {
		const tag = (el.tagName || "").toLowerCase();
		const text = (el.textContent || "").trim();

		if (tag === "dc:title" || tag.endsWith(":title")) {
			if (text) titles.push({ id: el.getAttribute("id") ?? "", text });
		} else if (tag === "dc:creator" || tag.endsWith(":creator")) {
			// Exporters leave list separators behind on a single-author field.
			if (text && author === "Unknown") author = text.replace(/[;,]\s*$/, "");
		} else if (tag === "meta" || tag.endsWith(":meta")) {
			if (
				el.getAttribute("property") === "title-type" &&
				text === "main" &&
				!mainTitleId
			) {
				mainTitleId = (el.getAttribute("refines") ?? "").replace(/^#/, "");
			}
		}
	}

	const title =
		titles.find((t) => t.id && t.id === mainTitleId)?.text ??
		titles[0]?.text ??
		"Unknown";

	for (const el of doc.querySelectorAll("*")) {
		const tag = (el.tagName || "").toLowerCase();
		// Match "item" in any namespace (default opf or otherwise)
		if (tag === "item" || tag.endsWith(":item")) {
			const id = el.getAttribute("id");
			const href = el.getAttribute("href");
			const mediaType = el.getAttribute("media-type") || "";
			if (id && href) {
				manifest.set(id, { id, href, mediaType });
			}
		}
	}

	for (const el of doc.querySelectorAll("*")) {
		const tag = (el.tagName || "").toLowerCase();
		if (tag === "itemref" || tag.endsWith(":itemref")) {
			const idref = el.getAttribute("idref");
			if (idref) spine.push({ idref });
		}
	}

	return { opfDir, manifest, spine, title, author };
}
