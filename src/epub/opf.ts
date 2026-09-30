import { parseHTML } from "linkedom";

export interface OpfItem {
	id: string;
	href: string;
	mediaType: string;
	properties: string;
}

export interface SpineItem {
	idref: string;
	linear: boolean;
}

export interface GuideReference {
	type: string;
	href: string;
}

export interface ParsedOpf {
	opfDir: string;
	manifest: Map<string, OpfItem>;
	spine: SpineItem[];
	guide: GuideReference[];
	title: string;
	author: string;
	coverId: string;
}

const TRAILING_LIST_SEPARATOR = /[;,]\s*$/;

function localName(el: Element): string {
	return (el.tagName || "").toLowerCase().replace(/^.*:/, "");
}

export function parseOpf(opfXml: string, opfPath: string): ParsedOpf {
	const manifest = new Map<string, OpfItem>();
	const spine: SpineItem[] = [];
	const guide: GuideReference[] = [];
	const opfDir = opfPath.includes("/")
		? `${opfPath.replace(/\/[^/]+$/, "")}/`
		: "";

	let doc: ReturnType<typeof parseHTML>["document"];
	try {
		doc = parseHTML(opfXml).document;
	} catch {
		return {
			opfDir,
			manifest,
			spine,
			guide,
			title: "Unknown",
			author: "Unknown",
			coverId: "",
		};
	}

	const titles: { id: string; text: string }[] = [];
	let mainTitleId = "";
	let author = "Unknown";
	let coverId = "";

	for (const el of doc.querySelectorAll("*")) {
		const tag = localName(el);
		const text = (el.textContent || "").trim();

		switch (tag) {
			case "title":
				if (text) titles.push({ id: el.getAttribute("id") ?? "", text });
				break;
			case "creator":
				if (text && author === "Unknown")
					author = text.replace(TRAILING_LIST_SEPARATOR, "");
				break;
			case "meta":
				if (
					el.getAttribute("property") === "title-type" &&
					text === "main" &&
					!mainTitleId
				) {
					mainTitleId = (el.getAttribute("refines") ?? "").replace(/^#/, "");
				}
				if (el.getAttribute("name")?.toLowerCase() === "cover" && !coverId) {
					coverId = el.getAttribute("content") ?? "";
				}
				break;
			case "item": {
				const id = el.getAttribute("id");
				const href = el.getAttribute("href");
				if (id && href) {
					manifest.set(id, {
						id,
						href,
						mediaType: el.getAttribute("media-type") || "",
						properties: el.getAttribute("properties") || "",
					});
				}
				break;
			}
			case "itemref": {
				const idref = el.getAttribute("idref");
				if (idref) {
					spine.push({ idref, linear: el.getAttribute("linear") !== "no" });
				}
				break;
			}
			case "reference": {
				const type = (el.getAttribute("type") || "").toLowerCase();
				const href = (el.getAttribute("href") || "").split("#")[0];
				if (type && href) guide.push({ type, href });
				break;
			}
		}
	}

	const title =
		titles.find((t) => t.id && t.id === mainTitleId)?.text ??
		titles[0]?.text ??
		"Unknown";

	if (!manifest.has(coverId)) {
		coverId =
			[...manifest.values()].find((item) =>
				item.properties.split(/\s+/).includes("cover-image"),
			)?.id ?? "";
	}

	return { opfDir, manifest, spine, guide, title, author, coverId };
}
