import { parseHTML } from "linkedom";
import { blockText, materializeBlocks } from "./blocks.ts";
import type { ParseOptions } from "./config.ts";
import { DEFAULT_PARSE_OPTIONS } from "./config.ts";
import { getOpfPath } from "./epub/container.ts";
import { parseOpf } from "./epub/opf.ts";
import type { JSZipLike } from "./epub/zip.ts";
import { EpubZip } from "./epub/zip.ts";
import type { TitleExtractorParams } from "./extractors/title/types.ts";
import type { ParsedBook, ParsedChapter, StyleMapping } from "./types.ts";
import { parseCssStyles } from "./utils/css.ts";
import { decodeEntities } from "./utils/entities.ts";

/** Titles that indicate a chapter is front matter (not actual content). */
const FM_TITLES = new Set([
	"cover",
	"title page",
	"copyright",
	"contents",
	"dedication",
	"epigraph",
	"acknowledgments",
	"acknowledgements",
]);

/**
 * Heuristic: is this chapter likely front matter?
 * Data-driven rules (verified against 20 EPUBs, zero false positives):
 *   1. Title matches a known FM pattern
 *   2. Title is identical to the book title (title page repeat)
 *   3. One of first 3 chapters with <3 prose blocks and <30 words
 */
function isFrontMatter(
	chapterTitle: string,
	bookTitle: string,
	chapterIndex: number,
	proseBlockCount: number,
	wordCount: number,
): boolean {
	const title = chapterTitle
		.toLowerCase()
		.replace(/[:\-–—].*$/, "")
		.trim();
	return (
		FM_TITLES.has(title) ||
		chapterTitle === bookTitle ||
		(chapterIndex < 3 && proseBlockCount < 3 && wordCount < 30)
	);
}

/**
 * Parse an EPUB from a browser File object using JSZip.
 * JSZip must be passed in (it's a peer dependency, not bundled).
 *
 * @example
 *   import JSZip from "jszip";
 *   const book = await parseEpubFromFile(file, JSZip);
 */
export async function parseEpubFromFile(
	file: File,
	JSZip: { loadAsync(data: File): Promise<JSZipLike> },
	options?: Partial<ParseOptions>,
): Promise<ParsedBook> {
	const zip = await EpubZip.fromJSZip(await JSZip.loadAsync(file));
	return parseEpubFromZip(zip, options as ParseOptions | undefined);
}

/** The shared core — both runtime entry points open a zip and hand it here. */
export async function parseEpubFromZip(
	zip: EpubZip,
	opts?: ParseOptions,
): Promise<ParsedBook> {
	const options: ParseOptions = opts ?? DEFAULT_PARSE_OPTIONS;

	const opfRel = getOpfPath(zip);
	const opfXml = zip.readText(opfRel);
	if (!opfXml) {
		throw new Error(`OPF file not found at ${opfRel}`);
	}
	const opf = parseOpf(opfXml, opfRel);

	const bookTitle = opf.title;
	const bookAuthor = opf.author;

	let coverImage: Uint8Array | null = null;
	try {
		const { document: metaDoc } = parseHTML(opfXml);
		for (const el of metaDoc.querySelectorAll("*")) {
			const tag = (el.tagName || "").toLowerCase();
			if (
				(tag === "meta" || tag.endsWith(":meta")) &&
				el.getAttribute?.("name")?.toLowerCase() === "cover"
			) {
				const coverId = el.getAttribute("content");
				if (coverId) {
					const coverItem = opf.manifest.get(coverId);
					if (coverItem) {
						const coverPath = zip.resolvePath(opf.opfDir, coverItem.href);
						coverImage = zip.readBinary(coverPath);
					}
				}
				break;
			}
		}
	} catch {
		// Cover image is optional — silently skip if not found
	}

	const xhtmlFiles = new Map<string, string>();
	const spineMap: { href: string; itemId: string }[] = [];

	for (const sp of opf.spine) {
		const item = opf.manifest.get(sp.idref);
		if (!item) continue;
		if (!item.mediaType.includes("xhtml") && !item.mediaType.includes("html"))
			continue;

		const xhtmlPath = zip.resolvePath(opf.opfDir, item.href);
		const html = zip.readText(xhtmlPath);
		if (!html) continue;

		xhtmlFiles.set(item.href, html);
		spineMap.push({ href: xhtmlPath, itemId: sp.idref });
	}

	const cssMap = new Map<string, StyleMapping>();
	for (const item of opf.manifest.values()) {
		if (item.mediaType === "text/css") {
			const cssPath = zip.resolvePath(opf.opfDir, item.href);
			const css = zip.readText(cssPath);
			if (css) {
				const parsed = parseCssStyles(css);
				for (const [k, v] of parsed) {
					if (!cssMap.has(k)) cssMap.set(k, v);
				}
			}
		}
	}

	const titleParams: TitleExtractorParams = { zip, opf, xhtmlFiles };
	const titleMap = await options.titleExtractor.extract(titleParams);

	if (options.debug) {
		console.error(`[parser] title strategy: ${options.titleExtractor.name}`);
		for (const [href, t] of titleMap) {
			console.error(`[title] ${href} → "${t}"`);
		}
	}

	const chapters: ParsedChapter[] = [];
	let chapterIndex = 0;

	for (const { href: xhtmlPath, itemId } of spineMap) {
		const item = opf.manifest.get(itemId);
		if (!item) continue;

		const html = zip.readText(xhtmlPath);
		if (!html) continue;

		const rawBlocks = options.blockExtractor.extract(html, cssMap);
		if (rawBlocks.length === 0) continue;

		const chapterTitle = decodeEntities(
			titleMap.get(item.href) || `Chapter ${chapterIndex + 1}`,
		);

		const blocks = materializeBlocks(
			rawBlocks,
			chapterIndex,
			`c${chapterIndex}-`,
			(src) => {
				const data = options.imageResolver.resolve({
					zip,
					opf,
					src,
					xhtmlPath,
				});
				if (options.debug && !data) {
					console.error(`[image] ${options.imageResolver.name} failed: ${src}`);
				}
				return data;
			},
		);

		const proseBlocks = blocks.filter((b) => b.type !== "image");
		const wordCount = proseBlocks.reduce(
			(s, b) => s + blockText(b).split(/\s+/).length,
			0,
		);

		chapters.push({
			index: chapterIndex,
			title: chapterTitle,
			blocks,
			frontMatter: isFrontMatter(
				chapterTitle,
				decodeEntities(bookTitle),
				chapterIndex,
				proseBlocks.length,
				wordCount,
			),
		});
		chapterIndex++;
	}

	return {
		title: decodeEntities(bookTitle),
		author: decodeEntities(bookAuthor),
		chapters,
		coverImage,
	};
}
