import { listCharCount } from "./blocks.ts";
import { hardSplit, splitSentences } from "./sentences.ts";
import type {
	Block,
	ChunkConfig,
	ListBlock,
	ListItem,
	ParsedBook,
	StyleRun,
	TextBlock,
} from "./types.ts";
import { normalizeRuns, runsText } from "./utils/runs.ts";

const BEFORE_FIRST_BLOCK = -1;

function runOffsets(runs: StyleRun[]): number[] {
	const offsets: number[] = [];
	let pos = 0;
	for (const r of runs) {
		offsets.push(pos);
		pos += r.text.length;
	}
	offsets.push(pos);
	return offsets;
}

function sliceRuns(
	runs: StyleRun[],
	offsets: number[],
	start: number,
	end: number,
): StyleRun[] {
	const group: StyleRun[] = [];
	for (let i = 0; i < runs.length; i++) {
		const rStart = offsets[i];
		const rEnd = offsets[i + 1];
		if (rEnd <= start) continue;
		if (rStart >= end) break;

		const clipped = runs[i].text.slice(
			Math.max(start, rStart) - rStart,
			Math.min(end, rEnd) - rStart,
		);
		if (clipped) group.push({ ...runs[i], text: clipped });
	}
	return group;
}

function locate(
	haystack: string,
	needle: string,
	from: number,
): [number, number] | null {
	const exact = haystack.indexOf(needle, from);
	if (exact >= 0) return [exact, exact + needle.length];

	const words = needle.trim().split(/\s+/);
	if (words.length === 0) return null;
	const pattern = words
		.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
		.join("\\s+");
	const match = new RegExp(pattern, "u").exec(haystack.slice(from));
	return match
		? [from + match.index, from + match.index + match[0].length]
		: null;
}

function splitRunsBySentence(runs: StyleRun[]): StyleRun[][] {
	const fullText = runsText(runs);
	const sentences = splitSentences(fullText);
	if (sentences.length <= 1) return [runs];

	const offsets = runOffsets(runs);
	const result: StyleRun[][] = [];
	let cursor = 0;

	for (const sentence of sentences) {
		const span = locate(fullText, sentence, cursor);
		if (!span) return [runs];
		cursor = span[1];
		const group = sliceRuns(runs, offsets, span[0], span[1]);
		if (group.length > 0) result.push(group);
	}

	return result.length > 0 ? result : [runs];
}

function hardSplitRuns(runs: StyleRun[], maxChars: number): StyleRun[][] {
	const fullText = runsText(runs);
	if (fullText.length <= maxChars) return [runs];

	const offsets = runOffsets(runs);
	const result: StyleRun[][] = [];
	let cursor = 0;

	for (const chunk of hardSplit(fullText, maxChars)) {
		const span = locate(fullText, chunk, cursor);
		if (!span) return [runs];
		cursor = span[1];
		const group = sliceRuns(runs, offsets, span[0], span[1]);
		if (group.length > 0) result.push(group);
	}

	return result.length > 0 ? result : [runs];
}

function appendRuns(buffer: StyleRun[], incoming: StyleRun[]): void {
	if (incoming.length === 0) return;

	const first = { ...incoming[0], text: ` ${incoming[0].text}` };
	const rest = incoming.slice(1);

	if (buffer.length === 0) {
		first.text = first.text.trimStart();
		buffer.push(first, ...rest);
		return;
	}

	const last = buffer[buffer.length - 1];
	if (last.bold === first.bold && last.italic === first.italic) {
		buffer[buffer.length - 1] = { ...last, text: last.text + first.text };
	} else {
		buffer.push(first);
	}
	buffer.push(...rest);
}

