export interface StyleRun {
	text: string;
	bold: boolean;
	italic: boolean;
}

export interface StyleMapping {
	bold: boolean;
	italic: boolean;
}

interface BlockBase {
	id: string;
	chapterIndex: number;
	position: number;
	charCount: number;
}

export type HeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;

export interface TextBlock extends BlockBase {
	type: "text";
	content: string;
	runs: StyleRun[];
}

export interface HeadingBlock extends BlockBase {
	type: "heading";
	level: HeadingLevel;
	content: string;
	runs: StyleRun[];
}

export interface ListItem {
	content: string;
	runs: StyleRun[];
	depth: number;
}

export interface ListBlock extends BlockBase {
	type: "list";
	ordered: boolean;
	items: ListItem[];
}

export interface ImageBlock extends BlockBase {
	type: "image";
	src: string;
	alt: string;
	data: Uint8Array | null;
}

export type Block = TextBlock | HeadingBlock | ListBlock | ImageBlock;

export type ProseBlock = TextBlock | HeadingBlock;

export function isProseBlock(block: Block): block is ProseBlock {
	return block.type === "text" || block.type === "heading";
}

export interface ParsedChapter {
	index: number;
	title: string;
	blocks: Block[];
	frontMatter: boolean;
}

export interface ParsedBook {
	title: string;
	author: string;
	chapters: ParsedChapter[];
	coverImage?: Uint8Array | null;
}

export interface ParsedArticle {
	title: string;
	author: string;
	siteName: string;
	url: string;
	published?: string;
	blocks: Block[];
}

export interface ChunkConfig {
	minChars: number;
	maxChars: number;
	includeChapterHeaders: boolean;
}

export const DEFAULT_CHUNK_CONFIG: ChunkConfig = {
	minChars: 80,
	maxChars: 600,
	includeChapterHeaders: true,
};
