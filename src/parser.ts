import { materializeBlocks, wordCount } from "./blocks.ts";
import { cleanupSections } from "./cleanup.ts";
import type { ParseOptions } from "./config.ts";
import { DEFAULT_PARSE_OPTIONS } from "./config.ts";
import { getOpfPath } from "./epub/container.ts";
import { parseOpf } from "./epub/opf.ts";
import { readLandmarks, typesDeclaredAboveText } from "./epub/semantics.ts";
import type { JSZipLike } from "./epub/zip.ts";
import { EpubZip } from "./epub/zip.ts";
import type { TitleExtractorParams } from "./extractors/title/types.ts";
import {
	classifySections,
	READING_START_TYPES,
	type SectionInput,
} from "./sections.ts";
import type {
	OmittedSection,
	ParsedBook,
	ParsedChapter,
	StyleMapping,
} from "./types.ts";
import { parseCssStyles } from "./utils/css.ts";
import { decodeEntities } from "./utils/entities.ts";
import { imageSize } from "./utils/image-size.ts";
import { INVISIBLE } from "./utils/text.ts";

const RECORD_ID_AS_TITLE =
	/^([0-9a-f]{16,}|[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}|unknown)$/i;

function cleanTitle(title: string): string {
	return decodeEntities(title)
		.replace(INVISIBLE, "")
		.replace(/\s+/g, " ")
		.trim();
}

function titleFromFileName(name: string): string {
	const stem = name.replace(/^.*[\\/]/, "").replace(/\.epub$/i, "");
	const words = stem.includes(" ")
		? stem.replace(/_+/g, " ")
		: stem.replace(/[-_]+/g, " ");
	return words.replace(/\s+/g, " ").trim();
}

function hrefKey(href: string): string {
	const key = href.replace(/^\.\//, "");
	try {
		return decodeURIComponent(key);
	} catch {
		return key;
	}
}

export async function parseEpubFromFile(
	file: File,
	JSZip: { loadAsync(data: File): Promise<JSZipLike> },
	options?: Partial<ParseOptions>,
): Promise<ParsedBook> {
	const zip = await EpubZip.fromJSZip(await JSZip.loadAsync(file));
	return parseEpubFromZip(zip, options, file.name);
}

export async function parseEpubFromZip(
	zip: EpubZip,
	opts?: Partial<ParseOptions>,
	fileName?: string,
): Promise<ParsedBook> {
	const options: ParseOptions = { ...DEFAULT_PARSE_OPTIONS, ...opts };

	const opfRel = getOpfPath(zip);
	const opfXml = zip.readText(opfRel);
	if (!opfXml) {
		throw new Error(`OPF file not found at ${opfRel}`);
	}
	const opf = parseOpf(opfXml, opfRel);

	const metadataTitle = cleanTitle(opf.title);
	const title =
		RECORD_ID_AS_TITLE.test(metadataTitle) && fileName
			? titleFromFileName(fileName)
			: metadataTitle;
	const author = cleanTitle(opf.author);

	const coverItem = opf.manifest.get(opf.coverId);
	const coverImage = coverItem
		? zip.readBinary(zip.resolvePath(opf.opfDir, coverItem.href))
		: null;

	const docs: { href: string; path: string; html: string; linear: boolean }[] =
		[];
	for (const { idref, linear } of opf.spine) {
		const item = opf.manifest.get(idref);
		if (!item?.mediaType.includes("html")) continue;
		const path = zip.resolvePath(opf.opfDir, item.href);
		const html = zip.readText(path);
		if (html) docs.push({ href: item.href, path, html, linear });
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

	const hints = new Map<string, string[]>();
	for (const ref of [...opf.guide, ...readLandmarks(zip, opf)]) {
		if (READING_START_TYPES.has(ref.type)) continue;
		const key = hrefKey(ref.href);
		hints.set(key, [...(hints.get(key) ?? []), ref.type]);
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

	const sections: SectionInput[] = docs.map((doc) => {
		const blocks = options.blockExtractor.extract(doc.html, cssMap);
		const images = blocks.flatMap((b) =>
			b.type === "image" ? [resolveImage(b.src, doc.path)] : [],
		);
		return {
			title: cleanTitle(titleMap.get(doc.href) ?? ""),
			blocks,
			declaredTypes: [
				...typesDeclaredAboveText(doc.html),
				...(hints.get(hrefKey(doc.href)) ?? []),
			],
			linear: doc.linear,
			imageSizes: images.map((bytes) => (bytes ? imageSize(bytes) : null)),
			showsCover: coverImage !== null && images.includes(coverImage),
		};
	});

	const verdicts = classifySections(sections, { title, author });

	const kept: number[] = [];
	const omitted: OmittedSection[] = [];
	sections.forEach((section, i) => {
		const verdict = verdicts[i];
		if (!verdict.omit || options.keepApparatus) {
			kept.push(i);
		} else if (section.blocks.length > 0) {
			omitted.push({
				title: section.title,
				role: verdict.role,
				words: wordCount(section.blocks),
			});
		}
		if (options.debug) {
			const mark = verdict.omit
				? "omit"
				: verdict.frontMatter
					? "front"
					: "keep";
			console.error(
				`[section] ${i} ${mark} ${verdict.role} "${section.title}"`,
			);
		}
	});

	const cleaned = cleanupSections(
		kept.map((i) => ({
			title: sections[i].title,
			blocks: verdicts[i].keptBlocks,
			imageBytes: (src: string) => resolveImage(src, docs[i].path),
		})),
		coverImage,
	);

	const chapters: ParsedChapter[] = [];
	kept.forEach((i, k) => {
		if (cleaned[k].length === 0) return;
		const index = chapters.length;
		chapters.push({
			index,
			title: sections[i].title,
			role: verdicts[i].role,
			frontMatter: verdicts[i].frontMatter,
			blocks: materializeBlocks(cleaned[k], index, `c${index}-`, (src) =>
				resolveImage(src, docs[i].path),
			),
		});
	});

	return { title, author, chapters, coverImage, omitted };
}
