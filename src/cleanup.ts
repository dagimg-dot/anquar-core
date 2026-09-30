import { blockText } from "./blocks.ts";
import type { RawBlock } from "./extractors/block/types.ts";
import { imageSize } from "./utils/image-size.ts";

export interface CleanupSection {
	blocks: RawBlock[];
	imageBytes: (src: string) => Uint8Array | null;
}

const MIN_PICTURE_AREA_PX = 10_000;

const ORNAMENT_REPEATS = 3;

const WATERMARK = /^(https?:\/\/)?(www\.)?[\w-]+(\.[\w-]+)+(\/\S*)?$/i;

const SECTION_NUMBER = /^([0-9]{1,3}|[IVXLC]{1,7})\.?$/;

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
		return numbered.filter(
			(block) => block.type !== "text" || blockText(block),
		);
	});
}
