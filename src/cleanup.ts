import { blockText } from "./blocks.ts";
import type { RawBlock, RawTextBlock } from "./extractors/block/types.ts";
import { imageSize } from "./utils/image-size.ts";

export interface CleanupSection {
	title: string;
	blocks: RawBlock[];
	imageBytes: (src: string) => Uint8Array | null;
}

const MIN_PICTURE_AREA_PX = 10_000;

const ORNAMENT_REPEATS = 3;

const WATERMARK = /^(https?:\/\/)?(www\.)?[\w-]+(\.[\w-]+)+(\/\S*)?$/i;

const SECTION_NUMBER = /^([0-9]{1,3}|[IVXLC]{1,7})\.?$/;

const PARAGRAPH_END = /[.!?…:;"”’')\]—–-]$/;

const FULL_LINE_SHARE = 0.7;

const ENTRY_NUMBER = /^(\d{1,3}[.):]?|[IVXLC]{1,7}[.):]|[IVXLC]{2,7})\s/;

function wordsOf(text: string): string[] {
	return text
		.normalize("NFKD")
		.replace(/[\u0300-\u036F]/g, "")
		.toLowerCase()
		.split(/[^\p{L}\p{N}]+/u)
		.filter(Boolean);
}

function startsWith(words: string[], prefix: string[]): boolean {
	return prefix.length > 0 && prefix.every((w, i) => words[i] === w);
}

function imageKey(section: CleanupSection, src: string): Uint8Array | string {
	return section.imageBytes(src) ?? src;
}

function isOrnamentSized(bytes: Uint8Array | null): boolean {
	const size = bytes && imageSize(bytes);
	return !!size && size.width * size.height < MIN_PICTURE_AREA_PX;
}

function dropDoubledPictures(section: CleanupSection): RawBlock[] {
	return section.blocks.filter((block, i) => {
		const prev = section.blocks[i - 1];
		return !(
			block.type === "image" &&
			prev?.type === "image" &&
			imageKey(section, prev.src) === imageKey(section, block.src)
		);
	});
}

function openWithTitle(title: string, blocks: RawBlock[]): RawBlock[] {
	const key = wordsOf(title);
	const hasText = blocks.some((b) => b.type === "text" || b.type === "list");
	if (key.length === 0 || !hasText) return blocks;

	const first = blocks.findIndex(
		(b) => b.type !== "image" && b.type !== "break",
	);
	const opening = blocks[first];
	if (opening?.type === "heading") return blocks;
	const titledNearTop = blocks
		.slice(first, first + 4)
		.some(
			(b) =>
				b.type === "heading" && wordsOf(b.content).join(" ") === key.join(" "),
		);
	if (titledNearTop) return blocks;

	if (opening?.type === "text" && opening.content.length <= 80) {
		const line = wordsOf(opening.content);
		const same = line.join(" ") === key.join(" ");
		const sentence = /[.!?]$/.test(opening.content) && !same;
		if (!sentence && (startsWith(key, line) || startsWith(line, key))) {
			const out = [...blocks];
			out[first] = {
				type: "heading",
				level: 1,
				content: opening.content,
				runs: opening.runs,
			};
			return out;
		}
	}

	return [
		{
			type: "heading",
			level: 1,
			content: title,
			runs: [{ text: title, bold: false, italic: false }],
		},
		...blocks,
	];
}

function shouts(line: string): boolean {
	return /\p{L}/u.test(line) && line === line.toUpperCase();
}

function rejoinPrintLines(blocks: RawBlock[]): RawBlock[] {
	const lines = blocks.filter(
		(b): b is RawTextBlock => b.type === "text" && b.content.length >= 25,
	);
	const unfinished = lines.filter((b) => !PARAGRAPH_END.test(b.content));
	if (lines.length < 6 || unfinished.length < lines.length * 0.5) return blocks;

	const continuedInLowercase = blocks.filter((block, i) => {
		const prev = blocks[i - 1];
		return (
			block.type === "text" &&
			prev?.type === "text" &&
			!PARAGRAPH_END.test(prev.content) &&
			/^\p{Ll}/u.test(block.content)
		);
	});
	const readsAsVerse = continuedInLowercase.length < unfinished.length * 0.3;
	if (readsAsVerse) return blocks;

	const widths = unfinished.map((b) => b.content.length).sort((a, b) => a - b);
	const fullLine = widths[Math.floor(widths.length / 2)] * FULL_LINE_SHARE;

	const out: RawBlock[] = [];
	let lastLine = "";
	for (const block of blocks) {
		const prev = out[out.length - 1];
		const carriesOn =
			block.type === "text" &&
			prev?.type === "text" &&
			!PARAGRAPH_END.test(lastLine) &&
			lastLine.length >= fullLine &&
			!/^[—–―"“‘]/.test(block.content) &&
			!ENTRY_NUMBER.test(block.content) &&
			(shouts(block.content) || !shouts(lastLine));
		lastLine = block.type === "text" ? block.content : "";
		if (carriesOn) {
			out[out.length - 1] = {
				type: "text",
				content: `${prev.content} ${block.content}`,
				runs: [
					...prev.runs,
					{ text: " ", bold: false, italic: false },
					...block.runs,
				],
			};
		} else {
			out.push(block);
		}
	}
	return out;
}

export function cleanupSections(
	sections: CleanupSection[],
	coverImage: Uint8Array | null,
): RawBlock[][] {
	const deduped = sections.map(dropDoubledPictures);

	const imageCounts = new Map<Uint8Array | string, number>();
	const textCounts = new Map<string, number>();
	deduped.forEach((blocks, s) => {
		for (const block of blocks) {
			if (block.type === "image") {
				const key = imageKey(sections[s], block.src);
				imageCounts.set(key, (imageCounts.get(key) ?? 0) + 1);
			} else if (block.type === "text" && WATERMARK.test(block.content)) {
				textCounts.set(block.content, (textCounts.get(block.content) ?? 0) + 1);
			}
		}
	});

	return deduped.map((blocks, s) => {
		const section = sections[s];
		const kept = blocks.filter((block) => {
			if (block.type === "text") {
				return (textCounts.get(block.content) ?? 0) < ORNAMENT_REPEATS;
			}
			if (block.type !== "image") return true;
			const bytes = section.imageBytes(block.src);
			if (coverImage && bytes === coverImage) return false;
			if (isOrnamentSized(bytes)) return false;
			return (
				(imageCounts.get(imageKey(section, block.src)) ?? 0) < ORNAMENT_REPEATS
			);
		});
		const trimmed = kept.filter(
			(block, i) =>
				block.type !== "break" ||
				(i > 0 && i < kept.length - 1 && kept[i - 1].type !== "break"),
		);
		const numbered = trimmed.map(
			(block): RawBlock =>
				block.type === "text" && SECTION_NUMBER.test(block.content)
					? {
							type: "heading",
							level: 2,
							content: block.content,
							runs: block.runs,
						}
					: block,
		);
		return openWithTitle(section.title, rejoinPrintLines(numbered)).filter(
			(block) => block.type !== "text" || blockText(block),
		);
	});
}
