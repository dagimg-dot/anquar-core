import { parseHTML } from "linkedom";
import { normalizeTitleKey } from "../utils/path.ts";
import type { GuideReference, ParsedOpf } from "./opf.ts";
import type { EpubZip } from "./zip.ts";

const DOCUMENT_WRAPPERS = new Set([
	"body",
	"section",
	"div",
	"article",
	"nav",
	"header",
]);

export function typesDeclaredAboveText(html: string): string[] {
	const start = html.search(/<body\b/i);
	if (start < 0) return [];

	const types: string[] = [];
	const token = /<([a-zA-Z][\w:-]*)\b([^>]*)>|([^<]+)/g;
	token.lastIndex = start;

	const attrs = /\b(?:epub:type|role)\s*=\s*["']([^"']+)["']/gi;
	for (let seen = 0; seen < 60; seen++) {
		const m = token.exec(html);
		if (!m) break;
		if (m[3] !== undefined) {
			if (m[3].trim()) break;
			continue;
		}
		if (!DOCUMENT_WRAPPERS.has(m[1].toLowerCase())) continue;
		for (const attr of m[2].matchAll(attrs)) {
			types.push(...attr[1].toLowerCase().split(/\s+/));
		}
	}
	return types;
}

export function findNavPath(zip: EpubZip, opf: ParsedOpf): string | null {
	const items = [...opf.manifest.values()];
	const declared = items.find((item) =>
		item.properties.split(/\s+/).includes("nav"),
	);
	const guessed = items.find(
		(item) =>
			item.mediaType === "application/xhtml+xml" &&
			(item.id.toLowerCase().includes("nav") ||
				item.href.toLowerCase().includes("nav")),
	);
	const item = declared ?? guessed;
	if (item) return zip.resolvePath(opf.opfDir, item.href);

	for (const guess of [
		"nav.xhtml",
		"OEBPS/nav.xhtml",
		"OPS/nav.xhtml",
		`${opf.opfDir}nav.xhtml`,
	]) {
		if (zip.has(guess)) return guess;
	}
	return null;
}

export function readLandmarks(zip: EpubZip, opf: ParsedOpf): GuideReference[] {
	const navPath = findNavPath(zip, opf);
	const html = navPath ? zip.readText(navPath) : "";
	if (!navPath || !html) return [];

	let doc: ReturnType<typeof parseHTML>["document"];
	try {
		doc = parseHTML(html).document;
	} catch {
		return [];
	}

	const navDir = zip.dirname(navPath);
	const out: GuideReference[] = [];
	for (const nav of doc.querySelectorAll("nav")) {
		const kind = nav.getAttribute("epub:type") || nav.getAttribute("type");
		if (kind !== "landmarks") continue;
		for (const link of nav.querySelectorAll("a")) {
			const type = (link.getAttribute("epub:type") || "").toLowerCase();
			const href = (link.getAttribute("href") || "").split("#")[0];
			if (!type || !href) continue;
			const resolved = navDir ? zip.resolvePath(navDir, href) : href;
			out.push({ type, href: normalizeTitleKey(opf.opfDir, resolved) });
		}
	}
	return out;
}
