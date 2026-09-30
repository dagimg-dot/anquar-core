import type { RawBlock } from "./extractors/block/types.ts";
import type { Block, ListItem } from "./types.ts";

export type ImageDataResolver = (src: string) => Uint8Array | null;

interface BlockIdentity {
	id: string;
	chapterIndex: number;
	position: number;
}

export function listCharCount(items: ListItem[]): number {
	return items.reduce((sum, item) => sum + item.content.length, 0);
}

export function blockText(block: Block | RawBlock): string {
	switch (block.type) {
		case "text":
		case "heading":
			return block.content;
		case "list":
			return block.items.map((item) => item.content).join(" ");
		case "image":
		case "break":
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
				start: raw.start ?? 1,
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
		case "break":
			return { ...common, type: "break", charCount: 0 };
	}
}

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
