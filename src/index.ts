#!/usr/bin/env bun

import { chunkBook } from "./chunker.ts";
import type { ParseOptions } from "./config.ts";
import { parseEpub } from "./node.ts";
import type { Block, ChunkConfig, ParsedBook } from "./types.ts";
import { DEFAULT_CHUNK_CONFIG } from "./types.ts";

const BLOCK_PREVIEW_MAX = 140;
const SEPARATOR_WIDTH = 48;

function printHelp(): void {
	console.log(`
anquar — chunk EPUBs for short-form reading

USAGE
  anquar parse <file.epub>              Parse and chunk an EPUB
  anquar parse <file.epub> --stats      Show block statistics only
  anquar help                           Show this message

OPTIONS
  --min-chars <number>   Min chars per chunk  (default: ${DEFAULT_CHUNK_CONFIG.minChars})
  --max-chars <number>   Max chars per chunk  (default: ${DEFAULT_CHUNK_CONFIG.maxChars})
  --no-headers           Omit chapter headers
  --sample <number>      Show first N blocks then stop  (default: all)
  --all                  Keep covers, copyright, contents, notes and indexes
  --debug                Print extractor tracing to stderr
`);
}

function truncate(text: string): string {
	return text.length > BLOCK_PREVIEW_MAX
		? `${text.slice(0, BLOCK_PREVIEW_MAX - 3)}...`
		: text;
}

function formatBlock(b: Block, idx: number, total: number): void {
	const p = `[${idx + 1}/${total}]`;

	switch (b.type) {
		case "image": {
			const size = b.data ? ` ${b.data.byteLength} bytes` : " no data";
			console.log(`${p} ██ IMAGE ██ ${b.src}${size}`);
			return;
		}
		case "heading":
			console.log(
				`${p} ${"#".repeat(b.level)} ${truncate(b.content)}  (${b.charCount}c)`,
			);
			return;
		case "list": {
			const kind = b.ordered ? "ordered" : "bulleted";
			console.log(
				`${p} ${kind} list, ${b.items.length} items  (${b.charCount}c)`,
			);
			b.items.forEach((item, i) => {
				const bullet = b.ordered ? `${i + 1}.` : "•";
				console.log(
					`      ${"  ".repeat(item.depth)}${bullet} ${truncate(item.content)}`,
				);
			});
			return;
		}
		case "text":
			console.log(`${p} ${truncate(b.content)}  (${b.charCount}c)`);
			return;
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

async function cmdParse(
	filePath: string,
	config: ChunkConfig,
	statsOnly: boolean,
	sample: number,
	parseOptions: Partial<ParseOptions>,
): Promise<void> {
	console.error(`[anquar] ${filePath}${parseOptions.debug ? " (debug)" : ""}`);
	const book = await parseEpub(filePath, parseOptions);
	const blocks = chunkBook(book, config);

	console.error(`  ${book.title} — ${book.author}`);
	console.error(
		`  ${book.chapters.length} chapters → ${blocks.length} blocks\n`,
	);

	printSections(book);

	if (statsOnly) {
		printStats(blocks, book.chapters.length);
		return;
	}

	let shown = 0;

	for (const ch of book.chapters) {
		const chBlocks = blocks.filter((b) => b.chapterIndex === ch.index);
		if (chBlocks.length === 0) continue;

		console.log(`\n▌ ${ch.title}`);
		console.log(`▌ ${"─".repeat(Math.min(ch.title.length, SEPARATOR_WIDTH))}`);

		for (const b of chBlocks) {
			if (sample > 0 && shown >= sample) break;
			formatBlock(b, shown, blocks.length);
			shown++;
		}
		if (sample > 0 && shown >= sample) break;
	}

	console.log("");
	if (sample > 0 && shown < blocks.length) {
		console.error(
			`[showing first ${shown} of ${blocks.length} blocks; use --sample 0 for all]`,
		);
	}
	printStats(blocks, book.chapters.length);
}

function printStats(blocks: Block[], chapterCount: number): void {
	const txt = blocks.filter((b) => b.type === "text");
	const headings = blocks.filter((b) => b.type === "heading");
	const lists = blocks.filter((b) => b.type === "list");
	const img = blocks.filter((b) => b.type === "image");
	const failed = img.filter((b) => !b.data).length;
	const lens = txt.map((b) => b.charCount);
	const listItems = lists.reduce((sum, b) => sum + b.items.length, 0);

	console.log(`── stats ──`);
	console.log(`  chapters:   ${chapterCount}`);
	console.log(`  text:       ${txt.length}`);
	console.log(`  headings:   ${headings.length}`);
	console.log(`  lists:      ${lists.length} (${listItems} items)`);
	if (failed > 0) {
		console.log(`  images:     ${img.length} (${failed} unresolved)`);
	} else {
		console.log(`  images:     ${img.length}`);
	}

	if (lens.length > 0) {
		const min = Math.min(...lens);
		const max = Math.max(...lens);
		const avg = Math.round(lens.reduce((a, b) => a + b, 0) / lens.length);
		console.log(`  chunk size: ${min}–${max} (avg ${avg}) chars`);
	} else {
		console.log(`  chunk size: (no text blocks)`);
	}
}

async function main(): Promise<void> {
	const args = process.argv.slice(2);

	if (args.length === 0 || args[0] === "help" || args[0] === "--help") {
		printHelp();
		process.exit(0);
	}

	const config: ChunkConfig = { ...DEFAULT_CHUNK_CONFIG };
	const parseOptions: Partial<ParseOptions> = { debug: false };
	let sample = 0;

	const positional = args.filter((a) => {
		if (a === "--no-headers") {
			config.includeChapterHeaders = false;
			return false;
		}
		if (a === "--all") {
			parseOptions.keepApparatus = true;
			return false;
		}
		if (a === "--debug") {
			parseOptions.debug = true;
			return false;
		}
		if (a.startsWith("--sample=")) {
			sample = parseInt(a.split("=")[1], 10);
			return false;
		}
		return true;
	});

	for (let i = 0; i < positional.length; i++) {
		if (positional[i] === "--min-chars" && i + 1 < positional.length) {
			config.minChars = parseInt(positional[i + 1], 10);
			positional.splice(i, 2);
			i--;
		} else if (positional[i] === "--max-chars" && i + 1 < positional.length) {
			config.maxChars = parseInt(positional[i + 1], 10);
			positional.splice(i, 2);
			i--;
		} else if (positional[i] === "--sample" && i + 1 < positional.length) {
			sample = parseInt(positional[i + 1], 10);
			positional.splice(i, 2);
			i--;
		}
	}

	const command = positional[0];
	const statsOnly = positional.includes("--stats");

	switch (command) {
		case "parse": {
			const filePath = positional[1];
			if (!filePath) {
				console.error("error: missing file path\n");
				printHelp();
				process.exit(1);
			}
			await cmdParse(filePath, config, statsOnly, sample, parseOptions);
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
