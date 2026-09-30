import { blockText, wordCount } from "./blocks.ts";
import type { RawBlock, RawTextBlock } from "./extractors/block/types.ts";
import type { SectionRole } from "./types.ts";
import type { ImageSize } from "./utils/image-size.ts";

export interface SectionInput {
	title: string;
	blocks: RawBlock[];
	declaredTypes: string[];
	linear: boolean;
	imageSizes: (ImageSize | null)[];
	showsCover: boolean;
	backlinksTo: Set<number>;
}

export interface SectionVerdict {
	role: SectionRole;
	frontMatter: boolean;
	omit: boolean;
	keptBlocks: RawBlock[];
}

interface BookIdentity {
	title: string;
	author: string;
}

const APPARATUS = new Set<SectionRole>([
	"cover",
	"titlepage",
	"copyright",
	"contents",
	"promo",
	"notes",
	"index",
]);

const FRONT_ROLES = new Set<SectionRole>(["dedication", "epigraph", "preface"]);

const CORE_WORDS = 400;

const DECLARED_TYPE_ROLES: Record<string, SectionRole> = {
	cover: "cover",
	"doc-cover": "cover",
	titlepage: "titlepage",
	"title-page": "titlepage",
	halftitlepage: "titlepage",
	"halftitle-page": "titlepage",
	frontispiece: "titlepage",
	"copyright-page": "copyright",
	copyright: "copyright",
	imprint: "copyright",
	colophon: "copyright",
	"doc-colophon": "copyright",
	"other-credits": "copyright",
	toc: "contents",
	"doc-toc": "contents",
	loi: "contents",
	lot: "contents",
	seriespage: "promo",
	"other.ads": "promo",
	dedication: "dedication",
	"doc-dedication": "dedication",
	epigraph: "epigraph",
	"doc-epigraph": "epigraph",
	foreword: "preface",
	"doc-foreword": "preface",
	preface: "preface",
	"doc-preface": "preface",
	chapter: "body",
	"doc-chapter": "body",
	part: "body",
	"doc-part": "body",
	prologue: "body",
	"doc-prologue": "body",
	introduction: "body",
	"doc-introduction": "body",
	epilogue: "body",
	"doc-epilogue": "body",
	afterword: "body",
	"doc-afterword": "body",
	conclusion: "body",
	"doc-conclusion": "body",
	appendix: "body",
	"doc-appendix": "body",
	index: "index",
	"doc-index": "index",
	endnotes: "notes",
	"doc-endnotes": "notes",
	footnotes: "notes",
	rearnotes: "notes",
	notes: "notes",
	acknowledgments: "backmatter",
	acknowledgements: "backmatter",
	"doc-acknowledgments": "backmatter",
	bibliography: "backmatter",
	"doc-bibliography": "backmatter",
	glossary: "backmatter",
	"doc-glossary": "backmatter",
	contributors: "backmatter",
};

