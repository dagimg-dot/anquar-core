#!/usr/bin/env bun

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { blockText, materializeBlocks } from "./blocks.ts";
import { parseOpf } from "./epub/opf.ts";
import { parseArticle } from "./everything/article.ts";
import { DomWalkerBlockExtractor } from "./extractors/block/dom-walker.ts";
import { parseEpub } from "./node.ts";
import { cardLines, PHONE_LAYOUT, paginate } from "./paginate.ts";
import { hardSplit, splitSentences } from "./sentences.ts";
import type { Block, Card, CardLayout, ParsedBook } from "./types.ts";
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

function title(name: string) {
	console.log(`\n── ${name} ──`);
}

const same = (a: unknown, b: unknown) =>
	JSON.stringify(a) === JSON.stringify(b);

const squash = (s: string) => s.replace(/\s+/g, " ").trim();

function extract(html: string): Block[] {
	return materializeBlocks(
		new DomWalkerBlockExtractor().extract(`<html><body>${html}</body></html>`),
		0,
		"t-",
		() => null,
	);
}

function chapterOf(index: number, html: string) {
	return {
		index,
		blocks: materializeBlocks(
			new DomWalkerBlockExtractor().extract(
				`<html><body>${html}</body></html>`,
			),
			index,
			`c${index}-`,
			() => null,
		),
	};
}

const cardText = (card: Card) => squash(card.blocks.map(blockText).join(" "));

const sentence = (n: number, words: number) =>
	`${["Alpha", "Bravo", "Charlie", "Delta", "Echo"][n % 5]} ${"word ".repeat(words - 2)}end.`;

const LAYOUTS: [string, CardLayout][] = [
	["large type", { charsPerLine: 20, linesPerCard: 11 }],
	["phone", PHONE_LAYOUT],
	["tablet", { charsPerLine: 60, linesPerCard: 30 }],
];

