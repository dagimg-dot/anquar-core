import { listCharCount } from "./blocks.ts";
import { sentenceStarts } from "./sentences.ts";
import type {
	Block,
	Card,
	CardLayout,
	HeadingLevel,
	ListBlock,
	ListItem,
	TextBlock,
} from "./types.ts";
import { sliceRuns } from "./utils/runs.ts";

export const HEADING_SCALE: Record<HeadingLevel, number> = {
	1: 1.6,
	2: 1.4,
	3: 1.25,
	4: 1.15,
	5: 1.05,
	6: 1,
};

export const BLOCK_GAP_LINES = 0.5;

export const ITEM_GAP_LINES = 0.3;

export const PHONE_LAYOUT: CardLayout = { charsPerLine: 40, linesPerCard: 22 };

const BREAK_LINES = 1;

// Measured in the browser: at 0.9, about one paragraph in 3,500 wraps to a
// line more than estimated. Raising it overfills cards.
const LINE_HEADROOM = 0.9;

const CAPITAL_WIDTH_RATIO = 1.35;

const BULLET_CHARS = 4;

const INDENT_CHARS = 3;

const FULL_ENOUGH = 0.65;

const MIN_LINES_BEFORE_SPLIT = 2;

const KEEP_WITH_NEXT_LINES = 3;

const WIDOW_FILL = 0.25;

const IMAGE_LEAD_IN_FILL = 0.3;

const CAPTION =
	/^(fig(ure)?|table|chart|plate|map|photo(graph)?|illustration|image|diagram|exhibit|source)\b/i;

export interface PageableChapter {
	index: number;
	blocks: readonly Block[];
}

interface PieceOrigin {
	source: TextBlock;
	start: number;
	end: number;
}

function splitOffsets(text: string): number[] {
	const at = new Set(sentenceStarts(text));
	for (let i = text.indexOf("\n"); i >= 0; i = text.indexOf("\n", i + 1)) {
		at.add(i + 1);
	}
	return [...at].sort((a, b) => a - b);
}

const LETTER = 1;
const CAPITAL = 2;
const KNOWN = 4;
const plane = new Uint8Array(0x10000);
const astral = new Map<number, number>();

// \p{L} and \p{Lu} without running a regex per line: paging a long book asks this of every character many
// times over.
function kindOf(point: number): number {
	if (point < 128) {
		if (point >= 65 && point <= 90) return LETTER | CAPITAL;
		return point >= 97 && point <= 122 ? LETTER : 0;
	}
	const known = point < 0x10000 ? plane[point] : astral.get(point);
	if (known) return known;
	const char = String.fromCodePoint(point);
	const kind = /\p{Lu}/u.test(char)
		? LETTER | CAPITAL
		: /\p{L}/u.test(char)
			? LETTER
			: 0;
	if (point < 0x10000) plane[point] = kind | KNOWN;
	else astral.set(point, kind | KNOWN);
	return kind;
}

function lineModel(layout: CardLayout) {
	const capacity = Math.max(6, layout.linesPerCard);
	const perLine = Math.max(10, layout.charsPerLine * LINE_HEADROOM);

	const textLines = (text: string, width = perLine): number => {
		let lines = 0;
		let start = 0;
		let letters = 0;
		let capitals = 0;
		for (let i = 0; i <= text.length; i++) {
			const code = i < text.length ? text.charCodeAt(i) : 10;
			if (code === 10) {
				const share = letters > 0 ? capitals / letters : 0;
				const span = (i - start) * (1 + (CAPITAL_WIDTH_RATIO - 1) * share);
				lines += Math.max(1, Math.ceil(span / width));
				start = i + 1;
				letters = 0;
				capitals = 0;
				continue;
			}
			let point = code;
			if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length) {
				const low = text.charCodeAt(i + 1);
				if (low >= 0xdc00 && low <= 0xdfff) {
					point = (code - 0xd800) * 0x400 + (low - 0xdc00) + 0x10000;
					i++;
				}
			}
			const kind = kindOf(point);
			if (kind & LETTER) letters++;
			if (kind & CAPITAL) capitals++;
		}
		return lines;
	};
	const itemWidth = (item: ListItem) =>
		Math.max(8, perLine - BULLET_CHARS - item.depth * INDENT_CHARS);
	const listLines = (items: readonly ListItem[]) =>
		items.reduce((n, item) => n + textLines(item.content, itemWidth(item)), 0) +
		ITEM_GAP_LINES * Math.max(0, items.length - 1);

	const measure = (block: Block): number => {
		switch (block.type) {
			case "text":
				return textLines(block.content);
			case "heading": {
				const scale = HEADING_SCALE[block.level];
				return textLines(block.content, perLine / scale) * scale;
			}
			case "list":
				return listLines(block.items);
			case "image":
				return capacity;
			case "break":
				return BREAK_LINES;
		}
	};
	// Blocks are never changed once made, and paging weighs most of them more than once.
	const costs = new WeakMap<Block, number>();
	const cost = (block: Block): number => {
		let lines = costs.get(block);
		if (lines === undefined) {
			lines = measure(block);
			costs.set(block, lines);
		}
		return lines;
	};
	const stackCost = (blocks: readonly Block[]) =>
		blocks.reduce((n, b, i) => n + cost(b) + (i > 0 ? BLOCK_GAP_LINES : 0), 0);

	return {
		capacity,
		perLine,
		textLines,
		itemWidth,
		listLines,
		cost,
		stackCost,
	};
}

