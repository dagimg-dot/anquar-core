#!/usr/bin/env bun
/**
 * Test harness — runs parser + chunker tests against
 * EPUBs in sample_epubs/ and articles in sample_urls/list.json.
 *
 * Usage:
 *   bun test              → all (epub + article)
 *   bun test --epub       → EPUBs only
 *   bun test --article    → articles only
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chunkBook, hardSplit, splitSentences } from "./chunker.ts";
import { parseArticle } from "./everything/article.ts";
import { parseEpub } from "./node.ts";
import type { ParsedBook } from "./types.ts";
import { DEFAULT_CHUNK_CONFIG } from "./types.ts";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

let passed = 0;
let failed = 0;
const failures: string[] = [];

function assert(condition: boolean, msg: string) {
	if (condition) {
		passed++;
	} else {
		failed++;
		failures.push(msg);
		console.error(`  ✗ ${msg}`);
	}
}

function title(name: string) {
	console.log(`\n── ${name} ──`);
}

async function run() {
	const args = process.argv.slice(2);
	const testAll = args.length === 0 || args.includes("--all");
	const testEpub = testAll || args.includes("--epub");
	const testArticle = testAll || args.includes("--article");

	// ─── Unit: splitSentences ──────────────────────────────────────
	title("splitSentences");
	assert(
		JSON.stringify(splitSentences("Hello world. This is fine.")) ===
			JSON.stringify(["Hello world.", "This is fine."]),
		"splits on period",
	);
	assert(
		JSON.stringify(splitSentences("What? Really! Yes.")) ===
			JSON.stringify(["What?", "Really!", "Yes."]),
		"splits on ? and !",
	);
	{
		const r = splitSentences("He arrived at 5 p.m. and waited.");
		assert(r.length >= 1, "handles abbreviations without crashing");
	}
	{
		const r = splitSentences("I wonder... what if? Let's go.");
		assert(r.length === 2, "preserves ellipsis (2 parts)");
		assert(r[0] === "I wonder... what if?", "ellipsis not a boundary");
	}
	{
		const r = splitSentences("No punctuation here");
		assert(r.length === 1, "no split without punctuation");
		assert(r[0] === "No punctuation here", "returns input as-is");
	}
	{
		const r = splitSentences("   ");
		assert(r.length === 0, "empty result for whitespace-only");
	}

	// ─── Unit: hardSplit ──────────────────────────────────────────────
	title("hardSplit");
	{
		const r = hardSplit("short", 100);
		assert(r.length === 1 && r[0] === "short", "no split for short text");
	}
	{
		const r = hardSplit("one two three four five six", 10);
		assert(r.length > 1, "splits long text");
		const rejoined = r.join(" ");
		assert(
			rejoined.includes("one") && rejoined.includes("six"),
			"no data loss",
		);
		assert(
			r.every((c) => c.length <= 10),
			"each chunk within limit",
		);
	}
	{
		const r = hardSplit("abcdefghijklmnop", 5);
		assert(r.length === 4, "hard-cuts 16 chars into 4 chunks of 5");
		assert(r[0] === "abcde", "first chunk is 5 chars");
		assert(r.join("") === "abcdefghijklmnop", "no data loss");
	}

	// ─── Integration: sample EPUBs ─────────────────────────────────
	if (testEpub) {
		title("Sample EPUBs");
		const samplesDir = join(__dirname, "..", "sample_epubs");
		let epubFiles: string[] = [];
		try {
			epubFiles = readdirSync(samplesDir)
				.filter((f) => f.endsWith(".epub"))
				.map((f) => join(samplesDir, f));
		} catch {
			console.error("  ⚠ sample_epubs/ directory not found");
		}

		if (epubFiles.length > 0) {
			assert(true, `found ${epubFiles.length} sample EPUBs`);
		} else {
			assert(false, "no sample EPUBs found");
		}

		for (const file of epubFiles) {
			const name = file.split("/").pop() || file;
			console.error(`  ${name}`);

			let book: ParsedBook;
			try {
				book = await parseEpub(file);
			} catch (e: unknown) {
				const msg = e instanceof Error ? e.message : String(e);
				assert(false, `${name}: parse threw: ${msg}`);
				continue;
			}

			assert(!!book.title, `${name}: has title`);
			assert(!!book.author, `${name}: has author`);
			assert(book.chapters.length > 0, `${name}: has chapters`);

			for (const ch of book.chapters) {
				assert(ch.index >= 0, `${name}: chapter ${ch.index} has valid index`);
				assert(!!ch.title, `${name}: chapter ${ch.index} has title`);
				assert(ch.blocks.length > 0, `${name}: chapter ${ch.index} has blocks`);

				for (const b of ch.blocks) {
					assert(!!b.id, `${name}: ch${ch.index} block ${b.position} has id`);
					assert(
						b.chapterIndex === ch.index,
						`${name}: ch${ch.index} block chapterIndex mismatch`,
					);
					assert(b.position >= 0, `${name}: ch${ch.index} block has position`);

					if (b.type === "text") {
						assert(
							!!b.content,
							`${name}: ch${ch.index} text block has content`,
						);
						assert(
							b.charCount === b.content.length,
							`${name}: ch${ch.index} text block charCount`,
						);
					}
					if (b.type === "image") {
						assert(!!b.src, `${name}: ch${ch.index} image block has src`);
					}
				}
			}

			const config = { ...DEFAULT_CHUNK_CONFIG };
			const blocks = chunkBook(book, config);
			const textBlocks = blocks.filter(
				(b): b is Extract<typeof b, { type: "text" }> => b.type === "text",
			);

			for (const b of textBlocks) {
				assert(
					b.charCount <= config.maxChars + 50,
					`${name}: chunk ≤${config.maxChars}+50 (got ${b.charCount})`,
				);
				assert(b.charCount > 0, `${name}: chunk non-empty`);
			}
		}
	}

	// ─── Integration: sample URLs ──────────────────────────────────
	if (testArticle) {
		title("Sample URLs (articles)");
		const listPath = join(__dirname, "..", "sample_urls", "list.json");
		let urls: string[] = [];
		try {
			urls = JSON.parse(readFileSync(listPath, "utf-8"));
		} catch {
			console.error("  ⚠ sample_urls/list.json not found");
			assert(false, "sample_urls/list.json not found");
		}

		if (urls.length > 0) {
			assert(true, `found ${urls.length} sample URLs`);
		} else {
			assert(false, "no sample URLs found");
		}

		for (const url of urls) {
			console.error(`  ${url}`);
			try {
				const article = await parseArticle(url, {
					chunkConfig: {
						minChars: 80,
						maxChars: 600,
						includeChapterHeaders: false,
					},
				});

				assert(!!article.title, `${url}: has title`);
				assert(!!article.url, `${url}: has url`);
				assert(article.blocks.length > 0, `${url}: has blocks`);

				const textBlocks = article.blocks.filter((b) => b.type === "text");
				for (const b of textBlocks) {
					assert(b.charCount <= 900, `${url}: chunk ≤900 (got ${b.charCount})`);
					assert(b.charCount > 0, `${url}: chunk non-empty`);
				}
			} catch (e: unknown) {
				const msg = e instanceof Error ? e.message : String(e);
				assert(false, `${url}: parseArticle threw: ${msg}`);
			}
		}
	}

	// ─── Report ────────────────────────────────────────────────────
	console.log("\n═══════════════════════════════════");
	console.log(`  ${passed} passed, ${failed} failed`);
	console.log("═══════════════════════════════════\n");

	if (failures.length > 0) {
		for (const f of failures) console.error(`  • ${f}`);
		process.exit(1);
	}
}

run().catch((e) => {
	console.error("Test harness crashed:", e);
	process.exit(1);
});