const FIRST_CARD_OPENINGS: Record<string, string> = {
	"01-show-your-work.epub": "For Meghan",
	"02-worldly-philosophers.epub": "To my teachers",
	"03-tokyo-zodiac-murders.epub": "Whose dark or troubled mind",
	"04-thinking-fast-and-slow.epub": "Dedication In memory of Amos Tversky",
	"05-thousand-splendid-suns.epub": "This book is dedicated to Haris and Farah",
	"06-our-man-in-damascus.epub": "ELIE COHN by Eli Ban-Hanan",
	"07-what-is-it-like-to-be-a-bat.epub":
		"Preface “What Is It Like to Be a Bat?”",
	"08-inference-engineering.epub": "Preface Inference is the most valuable",
	"09-useful-not-true.epub": "What’s this about? This book is about reframing",
	"10-flowers-for-algernon.epub": "For my mother And in memory of my father",
	"11-existentialism-is-a-humanism.epub":
		"Jean-Paul Sartre 1946 Existentialism Is a Humanism",
	"12-how-to-read-a-book.epub": "Preface ix:",
	"13-zero-to-one.epub": "Preface EVERY MOMENT IN BUSINESS",
	"14-mans-search-for-meaning.epub": "Viktor E. Frankl, c. 1949",
	"15-nine-billion-names.epub":
		'The Nine Billion Names of God "Science fiction readers',
	"16-qed.epub": "PREMESSA Le Alix G. Mautner Memorial Lectures",
	"17-project-hail-mary.epub": "",
	"18-post-office.epub": "Several of these chapters appeared",
	"19-brothers-karamazov.epub": "Epigraph Verily, verily, I say unto you",
	"20-midnight-library.epub": "To all the health workers.",
};

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
		assert(r.join(" ") === "one two three four five six", "no data loss");
		assert(
			r.every((c) => c.length <= 10),
			"each chunk within limit",
		);
	}
	{
		const r = hardSplit("abcdefghijklmnop", 5);
		assert(r.length === 4, "hard-cuts 16 chars into 4 chunks of 5");
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

	title("pagination");
	{
		const layout: CardLayout = { charsPerLine: 40, linesPerCard: 12 };

		const dialogue = chapterOf(
			0,
			Array.from({ length: 20 }, (_, i) => `<p>“Line ${i}.”</p>`).join(""),
		);
		const talk = paginate([dialogue], layout);
		assert(talk.length > 1 && talk.length < 20, "short paragraphs share cards");
		assert(
			talk.every((c) => cardLines(c.blocks, layout) <= layout.linesPerCard),
			"no card is taller than the screen",
		);

		const long = chapterOf(
			0,
			`<p>${Array.from({ length: 30 }, (_, i) => sentence(i, 9)).join(" ")}</p>`,
		);
		const pages = paginate([long], layout);
		assert(pages.length > 1, "a paragraph taller than a card is split");
		assert(
			pages.every((c) => /end\.$/.test(cardText(c))),
			"a split paragraph breaks between sentences",
		);
		assert(
			squash(pages.map(cardText).join(" ")) ===
				squash(blockText(long.blocks[0])),
			"splitting a paragraph neither loses nor repeats text",
		);
		assert(
			new Set(pages.map((c) => c.id)).size === pages.length,
			"split cards get distinct ids",
		);

		const titled = paginate(
			[chapterOf(0, `<h1>Title</h1><p>${sentence(0, 12)}</p>`)],
			layout,
		);
		assert(
			titled.length === 1 &&
				titled[0].blocks.map((b) => b.type).join() === "heading,text",
			"a chapter heading sits on the card with the text it opens",
		);

		const part = paginate(
			[
				chapterOf(0, "<h1>Part One</h1>"),
				chapterOf(1, `<h2>1</h2><p>${sentence(1, 8)}</p>`),
			],
			layout,
		);
		assert(
			part.length === 1 && part[0].blocks.length === 3,
			"a part title heads the first card of the chapter after it",
		);

		const items = Array.from(
			{ length: 12 },
			(_, i) => `<li>${sentence(i, 6)}</li>`,
		).join("");
		const listed = paginate([chapterOf(0, `<ol>${items}</ol>`)], layout);
		const starts = listed.map((c) =>
			c.blocks[0].type === "list" ? c.blocks[0].start : 0,
		);
		assert(listed.length > 1, "a long list splits across cards");
		assert(
			starts[0] === 1 && starts.slice(1).every((s, i) => s > starts[i]),
			"a split ordered list keeps counting",
		);

		const figure = paginate(
			[
				chapterOf(
					0,
					`<p>${sentence(2, 60)}</p><img src="a.png"/><p>Figure 1: A chart</p><p>${sentence(3, 8)}</p>`,
				),
			],
			layout,
		);
		const pictured = figure.find((c) =>
			c.blocks.some((b) => b.type === "image"),
		);
		assert(
			pictured?.blocks.map((b) => b.type).join() === "image,text",
			"a picture shares its card with its caption, and not the long text before it",
		);

		const widowed = paginate(
			[
				chapterOf(
					0,
					`<p>${Array.from({ length: 6 }, (_, i) => sentence(i, 12)).join(" ")}</p><p>The end.</p>`,
				),
			],
			layout,
		);
		const tail = widowed[widowed.length - 1];
		assert(
			widowed.length === 1 || tail.blocks.length > 1,
			"a chapter does not end on a card holding one short line",
		);
		assert(
			squash(widowed.map(cardText).join(" ")) ===
				squash(
					`${Array.from({ length: 6 }, (_, i) => sentence(i, 12)).join(" ")} The end.`,
				),
			"rebalancing the last card neither loses nor repeats text",
		);

		const broken = paginate(
			[
				chapterOf(
					0,
					`<p>${sentence(4, 8)}</p><hr/><h2>Next</h2><p>${sentence(1, 8)}</p>`,
				),
			],
			layout,
		);
		assert(
			broken.every((c) => c.blocks[c.blocks.length - 1].type !== "break"),
			"no card ends on a scene break",
		);
		assert(
			!broken.some((c) => c.blocks.some((b) => b.type === "break")),
			"a scene break right before a heading is dropped",
		);
	}

	if (testEpub) {
		title("Sample EPUBs");
		const samplesDir = join(__dirname, "..", "sample_epubs");
		let epubFiles: string[] = [];
		try {
			epubFiles = readdirSync(samplesDir)
				.filter((f) => f.endsWith(".epub"))
				.sort()
				.map((f) => join(samplesDir, f));
		} catch {
			console.error("  ⚠ sample_epubs/ directory not found");
		}

		assert(epubFiles.length > 0, `found ${epubFiles.length} sample EPUBs`);

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
					if (b.type === "text" || b.type === "heading") {
						assert(!!b.content, `${name}: ch${ch.index} ${b.type} has content`);
						assert(
							runsText(b.runs) === b.content,
							`${name}: ch${ch.index} ${b.type} runs spell its content`,
						);
						assert(
							b.charCount === b.content.length,
							`${name}: ch${ch.index} ${b.type} charCount`,
						);
					}
					if (b.type === "image") {
						assert(!!b.src, `${name}: ch${ch.index} image block has src`);
					}
					if (b.type === "list") {
						assert(b.items.length > 0, `${name}: ch${ch.index} list has items`);
						assert(
							b.items.every((it) => it.content.trim().length > 0),
							`${name}: ch${ch.index} list items non-empty`,
						);
					}
				}
			}

			const source = squash(
				book.chapters.flatMap((ch) => ch.blocks.map(blockText)).join(" "),
			);

			for (const [label, layout] of LAYOUTS) {
				const cards = paginate(book.chapters, layout);
				const where = `${name} (${label})`;

				assert(
					squash(cards.flatMap((c) => c.blocks.map(blockText)).join(" ")) ===
						source,
					`${where}: cards hold every word of the book once, in order`,
				);
				assert(
					new Set(cards.map((c) => c.id)).size === cards.length,
					`${where}: card ids are distinct`,
				);

				for (const c of cards) {
					const kinds = c.blocks.map((b) => b.type);
					assert(c.blocks.length > 0, `${where}: card ${c.id} is not empty`);
					const height = cardLines(c.blocks, layout);
					const lone =
						c.blocks.length === 1 || kinds.every((k) => k === "heading");
					assert(
						height <= layout.linesPerCard || lone,
						`${where}: card ${c.id} fits the screen (${height.toFixed(1)} lines)`,
					);
					assert(
						kinds[kinds.length - 1] !== "heading" ||
							kinds.every((k) => k === "heading"),
						`${where}: card ${c.id} does not end on a heading`,
					);
					assert(
						kinds[kinds.length - 1] !== "break",
						`${where}: card ${c.id} does not end on a scene break`,
					);
				}
			}

			const cards = paginate(book.chapters, PHONE_LAYOUT);
			const opening = cards.slice(0, 3).map(cardText).join(" ");
			assert(
				!APPARATUS_TEXT.test(opening),
				`${name}: the feed does not open on copyright or watermarks`,
			);
			const expected = FIRST_CARD_OPENINGS[name];
			if (expected !== undefined) {
				assert(
					cardText(cards[0]).startsWith(expected),
					`${name}: opens on "${expected}" (got "${cardText(cards[0]).slice(0, 60)}")`,
				);
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

		assert(urls.length > 0, `found ${urls.length} sample URLs`);

		for (const url of urls) {
			console.error(`  ${url}`);
			try {
				const article = await parseArticle(url);

				assert(!!article.title, `${url}: has title`);
				assert(!!article.url, `${url}: has url`);
				assert(article.blocks.length > 0, `${url}: has blocks`);

				const cards = paginate(
					[{ index: 0, blocks: article.blocks }],
					PHONE_LAYOUT,
				);
				assert(cards.length > 0, `${url}: paginates`);
				for (const c of cards) {
					assert(
						cardLines(c.blocks, PHONE_LAYOUT) <= PHONE_LAYOUT.linesPerCard ||
							c.blocks.length === 1,
						`${url}: card ${c.id} fits the screen`,
					);
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
		for (const f of failures.slice(0, 60)) console.error(`  • ${f}`);
		if (failures.length > 60)
			console.error(`  … and ${failures.length - 60} more`);
		process.exit(1);
	}
}

run().catch((e) => {
	console.error("Test harness crashed:", e);
	process.exit(1);
});