function chunkTextBlock(
	block: TextBlock,
	chapterIndex: number,
	config: ChunkConfig,
	pending: TextBlock[],
): void {
	const sentenceGroups = splitRunsBySentence(block.runs);

	let bufferRuns: StyleRun[] = [];
	let bufferText = "";
	let chunkCount = 0;

	const flushBuffer = () => {
		const norm = normalizeRuns(bufferRuns);
		const trimmed = runsText(norm)
			.replace(/\s+/g, " ")
			.replace(/ (?=['’]\w+)/g, "")
			.trim();
		if (!trimmed) return;
		pending.push({
			type: "text",
			id: `c${chapterIndex}-${block.position}-${chunkCount++}`,
			content: trimmed,
			runs: norm,
			charCount: trimmed.length,
			chapterIndex,
			position: block.position,
		});
		bufferRuns = [];
		bufferText = "";
	};

	for (const group of sentenceGroups) {
		const groupText = runsText(group);

		if (groupText.length > config.maxChars) {
			for (const part of hardSplitRuns(group, config.maxChars)) {
				const partText = runsText(part);
				if (
					bufferText.length + partText.length + (bufferText ? 1 : 0) >
						config.maxChars &&
					bufferRuns.length > 0
				) {
					flushBuffer();
				}
				appendRuns(bufferRuns, part);
				bufferText += (bufferText ? " " : "") + partText;
			}
			continue;
		}

		const wouldExceed =
			bufferText.length + groupText.length + (bufferText ? 1 : 0) >
			config.maxChars;

		if (wouldExceed && bufferRuns.length > 0) {
			flushBuffer();
		}

		appendRuns(bufferRuns, group);
		bufferText += (bufferText ? " " : "") + groupText;
	}

	if (bufferText.length >= config.minChars) {
		flushBuffer();
		return;
	}

	if (pending.length > 0 && bufferRuns.length > 0) {
		const last = pending[pending.length - 1];
		const merged = `${last.content} ${bufferText}`.replace(/\s+/g, " ").trim();
		if (merged.length <= config.maxChars) {
			last.content = merged;
			last.charCount = merged.length;
			const lastRun = last.runs[last.runs.length - 1];
			const firstBuf = bufferRuns[0];
			if (
				lastRun.bold === firstBuf.bold &&
				lastRun.italic === firstBuf.italic
			) {
				lastRun.text += ` ${firstBuf.text}`;
				last.runs.push(...bufferRuns.slice(1));
			} else {
				last.runs.push(
					{ text: " ", bold: false, italic: false },
					...bufferRuns,
				);
			}
			return;
		}
		flushBuffer();
		return;
	}

	if (bufferRuns.length > 0) flushBuffer();
}

function* boundedItems(
	items: ListItem[],
	maxChars: number,
): Generator<ListItem> {
	for (const item of items) {
		if (item.content.length <= maxChars) {
			yield item;
			continue;
		}
		for (const runs of hardSplitRuns(item.runs, maxChars)) {
			yield { content: runsText(runs), runs, depth: item.depth };
		}
	}
}

function splitList(block: ListBlock, config: ChunkConfig): ListBlock[] {
	const pages: ListItem[][] = [];
	let current: ListItem[] = [];
	let size = 0;

	for (const item of boundedItems(block.items, config.maxChars)) {
		if (current.length > 0 && size + item.content.length > config.maxChars) {
			pages.push(current);
			current = [];
			size = 0;
		}
		current.push(item);
		size += item.content.length;
	}
	if (current.length > 0) pages.push(current);

	return pages.map((items, i) => ({
		...block,
		id: `${block.id}-${i}`,
		items,
		charCount: listCharCount(items),
	}));
}

export function chunkBlocks(
	blocks: Block[],
	chapterIndex: number,
	config: ChunkConfig,
): Block[] {
	const result: Block[] = [];
	let pending: TextBlock[] = [];

	const flushPending = () => {
		result.push(...pending);
		pending = [];
	};

	for (const block of blocks) {
		switch (block.type) {
			case "text":
				chunkTextBlock(block, chapterIndex, config, pending);
				break;
			case "list":
				flushPending();
				result.push(...splitList(block, config));
				break;
			case "heading":
			case "image":
				flushPending();
				result.push(block);
				break;
		}
	}

	flushPending();
	return result;
}

export function chunkBook(book: ParsedBook, config: ChunkConfig): Block[] {
	const result: Block[] = [];

	for (const chapter of book.chapters) {
		const opensWithHeading = chapter.blocks[0]?.type === "heading";

		if (config.includeChapterHeaders && chapter.title && !opensWithHeading) {
			result.push({
				type: "heading",
				id: `ch-${chapter.index}`,
				level: 1,
				content: chapter.title,
				runs: [{ text: chapter.title, bold: false, italic: false }],
				charCount: chapter.title.length,
				chapterIndex: chapter.index,
				position: BEFORE_FIRST_BLOCK,
			});
		}

		result.push(...chunkBlocks(chapter.blocks, chapter.index, config));
	}

	return result;
}