export function cardLines(
	blocks: readonly Block[],
	layout: CardLayout,
): number {
	const { stackCost } = lineModel(layout);
	return stackCost(blocks.filter((b) => b.type !== "image"));
}

/**
 * Whether paging this chapter leaves something for the next: a closing heading, such as a part title, opens
 * the next chapter's first card. A book paged in runs that start after chapters that don't carry is paged
 * exactly as it would be whole.
 */
export function carriesIntoNext(chapter: PageableChapter): boolean {
	const laid = chapter.blocks.filter((b) => b.type !== "break");
	return laid.length === 0 || laid[laid.length - 1].type === "heading";
}

/**
 * Lay blocks out as cards that each fill one screen: whole paragraphs where
 * they fit, a paragraph split at a sentence only where a card would otherwise
 * be left mostly empty, headings on the card with what they open. A chapter
 * always starts a card, and one holding nothing but headings — a part title —
 * heads the next chapter's first card.
 */
export function paginate(
	chapters: readonly PageableChapter[],
	layout: CardLayout,
): Card[] {
	const {
		capacity,
		perLine,
		textLines,
		itemWidth,
		listLines,
		cost,
		stackCost,
	} = lineModel(layout);

	const isCaption = (block: TextBlock) => {
		const lines = textLines(block.content);
		if (lines > 4) return false;
		if (CAPTION.test(block.content)) return true;
		return (
			lines <= 2 && !/[.!?:]$/.test(block.content.replace(/["”’)\]]+$/, ""))
		);
	};

	const origins = new Map<string, PieceOrigin>();
	const originOf = (block: TextBlock): PieceOrigin =>
		origins.get(block.id) ?? {
			source: block,
			start: 0,
			end: block.content.length,
		};
	const piece = (source: TextBlock, start: number, end: number): TextBlock => {
		const text = source.content;
		let s = start;
		let e = end;
		while (s < e && /\s/.test(text[s])) s++;
		while (e > s && /\s/.test(text[e - 1])) e--;
		const id = s === 0 ? source.id : `${source.id}@${s}`;
		origins.set(id, { source, start: s, end: e });
		const content = text.slice(s, e);
		return {
			...source,
			id,
			content,
			runs: sliceRuns(source.runs, s, e),
			charCount: content.length,
		};
	};
	const sameParagraph = (a: Block, b: Block) =>
		a.type === "text" &&
		b.type === "text" &&
		originOf(a).source === originOf(b).source &&
		originOf(a).end <= originOf(b).start;

	const cutPoint = (
		text: string,
		room: number,
		width: number,
		force: boolean,
	): number => {
		const fits = (end: number) =>
			textLines(text.slice(0, end).trimEnd(), width) <= room;

		let best = -1;
		for (const at of splitOffsets(text)) {
			if (!fits(at)) break;
			best = at;
		}
		if (best > 0) {
			const lines = textLines(text.slice(0, best).trimEnd(), width);
			if (force || lines >= MIN_LINES_BEFORE_SPLIT) return best;
		}
		if (!force) return -1;

		const spaces = [...text.matchAll(/\s+/g)].map((m) => m.index ?? 0);
		let lo = 0;
		let hi = spaces.length - 1;
		let word = -1;
		while (lo <= hi) {
			const mid = (lo + hi) >> 1;
			if (spaces[mid] > 0 && fits(spaces[mid])) {
				word = spaces[mid];
				lo = mid + 1;
			} else {
				hi = mid - 1;
			}
		}
		return word > 0 ? word : Math.max(1, Math.floor(room * width));
	};

	const split = (
		block: TextBlock | ListBlock,
		room: number,
		force: boolean,
	): [Block | null, Block[]] => {
		if (block.type === "text") {
			const cut = cutPoint(block.content, room, perLine, force);
			if (cut < 0) return [null, [block]];
			const { source, start, end } = originOf(block);
			return [
				piece(source, start, start + cut),
				[piece(source, start + cut, end)],
			];
		}

		let fit = 0;
		while (
			fit < block.items.length &&
			listLines(block.items.slice(0, fit + 1)) <= room
		) {
			fit++;
		}
		const listId = block.id.split("#")[0];
		const rest = (items: ListItem[], start: number): ListBlock[] =>
			items.length > 0
				? [
						{
							...block,
							id: `${listId}#${start}`,
							start,
							items,
							charCount: listCharCount(items),
						},
					]
				: [];

		if (fit > 0) {
			const items = block.items.slice(0, fit);
			return [
				{ ...block, items, charCount: listCharCount(items) },
				rest(block.items.slice(fit), block.start + fit),
			];
		}
		if (!force) return [null, [block]];

		const [item, ...others] = block.items;
		const itemAsText: TextBlock = {
			id: block.id,
			chapterIndex: block.chapterIndex,
			position: block.position,
			type: "text",
			content: item.content,
			runs: item.runs,
			charCount: item.content.length,
		};
		const cut = cutPoint(item.content, room, itemWidth(item), true);
		const head = piece(itemAsText, 0, cut);
		const overflow = piece(itemAsText, cut, item.content.length);
		return [
			{
				...block,
				items: [{ ...item, content: head.content, runs: head.runs }],
				charCount: head.content.length,
			},
			[
				...(overflow.content ? [overflow] : []),
				...rest(others, block.start + 1),
			],
		];
	};

	const cards: Card[] = [];
	let card: Block[] = [];
	let used = 0;

	const gap = () => (card.length > 0 ? BLOCK_GAP_LINES : 0);
	const room = () => capacity - used - gap();
	const place = (block: Block, lines = cost(block)) => {
		used += gap() + lines;
		card.push(block);
	};
	const opensWhatFollows = (b: Block) =>
		b.type === "heading" || b.type === "break";

	const close = () => {
		const carried: Block[] = [];
		while (card.length > 1) {
			const last = card[card.length - 1];
			if (!opensWhatFollows(last)) break;
			if (card.slice(0, -1).every(opensWhatFollows)) break;
			carried.unshift(last);
			card.pop();
		}
		if (card.length > 0) {
			cards.push({
				id: card[0].id,
				chapterIndex: card[0].chapterIndex,
				blocks: card,
			});
		}
		card = [];
		used = 0;
		for (const block of carried) place(block);
	};
	const onlyHeadings = () => card.every((b) => b.type === "heading");
	const withNext = (lines: number, next: Block | undefined) =>
		lines +
		(next ? BLOCK_GAP_LINES + Math.min(cost(next), KEEP_WITH_NEXT_LINES) : 0);

	const settleWidow = (firstCardOfChapter: number) => {
		const prev = cards[cards.length - 1];
		const target = capacity * WIDOW_FILL;
		if (!prev || cards.length - 1 < firstCardOfChapter) return;
		if (card.length === 0 || used >= target) return;
		if (!card.every((b) => b.type === "text" || b.type === "list")) return;
		const prevIsCaptionedPicture = prev.blocks.some((b) => b.type === "image");
		if (prevIsCaptionedPicture) return;

		while (used < target && prev.blocks.length > 1) {
			const last = prev.blocks[prev.blocks.length - 1];
			if (last.type !== "text" && last.type !== "list") return;
			if (sameParagraph(last, card[0])) break;
			const kept = prev.blocks.slice(0, -1);
			const foot = kept[kept.length - 1];
			if (opensWhatFollows(foot)) break;
			if (kept.every((b) => b.type === "heading")) break;
			const lines = cost(last);
			if (used + BLOCK_GAP_LINES + lines > capacity) break;
			prev.blocks = kept;
			card.unshift(last);
			used += BLOCK_GAP_LINES + lines;
		}
		if (used >= target) return;

		const last = prev.blocks[prev.blocks.length - 1];
		if (last.type !== "text") return;
		const joined = sameParagraph(last, card[0]);
		const { source, start } = originOf(last);
		const end = joined
			? originOf(card[0] as TextBlock).end
			: originOf(last).end;
		const rest = card.slice(joined ? 1 : 0);
		const restLines = rest.length > 0 ? BLOCK_GAP_LINES + stackCost(rest) : 0;
		const text = source.content;

		const cuts = splitOffsets(text).filter((b) => b > start && b < end);
		for (let k = cuts.length - 1; k >= 0; k--) {
			const at = cuts[k];
			if (textLines(text.slice(start, at).trim()) < MIN_LINES_BEFORE_SPLIT)
				return;
			const moved = textLines(text.slice(at, end).trim()) + restLines;
			if (moved > capacity) return;
			if (moved < target) continue;
			prev.blocks[prev.blocks.length - 1] = piece(source, start, at);
			card = [piece(source, at, end), ...rest];
			used = moved;
			return;
		}
	};

	for (const chapter of chapters) {
		if (!onlyHeadings()) close();

		const firstCardOfChapter = cards.length;
		const queue = [...chapter.blocks];
		let chapterLevel: HeadingLevel | null = null;
		let placedContent = false;

		for (let i = 0; i < queue.length; i++) {
			const block = queue[i];
			const next = queue[i + 1] as Block | undefined;

			switch (block.type) {
				case "heading": {
					const stacked = card[card.length - 1]?.type === "heading";
					const opensSection =
						!stacked && chapterLevel !== null && block.level <= chapterLevel;
					chapterLevel ??= block.level;
					const lines = cost(block);
					if (!onlyHeadings() && !stacked) {
						let run = lines;
						let after = i + 1;
						for (; queue[after]?.type === "heading"; after++) {
							run += BLOCK_GAP_LINES + cost(queue[after]);
						}
						const titlesPicture = queue[after]?.type === "image";
						if (opensSection) {
							settleWidow(firstCardOfChapter);
							close();
						} else if (titlesPicture || withNext(run, queue[after]) > room()) {
							close();
						}
					} else if (card.length > 0 && lines > room()) {
						close();
					}
					place(block, Math.min(lines, capacity));
					break;
				}

				case "image": {
					if (!onlyHeadings() && used > capacity * IMAGE_LEAD_IN_FILL) {
						const intro = card[card.length - 1];
						const introducesPicture =
							intro?.type === "text" &&
							/:$/.test(intro.content) &&
							card.length > 1 &&
							card[card.length - 2].type !== "heading";
						if (introducesPicture) {
							card.pop();
							used = stackCost(card);
						}
						close();
						if (introducesPicture) place(intro);
					}
					place(block, Math.max(0, room()));
					if (next?.type === "text" && isCaption(next)) {
						place(next);
						i++;
					}
					close();
					placedContent = true;
					break;
				}

				case "break": {
					const prior = card[card.length - 1];
					if (!placedContent || !next || next.type === "heading") break;
					if (prior?.type === "heading") break;
					if (card.length > 0 && withNext(BREAK_LINES, next) > room()) close();
					place(block);
					break;
				}

				case "text":
				case "list": {
					const lines = cost(block);
					if (lines <= room()) {
						const leadsIn =
							block.type === "text" &&
							/:$/.test(block.content) &&
							next !== undefined &&
							next.type !== "heading" &&
							next.type !== "image";
						if (leadsIn && !onlyHeadings() && withNext(lines, next) > room()) {
							close();
						}
						place(block, lines);
						placedContent = true;
						break;
					}

					const fresh = card.every(opensWhatFollows);
					const fullEnough = used >= capacity * FULL_ENOUGH;
					const cramped = room() < MIN_LINES_BEFORE_SPLIT;
					if ((!fresh && fullEnough) || (card.length > 0 && cramped)) {
						close();
						i--;
						break;
					}

					const [head, rest] = split(block, room(), fresh);
					if (!head) {
						close();
						i--;
						break;
					}
					place(head);
					placedContent = true;
					close();
					queue.splice(i + 1, 0, ...rest);
					break;
				}
			}
		}

		settleWidow(firstCardOfChapter);
	}

	close();
	return cards;
}
