import { parseNcx } from "../../epub/ncx.ts";
import { normalizeTitleKey } from "../../utils/path.ts";
import type { TitleExtractor, TitleExtractorParams } from "./types.ts";

function findNcxPath(params: TitleExtractorParams): string | null {
	for (const item of params.opf.manifest.values()) {
		if (item.mediaType === "application/x-dtbncx+xml") {
			return params.zip.resolvePath(params.opf.opfDir, item.href);
		}
	}
	for (const guess of ["toc.ncx", "OEBPS/toc.ncx"]) {
		if (params.zip.has(guess)) return guess;
	}
	return null;
}

export class NcxTitleExtractor implements TitleExtractor {
	readonly name = "ncx";

	async extract(params: TitleExtractorParams): Promise<Map<string, string>> {
		const titles = new Map<string, string>();

		const ncxPath = findNcxPath(params);
		if (!ncxPath) return titles;

		const ncxXml = params.zip.readText(ncxPath);
		if (!ncxXml) return titles;

		const ncxTitles = parseNcx(ncxXml);
		const ncxDir = params.zip.dirname(ncxPath);

		for (const [href, title] of ncxTitles) {
			const resolved = ncxDir ? params.zip.resolvePath(ncxDir, href) : href;
			const key = normalizeTitleKey(params.opf.opfDir, resolved);
			if (!titles.has(key)) {
				titles.set(key, title);
			}
		}

		return titles;
	}
}
