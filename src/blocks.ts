import type { RawBlock } from "./extractors/block/types.ts";
import type { Block, ListItem } from "./types.ts";

/** Resolves an <img src> to its bytes, or null when they cannot be found. */
export type ImageDataResolver = (src: string) => Uint8Array | null;

interface BlockIdentity {
	id: string;
	chapterIndex: number;
	position: number;
}

export function listCharCount(items: ListItem[]): number {
	return items.reduce((sum, item) => sum + item.content.length, 0);
}

/** Reader-visible text of a block; "" for images. */
export function blockText(block: Block): string {
	switch (block.type) {
		case "text":
		case "heading":
			return block.content;
		case "list":
			return block.items.map((item) => item.content).join(" ");
		case "image":
			return "";
	}
}

function toBlock(
	raw: RawBlock,
	common: BlockIdentity,
	resolveImageData: ImageDataResolver,
): Block {
	switch (raw.type) {
		case "text":
			return {
				...common,
				type: "text",
				content: raw.content,
				runs: raw.runs,
				charCount: raw.content.length,
			};
		case "heading":
			return {
				...common,
				type: "heading",
				level: raw.level,
				content: raw.content,
				runs: raw.runs,
				charCount: raw.content.length,
			};
		case "list":
			return {
				...common,
				type: "list",
				ordered: raw.ordered,
				items: raw.items,
				charCount: listCharCount(raw.items),
			};
		case "image":
			return {
				...common,
				type: "image",
				src: raw.src,
				alt: raw.alt,
				data: resolveImageData(raw.src),
				charCount: 0,
			};
	}
}

/**
 * Turn extractor output into addressable blocks by attaching ids, chapter
 * position and — for images — the resolved bytes.
 *
 * @param idPrefix — prepended to each block's ordinal to form its id
 */
export function materializeBlocks(
	raw: RawBlock[],
	chapterIndex: number,
	idPrefix: string,
	resolveImageData: ImageDataResolver,
): Block[] {
	return raw.map((block, position) =>
		toBlock(
			block,
			{ id: `${idPrefix}${position}`, chapterIndex, position },
			resolveImageData,
		),
	);
}
