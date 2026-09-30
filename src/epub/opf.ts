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
	title: string;
	author: string;
}

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

	const titles: { id: string; text: string }[] = [];
	let mainTitleId = "";
	let author = "Unknown";

	for (const el of doc.querySelectorAll("*")) {
		const tag = (el.tagName || "").toLowerCase();
		const text = (el.textContent || "").trim();

		if (tag === "dc:title" || tag.endsWith(":title")) {
			if (text) titles.push({ id: el.getAttribute("id") ?? "", text });
		} else if (tag === "dc:creator" || tag.endsWith(":creator")) {
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
