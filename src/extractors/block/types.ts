import type {
	HeadingLevel,
	ListItem,
	StyleMapping,
	StyleRun,
} from "../../types.ts";

/**
 * Raw blocks extracted from XHTML — before chapter assignment,
 * id generation and image binary resolution.
 */
export interface RawTextBlock {
	type: "text";
	content: string;
	runs: StyleRun[];
}

export interface RawHeadingBlock {
	type: "heading";
	level: HeadingLevel;
	content: string;
	runs: StyleRun[];
}

export interface RawListBlock {
	type: "list";
	ordered: boolean;
	items: ListItem[];
}

export interface RawImageBlock {
	type: "image";
	src: string;
	alt: string;
}

export type RawBlock =
	| RawTextBlock
	| RawHeadingBlock
	| RawListBlock
	| RawImageBlock;

/** Walks an XHTML DOM and returns its blocks in document order. */
export interface BlockExtractor {
	readonly name: string;
	extract(html: string, cssMap?: Map<string, StyleMapping>): RawBlock[];
}
