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
const FRONT_MATTER_TITLE =
	/^(cover|title\s*page|titlepage|half[\s-]?title|copyright|imprint|colophon|contents|table of contents|toc|dedication|epigraph|acknowledge?ments?|about the author|about the publisher|advance praise|praise for|also by|by the same author|other books by|front\s?matter|newsletter)\b/i;

/** Rights-page phrasing. One line is a passing mention; several is the page. */
const BOILERPLATE =
	/all rights reserved|isbn|library of congress|catalogue record|first published|published by|copyright ©|©\s*\d{4}/gi;

/** Words below which a chapter is too slight to be where the book begins. */
const BODY_MIN_WORDS = 150;

/** Never treat more than this much of a book as front matter. */
const MAX_FRONT_MATTER_SHARE = 0.25;

/** …but always look at least this far, since short books front-load the same pages. */
const MIN_FRONT_MATTER_SCAN = 6;

function chapterWordCount(chapter: ParsedChapter): number {
	let words = 0;
	for (const block of chapter.blocks) {
		const text = blockText(block).trim();
		if (text) words += text.split(/\s+/).length;
	}
	return words;
}

function looksLikeFrontMatter(
	chapter: ParsedChapter,
	bookTitle: string,
	wordCount: number,
): boolean {
	const title = chapter.title.replace(/[:\-–—].*$/, "").trim();
	if (title && FRONT_MATTER_TITLE.test(title)) return true;
	if (title && title === bookTitle) return true;
	if (wordCount === 0) return true;

	// An untitled page still announces itself: a table of contents opens with
	// the word, and a title page opens by repeating the book's name.
	const opening = blockText(chapter.blocks[0] ?? ({} as never)).trim();
	if (/^(table of )?contents\b/i.test(opening)) return true;
	if (opening && opening.toLowerCase() === bookTitle.toLowerCase()) return true;

	const text = chapter.blocks.map(blockText).join(" ");
	return (text.match(BOILERPLATE) ?? []).length >= 2;
}

/**
 * Front matter sits in one run at the front of a book, so walk forward and stop
 * at the first chapter substantial enough to be where reading starts. Marking
 * only a prefix means a mid-book acknowledgements page is never mistaken for it.
 */
function markFrontMatter(chapters: ParsedChapter[], bookTitle: string): void {
	const limit = Math.min(
		chapters.length,
		Math.max(
			MIN_FRONT_MATTER_SCAN,
			Math.ceil(chapters.length * MAX_FRONT_MATTER_SHARE),
		),
	);

	for (let i = 0; i < limit; i++) {
		const chapter = chapters[i];
		const words = chapterWordCount(chapter);

		if (looksLikeFrontMatter(chapter, bookTitle, words)) {
			chapter.frontMatter = true;
			continue;
		}
		if (words >= BODY_MIN_WORDS) return;
		chapter.frontMatter = true;
	}
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

		const chapterTitle = decodeEntities(titleMap.get(item.href) ?? "");

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

		chapters.push({
			index: chapterIndex,
			title: chapterTitle,
			blocks,
			frontMatter: false,
		});
		chapterIndex++;
	}

	markFrontMatter(chapters, decodeEntities(bookTitle));

	return {
		title: decodeEntities(bookTitle),
		author: decodeEntities(bookAuthor),
		chapters,
		coverImage,
	};
}
