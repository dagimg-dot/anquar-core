import { blockText, materializeBlocks } from "./blocks.ts";
import { cleanupSections } from "./cleanup.ts";
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

const FRONT_MATTER_TITLE =
	/^(cover|title\s*page|titlepage|half[\s-]?title|copyright|imprint|colophon|contents|table of contents|toc|dedication|epigraph|acknowledge?ments?|about the author|about the publisher|advance praise|praise for|also by|by the same author|other books by|front\s?matter|newsletter)\b/i;

const BOILERPLATE =
	/all rights reserved|isbn|library of congress|catalogue record|first published|published by|copyright ©|©\s*\d{4}/gi;

const BODY_MIN_WORDS = 150;

const MAX_FRONT_MATTER_SHARE = 0.25;

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

	const opening = blockText(chapter.blocks[0] ?? ({} as never)).trim();
	if (/^(table of )?contents\b/i.test(opening)) return true;
	if (opening && opening.toLowerCase() === bookTitle.toLowerCase()) return true;

	const text = chapter.blocks.map(blockText).join(" ");
	return (text.match(BOILERPLATE) ?? []).length >= 2;
}

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

export async function parseEpubFromFile(
	file: File,
	JSZip: { loadAsync(data: File): Promise<JSZipLike> },
	options?: Partial<ParseOptions>,
): Promise<ParsedBook> {
	const zip = await EpubZip.fromJSZip(await JSZip.loadAsync(file));
	return parseEpubFromZip(zip, options as ParseOptions | undefined);
}

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

	const coverItem = opf.manifest.get(opf.coverId);
	const coverImage = coverItem
		? zip.readBinary(zip.resolvePath(opf.opfDir, coverItem.href))
		: null;

	const docs: { href: string; path: string; html: string }[] = [];
	for (const { idref } of opf.spine) {
		const item = opf.manifest.get(idref);
		if (!item?.mediaType.includes("html")) continue;
		const path = zip.resolvePath(opf.opfDir, item.href);
		const html = zip.readText(path);
		if (html) docs.push({ href: item.href, path, html });
	}

	const cssMap = new Map<string, StyleMapping>();
	for (const item of opf.manifest.values()) {
		if (item.mediaType !== "text/css") continue;
		const css = zip.readText(zip.resolvePath(opf.opfDir, item.href));
		for (const [k, v] of parseCssStyles(css)) {
			if (!cssMap.has(k)) cssMap.set(k, v);
		}
	}

	const titleParams: TitleExtractorParams = {
		zip,
		opf,
		xhtmlFiles: new Map(docs.map((d) => [d.href, d.html])),
	};
	const titleMap = await options.titleExtractor.extract(titleParams);

	if (options.debug) {
		console.error(`[parser] title strategy: ${options.titleExtractor.name}`);
		for (const [href, t] of titleMap) {
			console.error(`[title] ${href} → "${t}"`);
		}
	}

	const imageCache = new Map<string, Uint8Array | null>();
	const resolveImage = (src: string, xhtmlPath: string) => {
		const key = `${xhtmlPath}\n${src}`;
		if (!imageCache.has(key)) {
			const data = options.imageResolver.resolve({ zip, opf, src, xhtmlPath });
			if (options.debug && !data) {
				console.error(`[image] ${options.imageResolver.name} failed: ${src}`);
			}
			imageCache.set(key, data);
		}
		return imageCache.get(key) ?? null;
	};

	const cleaned = cleanupSections(
		docs.map((doc) => ({
			blocks: options.blockExtractor.extract(doc.html, cssMap),
			imageBytes: (src: string) => resolveImage(src, doc.path),
		})),
		coverImage,
	);

	const chapters: ParsedChapter[] = [];
	docs.forEach((doc, i) => {
		if (cleaned[i].length === 0) return;
		const index = chapters.length;
		chapters.push({
			index,
			title: decodeEntities(titleMap.get(doc.href) ?? ""),
			blocks: materializeBlocks(cleaned[i], index, `c${index}-`, (src) =>
				resolveImage(src, doc.path),
			),
			frontMatter: false,
		});
	});

	markFrontMatter(chapters, decodeEntities(bookTitle));

	return {
		title: decodeEntities(bookTitle),
		author: decodeEntities(bookAuthor),
		chapters,
		coverImage,
	};
}
