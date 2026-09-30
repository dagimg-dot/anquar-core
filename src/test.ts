#!/usr/bin/env bun

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { blockText, materializeBlocks } from "./blocks.ts";
import { chunkBlocks, chunkBook } from "./chunker.ts";
import { parseOpf } from "./epub/opf.ts";
import { parseArticle } from "./everything/article.ts";
import { DomWalkerBlockExtractor } from "./extractors/block/dom-walker.ts";
import { parseEpub } from "./node.ts";
import { hardSplit, splitSentences } from "./sentences.ts";
import type { Block, ParsedBook } from "./types.ts";
import { DEFAULT_CHUNK_CONFIG } from "./types.ts";
import { collapseRuns, LINE_BREAK, runsText } from "./utils/runs.ts";

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

const same = (a: unknown, b: unknown) =>
	JSON.stringify(a) === JSON.stringify(b);

function title(name: string) {
	console.log(`\n── ${name} ──`);
}

const APPARATUS_TEXT =
	/all rights reserved|\bisbn\b|library of congress|oceanofpdf/i;

async function run() {
	const args = process.argv.slice(2);
	const testAll = args.length === 0 || args.includes("--all");
	const testEpub = testAll || args.includes("--epub");
	const testArticle = testAll || args.includes("--article");

	title("splitSentences");
	assert(
		same(splitSentences("Hello world. This is fine."), [
			"Hello world.",
			"This is fine.",
		]),
		"splits on period",
	);
	assert(
		same(splitSentences("What? Really! Yes."), ["What?", "Really!", "Yes."]),
		"splits on ? and !",
	);
	assert(
		same(splitSentences("He arrived at 5 p.m. and waited."), [
			"He arrived at 5 p.m. and waited.",
		]),
		"a lowercase word after a period continues the sentence",
	);
	assert(
		same(splitSentences("I wonder... what if? Let's go."), [
			"I wonder... what if?",
			"Let's go.",
		]),
		"an ellipsis before lowercase is not a boundary",
	);
	assert(
		same(splitSentences("No punctuation here"), ["No punctuation here"]),
		"no split without punctuation",
	);
	assert(
		splitSentences("   ").length === 0,
		"empty result for whitespace-only",
	);
	assert(
		same(
			splitSentences(
				"Eno calls it “scenius.” Under this model, ideas come from groups. “Really?” she asked.",
			),
			[
				"Eno calls it “scenius.”",
				"Under this model, ideas come from groups.",
				"“Really?” she asked.",
			],
		),
		"curly quotes close a sentence and open the next",
	);
	assert(
		same(splitSentences("“Wait!” he said. Then he left."), [
			"“Wait!” he said.",
			"Then he left.",
		]),
		"a quoted exclamation followed by lowercase stays one sentence",
	);
	assert(
		same(splitSentences("Mr. Smith met Dr. Jones. They talked."), [
			"Mr. Smith met Dr. Jones.",
			"They talked.",
		]),
		"honorifics do not end sentences",
	);
	assert(
		splitSentences("J. B. S. Haldane agreed with Mortimer J. Adler.").length ===
			1,
		"initials do not end sentences",
	);
	assert(
		same(splitSentences("It rained… Then it stopped."), [
			"It rained…",
			"Then it stopped.",
		]),
		"an ellipsis before a capital is a boundary",
	);
	assert(
		same(splitSentences("今日は晴れ。明日は雨。"), [
			"今日は晴れ。",
			"明日は雨。",
		]),
		"ideographic stops split without spaces",
	);

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

	title("collapseRuns");
	{
		const plain = { bold: false, italic: false };
		const lines = collapseRuns([
			{ text: `  roses are red,${LINE_BREAK}`, ...plain },
			{ text: `  violets${LINE_BREAK}${LINE_BREAK} are blue  `, ...plain },
		]);
		assert(
			runsText(lines) === "roses are red,\nviolets\nare blue",
			"a <br> survives as one newline, with no space on either side",
		);
		const source = collapseRuns([{ text: "one\n  two", ...plain }]);
		assert(
			runsText(collapseRuns(source)) === runsText(source),
			"collapsing twice changes nothing",
		);
		const edges = collapseRuns([
			{ text: `${LINE_BREAK} text ${LINE_BREAK}`, ...plain },
		]);
		assert(runsText(edges) === "text", "breaks at either end are dropped");
	}

	title("headings & lists");
	{
		const extract = (html: string): Block[] =>
			materializeBlocks(
				new DomWalkerBlockExtractor().extract(
					`<html><body>${html}</body></html>`,
				),
				0,
				"t-",
				() => null,
			);

		const headings = extract("<h1>One</h1><h3>Three</h3>");
		assert(headings.length === 2, "emits one block per heading");
		assert(
			headings[0]?.type === "heading" && headings[0].level === 1,
			"h1 becomes a level-1 heading",
		);
		assert(
			headings[1]?.type === "heading" && headings[1].level === 3,
			"h3 becomes a level-3 heading",
		);

		const [spaced] = extract("<h2>  Spaced   Out  </h2>");
		assert(
			spaced?.type === "heading" && spaced.content === "Spaced Out",
			"heading whitespace is collapsed and trimmed",
		);

		const [styled] = extract("<h2>A <em>Nested</em> Heading</h2>");
		assert(
			styled?.type === "heading" &&
				styled.runs.some((r) => r.italic && r.text === "Nested"),
			"heading keeps inline styling as runs",
		);

		const [pictured] = extract('<h1><img src="c1.jpg" alt="Chapter 1"/></h1>');
		assert(
			pictured?.type === "heading" && pictured.content === "Chapter 1",
			"a heading set as a picture reads its alt text",
		);

		const promoted = extract(
			"<p><b>“What’s two plus two?”</b></p><p>Something irritates me.</p>",
		);
		assert(
			promoted[0]?.type === "text",
			"a bold line ending in a quoted question is dialogue, not a title",
		);

		const [ordered] = extract('<ol start="4"><li>a</li><li>b</li></ol>');
		assert(
			ordered?.type === "list" &&
				ordered.ordered &&
				ordered.items.length === 2 &&
				ordered.start === 4,
			"ol becomes an ordered list that keeps its start number",
		);

		const [bulleted] = extract("<ul><li>a</li></ul>");
		assert(
			bulleted?.type === "list" && !bulleted.ordered,
			"ul becomes an unordered list",
		);

		const [nested] = extract("<ul><li>outer<ul><li>inner</li></ul></li></ul>");
		assert(
			nested?.type === "list" &&
				nested.items.length === 2 &&
				nested.items[0].depth === 0 &&
				nested.items[1].depth === 1,
			"nested list items keep document order and gain depth",
		);
		assert(
			nested?.type === "list" && nested.items[0].content === "outer",
			"a nested list is not flattened into its parent item's text",
		);

		const [bolded] = extract("<ul><li><strong>Term:</strong> body</li></ul>");
		assert(
			bolded?.type === "list" && bolded.items[0].runs[0].bold,
			"list items keep inline styling as runs",
		);

		const [empties] = extract("<ul><li></li><li>real</li></ul>");
		assert(
			empties?.type === "list" && empties.items.length === 1,
			"empty list items are dropped",
		);

		const [charCounted] = extract("<ul><li>abc</li><li>de</li></ul>");
		assert(
			charCounted?.type === "list" && charCounted.charCount === 5,
			"list charCount sums its items",
		);

		const separated = extract("<p>before</p><h2>Head</h2><p>after</p>");
		assert(
			separated.map((b) => b.type).join(",") === "text,heading,text",
			"a heading breaks the surrounding paragraph flow",
		);
	}

	title("paragraph structure");
	{
		const extract = (html: string): Block[] =>
			materializeBlocks(
				new DomWalkerBlockExtractor().extract(
					`<html><body>${html}</body></html>`,
				),
				0,
				"t-",
				() => null,
			);

		const [verse] = extract(
			"<p>Tyger Tyger, burning bright,<br/>In the forests</p>",
		);
		assert(
			verse?.type === "text" &&
				verse.content === "Tyger Tyger, burning bright,\nIn the forests",
			"a <br> inside a paragraph becomes a line break",
		);

		const [indented] = extract("<p>one\n    two</p>");
		assert(
			indented?.type === "text" && indented.content === "one two",
			"newlines in the markup are only spaces",
		);

		const scenes = extract(
			"<p>One.</p><hr/><p>Two.</p><p>* * *</p><p>Three.</p>",
		);
		assert(
			scenes.map((b) => b.type).join(",") === "text,break,text,break,text",
			"rules and ornament lines become scene breaks",
		);

		const [row, gappy] = extract(
			"<table><tr><td>Akiko</td><td>Masako’s daughter</td></tr><tr><td>1936</td><td> </td></tr></table>",
		);
		assert(
			row?.type === "text" && row.content === "Akiko · Masako’s daughter",
			"a table row reads as one line, cells divided",
		);
		assert(
			gappy?.type === "text" && gappy.content === "1936",
			"an empty cell leaves no divider behind",
		);

		const listed = extract(
			"<dl><dt>Azoth</dt><dd>The perfect woman</dd></dl><aside>Six daughters</aside><aside>One body</aside>",
		);
		assert(
			same(
				listed.map((b) => (b.type === "text" ? b.content : b.type)),
				["Azoth", "The perfect woman", "Six daughters", "One body"],
			),
			"definition terms and asides end their own blocks",
		);

		const [noted] = extract(
			'<p>In the footnote.<a epub:type="noteref" href="notes.xhtml#n1">fn1</a> The test<sup><a href="#r2">2</a></sup> ran.</p>',
		);
		assert(
			noted?.type === "text" &&
				noted.content === "In the footnote. The test ran.",
			"footnote markers are dropped",
		);

		const [squared] = extract("<p>x<sup>2</sup> grows</p>");
		assert(
			squared?.type === "text" && squared.content === "x2 grows",
			"a superscript that links nowhere is kept",
		);

		const [backlink] = extract('<p>Agent 88<a href="index.html#p7">8</a></p>');
		assert(
			backlink?.type === "text" && backlink.content === "Agent 888",
			"a link that continues a number is not a footnote marker",
		);

		const [glued] = extract(
			'<p>They felt understood.<a href="notes.xhtml#n10" class="c39">10</a> And</p>',
		);
		assert(
			glued?.type === "text" && glued.content === "They felt understood. And",
			"a numbered link glued to the sentence before it is a footnote marker",
		);
	}

	title("package document");
	{
		const opf = parseOpf(
			'<package><metadata><dc:title>T</dc:title></metadata><manifest><item id="art" href="c.jpg" media-type="image/jpeg" properties="cover-image"/></manifest></package>',
			"OEBPS/content.opf",
		);
		assert(opf.coverId === "art", "an EPUB 3 cover-image item is the cover");
	}

	title("chunking structured blocks");
	{
		const config = {
			minChars: 80,
			maxChars: 100,
			includeChapterHeaders: false,
		};
		const extract = (html: string): Block[] =>
			materializeBlocks(
				new DomWalkerBlockExtractor().extract(
					`<html><body>${html}</body></html>`,
				),
				0,
				"t-",
				() => null,
			);

		const longHeading = "H".repeat(300);
		const chunkedHeading = chunkBlocks(
			extract(`<h1>${longHeading}</h1>`),
			0,
			config,
		);
		assert(
			chunkedHeading.length === 1 && chunkedHeading[0].type === "heading",
			"headings stay atomic even past maxChars",
		);

		const items = Array.from(
			{ length: 6 },
			(_, i) => `<li>${"x".repeat(40)}${i}</li>`,
		).join("");
		const chunkedList = chunkBlocks(extract(`<ul>${items}</ul>`), 0, config);
		assert(chunkedList.length > 1, "a long list splits across several cards");
		assert(
			chunkedList.every((b) => b.type === "list"),
			"list splits stay list blocks",
		);
		assert(
			chunkedList.every((b) => b.type === "list" && b.items.length > 0),
			"no split produces an empty card",
		);
		assert(
			chunkedList.reduce(
				(n, b) => n + (b.type === "list" ? b.items.length : 0),
				0,
			) === 6,
			"splitting a list preserves every item",
		);
		assert(
			new Set(chunkedList.map((b) => b.id)).size === chunkedList.length,
			"split list cards get distinct ids",
		);

		const oversized = chunkBlocks(
			extract(`<ul><li>${"y".repeat(450)}</li></ul>`),
			0,
			config,
		);
		assert(
			oversized.every((b) => b.charCount <= config.maxChars),
			"an item longer than maxChars is broken up",
		);

		const mixed = chunkBlocks(extract("<p>short.</p><h2>Head</h2>"), 0, config);
		assert(
			mixed.map((b) => b.type).join(",") === "text,heading",
			"a short paragraph before a heading is not swallowed by it",
		);
	}

	title("chapter headers");
	{
		const config = { ...DEFAULT_CHUNK_CONFIG };
		const chapterWith = (html: string): ParsedBook => ({
			title: "Preface",
			author: "",
			omitted: [],
			chapters: [
				{
					index: 0,
					title: "Preface",
					role: "body",
					frontMatter: false,
					blocks: materializeBlocks(
						new DomWalkerBlockExtractor().extract(
							`<html><body>${html}</body></html>`,
						),
						0,
						"t-",
						() => null,
					),
				},
			],
		});

		const synthesized = chunkBook(
			chapterWith("<p>Body text goes here.</p>"),
			config,
		);
		assert(
			synthesized[0]?.type === "heading" &&
				synthesized[0].content === "Preface",
			"a chapter with no heading gets a synthetic one",
		);

		const selfTitled = chunkBook(
			chapterWith("<h1>Preface</h1><p>Body.</p>"),
			config,
		);
		assert(
			selfTitled.filter((b) => b.type === "heading" && b.content === "Preface")
				.length === 1,
			"a chapter opening with its own title is not given a duplicate header",
		);
	}

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

			for (const omitted of book.omitted) {
				assert(
					omitted.words <= 1500 ||
						["notes", "index", "contents"].includes(omitted.role),
					`${name}: nothing long is dropped as ${omitted.role} ("${omitted.title}", ${omitted.words} words)`,
				);
			}

			for (const ch of book.chapters) {
				assert(ch.index >= 0, `${name}: chapter ${ch.index} has valid index`);
				assert(
					ch.title === ch.title.trim() && !/[\u00AD\u200B]/.test(ch.title),
					`${name}: chapter ${ch.index} title is clean`,
				);
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
							runsText(b.runs) === b.content,
							`${name}: ch${ch.index} text runs spell its content`,
						);
						assert(
							b.charCount === b.content.length,
							`${name}: ch${ch.index} text block charCount`,
						);
					}
					if (b.type === "image") {
						assert(!!b.src, `${name}: ch${ch.index} image block has src`);
					}
					if (b.type === "heading") {
						assert(!!b.content, `${name}: ch${ch.index} heading has content`);
						assert(
							b.charCount === b.content.length,
							`${name}: ch${ch.index} heading charCount`,
						);
						assert(
							b.level >= 1 && b.level <= 6,
							`${name}: ch${ch.index} heading level in range`,
						);
					}
					if (b.type === "list") {
						assert(b.items.length > 0, `${name}: ch${ch.index} list has items`);
						assert(
							b.items.every((it) => it.content.trim().length > 0),
							`${name}: ch${ch.index} list items non-empty`,
						);
						assert(
							b.items.every((it) => it.depth >= 0),
							`${name}: ch${ch.index} list item depth non-negative`,
						);
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

			const opening = blocks.slice(0, 3).map(blockText).join(" ");
			assert(
				!APPARATUS_TEXT.test(opening),
				`${name}: the feed does not open on copyright or watermarks`,
			);

			for (const b of blocks) {
				if (b.type !== "list") continue;
				assert(
					b.charCount <= config.maxChars,
					`${name}: list card ≤${config.maxChars} (got ${b.charCount})`,
				);
				assert(b.items.length > 0, `${name}: list card non-empty`);
			}
		}
	}

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
