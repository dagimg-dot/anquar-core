import type {
	HeadingLevel,
	ListItem,
	StyleMapping,
	StyleRun,
} from "../../types.ts";

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

export interface BlockExtractor {
	readonly name: string;
	extract(html: string, cssMap?: Map<string, StyleMapping>): RawBlock[];
}
