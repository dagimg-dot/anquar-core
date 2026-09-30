import type { ParsedOpf } from "./opf.ts";
import type { EpubZip } from "./zip.ts";

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
