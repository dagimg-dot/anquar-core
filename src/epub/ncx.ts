import { parseHTML } from "linkedom";
import { decodeEntities } from "../utils/entities.ts";

export interface NcxEntry {
	title: string;
	href: string;
	fragment: string;
}

export function parseNcx(ncxXml: string): NcxEntry[] {
	const entries: NcxEntry[] = [];

	let doc: ReturnType<typeof parseHTML>["document"];
	try {
		doc = parseHTML(ncxXml).document;
	} catch {
		return entries;
	}

	for (const el of doc.querySelectorAll("*")) {
		const tag = (el.tagName || "").toLowerCase();
		if (tag === "navpoint" || tag.endsWith(":navpoint")) {
			const labelEl = findChild(el, "navLabel");
			const textEl = labelEl && findChild(labelEl, "text");
			const contentEl = findChild(el, "content");
			if (!textEl || !contentEl) continue;

			const title = decodeEntities((textEl.textContent || "").trim());
			const [href, fragment = ""] = (contentEl.getAttribute("src") || "").split(
				"#",
			);
			if (title && href) entries.push({ title, href, fragment });
		}
	}

	return entries;
}

function findChild(parent: Element, localName: string): Element | null {
	const wanted = localName.toLowerCase();
	for (const child of parent.children || []) {
		const tag = (child.tagName || "").toLowerCase();
		if (tag === wanted || tag.endsWith(`:${wanted}`)) {
			return child as Element;
		}
	}
	return null;
}
