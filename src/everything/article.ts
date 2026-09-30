import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import { materializeBlocks } from "../blocks.ts";
import { DomWalkerBlockExtractor } from "../extractors/block/dom-walker.ts";
import type { ParsedArticle } from "../types.ts";
import { decodeEntities } from "../utils/entities.ts";
import { asFullHtml, cleanupArticle } from "./cleanup.ts";

export interface ArticleOptions {
	userAgent?: string;
}

const DEFAULT_USER_AGENT =
	"Mozilla/5.0 (Linux; Android 14; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Mobile Safari/537.36";

export async function parseArticle(
	input:
		| string
		| { html: string; url?: string; title?: string; author?: string },
	options?: ArticleOptions,
): Promise<ParsedArticle> {
	let html: string;
	let url: string;
	let titleOverride: string | undefined;
	let authorOverride: string | undefined;

	if (typeof input === "string") {
		url = input;
		const resp = await fetch(url, {
			headers: { "User-Agent": options?.userAgent ?? DEFAULT_USER_AGENT },
		});
		if (!resp.ok) {
			throw new Error(
				`Failed to fetch ${url}: ${resp.status} ${resp.statusText}`,
			);
		}
		html = await resp.text();
	} else {
		html = input.html;
		url = input.url ?? "";
		titleOverride = input.title;
		authorOverride = input.author;
	}

	const { document: rawDoc } = parseHTML(html);
	const reader = new Readability(rawDoc);
	const article = reader.parse();

	if (!article?.content) {
		throw new Error(
			"Could not extract article content – page may not be reader-able",
		);
	}

	const cleaned = cleanupArticle(article.content);
	const extractor = new DomWalkerBlockExtractor();
	const rawBlocks = extractor.extract(asFullHtml(cleaned), new Map());

	const blocks = materializeBlocks(rawBlocks, 0, "a-", () => null);

	return {
		title: decodeEntities(titleOverride ?? article.title ?? ""),
		author: decodeEntities(authorOverride ?? article.byline ?? ""),
		siteName: article.siteName ?? "",
		url,
		published: article.publishedTime ?? undefined,
		blocks,
	};
}