const TITLE_ROLES: [RegExp, SectionRole][] = [
	[/^(front )?cover( page| image)?$|^(portada|copertina|couverture)$/, "cover"],
	[
		/^(title ?page|half ?title( page)?|frontispiece|frontespizio|portadilla)$/,
		"titlepage",
	],
	[
		/^(copyright( page| notice)?|imprint|colophon|colofon|uncopyright|legal notice|credits|copyright (and|&) credits|permissions)$/,
		"copyright",
	],
	[
		/^(contents|table of contents|toc|sommaire|inhalt|inhaltsverzeichnis|sumario|indice|list of (illustrations|figures|tables|maps|plates))$/,
		"contents",
	],
	[
		/^(praise|advance praise|praise for .+|also by .+|also available .+|by the same author|other (books|titles|works)( by .+)?|books by .+|more (books )?(by|from) .+|newsletter|sign up.*|about the publisher|coming soon.*|a preview .+|reading (group )?guide|discussion (questions|guide)|follow penguin.*|what'?s next on your reading list.*)$/,
		"promo",
	],
	[
		/^(index|general index|subject index|index of names|indice analitico|indice alfabetico|register)$/,
		"index",
	],
	[
		/^(notes|endnotes|footnotes|notes (and|&) .+|source notes|notes on sources|notas|anmerkungen)$/,
		"notes",
	],
	[/^(dedication|dedica|dedicatoria|dedicace|widmung)$/, "dedication"],
	[/^(epigraph|epigraphs|epigrafe|epigraphe)$/, "epigraph"],
	[
		/^(foreword|preface|prefazione|premessa|prefacio|vorwort|avant propos|translator'?s (note|preface))\b|^(author'?s note|a note (on|about) the (text|translation)|note to the reader|dramatis personae|cast of characters|(list of |principal )characters|maps?)$/,
		"preface",
	],
	[
		/^(acknowledge?ments?|ringraziamenti|agradecimientos|remerciements|danksagung|thank you|thanks|about the authors?|about the illustrator|a note on the authors?|bibliography|references|further reading|a guide to further reading|suggested reading|recommended reading|glossary|illustration credits|photo(graph)? credits|image credits|picture credits)$/,
		"backmatter",
	],
	[
		/^(prologue|introduction|epilogue|afterword|conclusion|postscript|appendix)\b/,
		"body",
	],
];

export const READING_START_TYPES = new Set([
	"text",
	"start",
	"bodymatter",
	"other.start",
	"ibooks:reader-start-page",
]);

const ABOUT_THE_AUTHOR = /^(about the authors?|a note on the authors?)$/;

const RIGHTS_PHRASES =
	/all rights reserved|\bisbn\b|library of congress|cataloging[- ]in[- ]publication|catalogue record|first published|published by|printed in|copyright ©|©\s*\d{4}/gi;

const TITLE_WITH_YEAR = /\((1[5-9]|20)\d\d\)\s*$/;

const ALSO_BY =
	/^(also by|also from|by the same author|other (books|titles|works) by|books by|more (books )?(by|from))\b/i;

const QUOTE_OPEN = /^["“'‘«]/;

const ATTRIBUTION = /^[—–―]\s*\p{Lu}/u;

const QUOTE_THEN_SOURCE = /["”’'»][\s.,]*[—–―-]?\s*\p{Lu}[^.!?"”]{1,80}$/u;

const DEDICATION =
	/^(for|to|in (loving )?memory|dedicated|this book is (dedicated|for))\b/i;

export function titleKey(title: string): string {
	return title
		.normalize("NFKD")
		.replace(/[\u0300-\u036F\u00AD\u200B-\u200D\uFEFF]/g, "")
		.toLowerCase()
		.replace(/^(chapter|part|book)\s+\S+\s*[.:–—-]?\s*/, "")
		.replace(/^([0-9]+|[ivxlcdm]+)\s*[.:)–—-]\s*/, "")
		.replace(/[«»"“”‘*†:;.,!?()[\]]/g, " ")
		.replace(/[’']/g, "'")
		.replace(/\s+/g, " ")
		.trim();
}

function titleRole(title: string): SectionRole | null {
	const key = titleKey(title);
	if (!key) return null;
	for (const [pattern, role] of TITLE_ROLES) {
		if (pattern.test(key)) return role;
	}
	return null;
}

function linesOf(blocks: readonly RawBlock[]): string[] {
	return blocks
		.filter((b) => b.type === "text" || b.type === "heading")
		.flatMap((b) => blockText(b).split("\n"))
		.filter(Boolean);
}

function openingHeading(blocks: readonly RawBlock[]): string {
	for (const block of blocks) {
		if (block.type === "image" || block.type === "break") continue;
		return block.type === "heading" ? block.content : "";
	}
	return "";
}

function explicitRole(section: SectionInput): SectionRole | null {
	for (const type of section.declaredTypes) {
		const role = DECLARED_TYPE_ROLES[type];
		if (role) return role;
	}
	return titleRole(section.title) ?? titleRole(openingHeading(section.blocks));
}

function median(values: number[]): number {
	if (values.length === 0) return 0;
	const sorted = [...values].sort((a, b) => a - b);
	return sorted[Math.floor(sorted.length / 2)];
}

function nameWords(s: string): string {
	return titleKey(s)
		.split(/[\s,]+/)
		.filter(Boolean)
		.sort()
		.join(" ");
}

function namesTitleOrAuthor(text: string, book: BookIdentity): boolean {
	const key = titleKey(text).replace(/^by /, "");
	if (!key) return false;
	const mainTitle = book.title.split(/[:(]/)[0];
	if (key === titleKey(book.title) || key === titleKey(mainTitle)) return true;
	return nameWords(key) === nameWords(book.author);
}

function rightsHits(text: string): number {
	return (text.match(RIGHTS_PHRASES) ?? []).length;
}

function looksLikeCopyright(lines: string[], words: number): boolean {
	const hits = rightsHits(lines.join(" "));
	return hits >= 2 && (words <= 300 || hits >= words / 80);
}

function looksLikeContents(lines: string[], otherTitles: string[]): boolean {
	const text = ` ${titleKey(lines.join(" "))} `;
	const named = otherTitles.filter((t) => text.includes(` ${t} `));
	const covered = named.reduce((n, t) => n + t.length, 0);
	if (named.length >= 4 && covered >= text.length * 0.4) return true;
	const paged = lines.filter((l) => /(^|\s)(\d{1,4}|[ivxlc]{1,6})$/i.test(l));
	return lines.length >= 5 && paged.length >= lines.length * 0.5;
}

function looksLikePraise(lines: string[]): boolean {
	if (lines.length < 4) return false;
	let quoted = 0;
	let sourced = 0;
	for (const line of lines) {
		const shortAttribution = ATTRIBUTION.test(line) && line.length <= 60;
		const source =
			shortAttribution ||
			(QUOTE_OPEN.test(line) && QUOTE_THEN_SOURCE.test(line));
		if (source || QUOTE_OPEN.test(line)) quoted++;
		if (source) sourced++;
	}
	return quoted >= lines.length * 0.6 && sourced >= 3;
}

function looksLikeBookList(lines: string[]): boolean {
	if (ALSO_BY.test(lines[0] ?? "")) return true;
	const listed = lines.filter((l) => TITLE_WITH_YEAR.test(l)).length;
	return lines.length >= 4 && listed >= lines.length * 0.5;
}

function looksLikeTitlePage(
	lines: string[],
	words: number,
	book: BookIdentity,
): boolean {
	if (words > 60 || lines.length === 0) return false;
	const sentence = lines.some((l) =>
		/[.!?]$/.test(l.replace(/["'”’»)\]]+$/, "")),
	);
	return !sentence && lines.some((l) => namesTitleOrAuthor(l, book));
}

function looksLikeEpigraph(lines: string[], words: number): boolean {
	if (words > 200 || lines.length > 10) return false;
	return lines.some(
		(l) => ATTRIBUTION.test(l) || /[—–―]\s*\p{Lu}[^.!?]{0,80}$/u.test(l),
	);
}

function looksLikeNotes(section: SectionInput): boolean {
	if (section.backlinksTo.size < 2) return false;
	const texts = section.blocks.filter(
		(b): b is RawTextBlock => b.type === "text",
	);
	const first = texts.findIndex((b) => b.backlink);
	if (first < 0) return false;
	const labelled = texts.filter((b) => b.backlink).length;
	const chars = (blocks: RawTextBlock[]) =>
		blocks.reduce((n, b) => n + b.content.length, 0);
	return (
		labelled >= 5 &&
		labelled >= (texts.length - first) * 0.25 &&
		chars(texts.slice(0, first)) <= chars(texts) * 0.2
	);
}

function shapeFitsRole(
	role: SectionRole,
	lines: string[],
	words: number,
): boolean {
	const lengths = lines.map((l) => l.length);
	switch (role) {
		case "cover":
			return words <= 30;
		case "titlepage":
			return words <= 80;
		case "copyright":
			return words <= 1500;
		case "promo":
			return words <= 3000;
		case "contents":
			return words <= 6000 && median(lengths) <= 120;
		case "index": {
			const numbered = lines.filter((l) => /\d/.test(l)).length;
			return numbered >= lines.length * 0.3 && median(lengths) <= 160;
		}
		default:
			return true;
	}
}

function trimLeadingApparatus(
	blocks: RawBlock[],
	book: BookIdentity,
	requireRights: boolean,
): RawBlock[] {
	const isRights = (text: string) => rightsHits(text) > 0;
	const isHit = (block: RawBlock) => {
		const text = blockText(block);
		if (!text) return false;
		return (
			isRights(text) ||
			TITLE_WITH_YEAR.test(text) ||
			ALSO_BY.test(text) ||
			namesTitleOrAuthor(text, book)
		);
	};

	let end = 0;
	while (end < blocks.length && end < 80) {
		const block = blocks[end];
		if (block.type === "list") break;
		if (block.type === "text" && block.content.length >= 120 && !isHit(block)) {
			break;
		}
		end++;
	}

	const hits: number[] = [];
	for (let i = 0; i < end; i++) if (isHit(blocks[i])) hits.push(i);
	if (hits.length === 0) return blocks;
	if (requireRights && !hits.some((i) => isRights(blockText(blocks[i])))) {
		return blocks;
	}

	const drop = new Set(hits);
	for (let h = 0; h + 1 < hits.length; h++) {
		const from = hits[h];
		const to = hits[h + 1];
		if (to - from > 7) continue;
		for (let i = from + 1; i < to; i++) {
			const block = blocks[i];
			if (block.type === "image" || blockText(block).length < 80) drop.add(i);
		}
	}
	return blocks.filter((_, i) => !drop.has(i));
}

export function classifySections(
	sections: SectionInput[],
	book: BookIdentity,
): SectionVerdict[] {
	const roles = sections.map(explicitRole);
	const words = sections.map((s) => wordCount(s.blocks));
	const lines = sections.map((s) => linesOf(s.blocks));
	const titles = sections.map((s) => titleKey(s.title));
	const otherTitles = (i: number) =>
		titles.filter((t, j) => j !== i && t.length >= 4);

	sections.forEach((s, i) => {
		if (
			roles[i] === null &&
			words[i] <= 80 &&
			namesTitleOrAuthor(s.title, book)
		) {
			roles[i] = "titlepage";
		}
	});

	const plainApparatus = (i: number): SectionRole | null => {
		if (looksLikeCopyright(lines[i], words[i])) return "copyright";
		if (looksLikePraise(lines[i]) || looksLikeBookList(lines[i]))
			return "promo";
		if (looksLikeNotes(sections[i])) return "notes";
		return null;
	};

	let firstCore = -1;
	for (let i = 0; i < sections.length && firstCore < 0; i++) {
		if (roles[i] === "body") firstCore = i;
		if (roles[i] !== null || words[i] < CORE_WORDS) continue;
		const contents = looksLikeContents(lines[i], otherTitles(i));
		roles[i] = plainApparatus(i) ?? (contents ? "contents" : null);
		if (roles[i] === null) firstCore = i;
	}
	let lastCore = -1;
	for (let i = sections.length - 1; i >= 0 && lastCore < 0; i--) {
		if (roles[i] === "body") lastCore = i;
		if (roles[i] !== null || words[i] < CORE_WORDS) continue;
		roles[i] = plainApparatus(i);
		if (roles[i] === null) lastCore = i;
	}
	if (firstCore < 0 || lastCore < 0) {
		firstCore = 0;
		lastCore = sections.length - 1;
	}

	for (let i = 0; i < sections.length; i++) {
		if (roles[i] !== null) continue;
		const front = i < firstCore;
		if (!front && i <= lastCore) continue;

		const text = lines[i];
		const untitled = !sections[i].title;

		roles[i] = plainApparatus(i);
		if (roles[i] !== null || !front) continue;
		if (looksLikeContents(text, otherTitles(i))) roles[i] = "contents";
		else if (!untitled) continue;
		else if (looksLikeTitlePage(text, words[i], book)) roles[i] = "titlepage";
		else if (
			/^by\s/i.test(text[0] ?? "") &&
			namesTitleOrAuthor(text[0], book)
		) {
			roles[i] = "promo";
		} else if (words[i] <= 40 && DEDICATION.test(text[0] ?? "")) {
			roles[i] = "dedication";
		} else if (looksLikeEpigraph(text, words[i])) roles[i] = "epigraph";
	}

	for (let i = 0; i < firstCore; i++) {
		if (roles[i] === "backmatter" && ABOUT_THE_AUTHOR.test(titles[i])) {
			roles[i] = "promo";
		}
	}

	let lastFrontApparatus = -1;
	for (let i = 0; i < firstCore; i++) {
		const role = roles[i];
		if (role && APPARATUS.has(role)) lastFrontApparatus = i;
	}
	for (let i = 0; i < firstCore; i++) {
		const s = sections[i];
		if (roles[i] !== null || words[i] > 0) continue;
		if (!s.blocks.some((b) => b.type === "image")) continue;
		const logo = s.imageSizes.every(
			(size) => size !== null && Math.max(size.width, size.height) < 300,
		);
		if (i === 0 || s.showsCover) roles[i] = "cover";
		else if (i < lastFrontApparatus || logo) roles[i] = "titlepage";
	}

	let lastFront = -1;
	for (let i = 0; i < firstCore; i++) {
		const role = roles[i];
		if (role && FRONT_ROLES.has(role)) lastFront = i;
	}

	return sections.map((s, i) => {
		let role = roles[i] ?? "body";
		if (APPARATUS.has(role) && !shapeFitsRole(role, lines[i], words[i])) {
			role = "body";
		}
		const omit = !s.linear || APPARATUS.has(role);
		const trimmed =
			!omit && i <= firstCore
				? trimLeadingApparatus(s.blocks, book, i === firstCore)
				: s.blocks;
		return {
			role,
			omit,
			frontMatter: !omit && i <= lastFront,
			keptBlocks: trimmed,
		};
	});
}
