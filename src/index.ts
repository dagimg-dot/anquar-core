#!/usr/bin/env bun

import { blockText } from "./blocks.ts";
import type { ParseOptions } from "./config.ts";
import { parseEpub } from "./node.ts";
import { cardLines, PHONE_LAYOUT, paginate } from "./paginate.ts";
import type { Block, Card, CardLayout, ParsedBook } from "./types.ts";

const BLOCK_PREVIEW_MAX = 110;

function printHelp(): void {
	console.log(`
anquar — lay EPUBs out as cards for short-form reading

USAGE
  anquar parse <file.epub>              Parse and paginate an EPUB
  anquar parse <file.epub> --stats      Show section and card statistics only
  anquar help                           Show this message

OPTIONS
  --cpl <number>         Characters per line  (default: ${PHONE_LAYOUT.charsPerLine})
  --lines <number>       Lines per card       (default: ${PHONE_LAYOUT.linesPerCard})
  --sample <number>      Show the first N cards then stop  (default: all)
  --all                  Keep covers, copyright, contents, notes and indexes
  --debug                Print extractor tracing to stderr
`);
}

function truncate(text: string): string {
	const flat = text.replace(/\s+/g, " ");
	return flat.length > BLOCK_PREVIEW_MAX
		? `${flat.slice(0, BLOCK_PREVIEW_MAX - 1)}…`
		: flat;
}

function formatBlock(b: Block): string {
	switch (b.type) {
		case "image":
			return `▣ ${b.src}${b.data ? "" : " (no data)"}`;
		case "break":
			return "⁂";
		case "heading":
			return `${"#".repeat(b.level)} ${truncate(b.content)}`;
		case "list":
			return b.items
				.map((item, i) => {
					const bullet = b.ordered ? `${b.start + i}.` : "•";
					return `${"  ".repeat(item.depth)}${bullet} ${truncate(item.content)}`;
				})
				.join("\n        ");
		case "text":
			return truncate(blockText(b));
	}
}

function printSections(book: ParsedBook): void {
	console.log("── sections ──");
	for (const ch of book.chapters) {
		const mark = ch.frontMatter ? "front" : "     ";
		console.log(`  ${mark} ${ch.role.padEnd(10)} ${ch.title || "(untitled)"}`);
	}
	for (const s of book.omitted) {
		console.log(
			`  omit  ${s.role.padEnd(10)} ${s.title || "(untitled)"}  (${s.words} words)`,
		);
	}
}

function printCard(
	card: Card,
	index: number,
	total: number,
	layout: CardLayout,
) {
	const fill = Math.round(
		(cardLines(card.blocks, layout) / layout.linesPerCard) * 100,
	);
	const picture = card.blocks.some((b) => b.type === "image");
	console.log(
		`\n[${index + 1}/${total}] ${card.id}  ${picture ? "picture" : `${fill}%`}`,
	);
	for (const b of card.blocks) console.log(`      ${formatBlock(b)}`);
}

function printStats(book: ParsedBook, cards: Card[], layout: CardLayout): void {
	const text = cards.filter((c) => !c.blocks.some((b) => b.type === "image"));
	const fills = text
		.map((c) => cardLines(c.blocks, layout) / layout.linesPerCard)
		.sort((a, b) => a - b);
	const pct = (x: number) => `${Math.round(x * 100)}%`;
	const front = new Set(
		book.chapters.filter((c) => c.frontMatter).map((c) => c.index),
	);
	const opening = cards.findIndex((c) => !front.has(c.chapterIndex));

	console.log("\n── stats ──");
	console.log(
		`  chapters:    ${book.chapters.length} (${book.omitted.length} sections omitted)`,
	);
	console.log(
		`  cards:       ${cards.length} (${cards.length - text.length} with pictures)`,
	);
	console.log(`  front cards: ${Math.max(0, opening)}`);
	if (fills.length > 0) {
		const at = (q: number) =>
			fills[Math.min(fills.length - 1, Math.floor(q * fills.length))];
		const sparse = fills.filter((f) => f < 0.25).length;
		console.log(
			`  card fill:   p10 ${pct(at(0.1))} · median ${pct(at(0.5))} · p90 ${pct(at(0.9))}`,
		);
		console.log(`  under 25%:   ${sparse} cards`);
	}
}

async function cmdParse(
	filePath: string,
	layout: CardLayout,
	statsOnly: boolean,
	sample: number,
	parseOptions: Partial<ParseOptions>,
): Promise<void> {
	console.error(`[anquar] ${filePath}${parseOptions.debug ? " (debug)" : ""}`);
	const book = await parseEpub(filePath, parseOptions);
	const cards = paginate(book.chapters, layout);

	console.error(`  ${book.title} — ${book.author}`);
	console.error(`  ${book.chapters.length} chapters → ${cards.length} cards\n`);

	printSections(book);

	if (!statsOnly) {
		const shown = sample > 0 ? cards.slice(0, sample) : cards;
		let chapter = -1;
		shown.forEach((card, i) => {
			if (card.chapterIndex !== chapter) {
				chapter = card.chapterIndex;
				const title = book.chapters[chapter]?.title || "(untitled)";
				console.log(`\n▌ ${title}`);
			}
			printCard(card, i, cards.length, layout);
		});
		if (shown.length < cards.length) {
			console.error(
				`\n[showing first ${shown.length} of ${cards.length} cards; use --sample 0 for all]`,
			);
		}
	}

	printStats(book, cards, layout);
}

async function main(): Promise<void> {
	const args = process.argv.slice(2);

	if (args.length === 0 || args[0] === "help" || args[0] === "--help") {
		printHelp();
		process.exit(0);
	}

	const layout: CardLayout = { ...PHONE_LAYOUT };
	const parseOptions: Partial<ParseOptions> = { debug: false };
	let sample = 0;
	const positional: string[] = [];

	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		const value = () => Number.parseInt(args[++i] ?? "", 10);
		if (arg === "--all") parseOptions.keepApparatus = true;
		else if (arg === "--debug") parseOptions.debug = true;
		else if (arg === "--cpl") layout.charsPerLine = value();
		else if (arg === "--lines") layout.linesPerCard = value();
		else if (arg === "--sample") sample = value();
		else if (arg.startsWith("--sample="))
			sample = Number.parseInt(arg.slice(9), 10);
		else positional.push(arg);
	}

	const [command, filePath] = positional;
	const statsOnly = positional.includes("--stats");

	switch (command) {
		case "parse": {
			if (!filePath) {
				console.error("error: missing file path\n");
				printHelp();
				process.exit(1);
			}
			await cmdParse(filePath, layout, statsOnly, sample, parseOptions);
			break;
		}
		default:
			console.error(`error: unknown command "${command}"\n`);
			printHelp();
			process.exit(1);
	}
}

main().catch((err) => {
	console.error("fatal:", err);
	process.exit(1);
});
