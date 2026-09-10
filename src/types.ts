/** A styled segment of text within a block. */
export interface StyleRun {
	text: string;
	bold: boolean;
	italic: boolean;
}

/** Class → style mapping extracted from CSS. */
export interface StyleMapping {
	bold: boolean;
	italic: boolean;
}

/** Fields carried by every block, whatever its type. */
interface BlockBase {
	id: string;
	chapterIndex: number;
	/** Ordinal within the chapter. Synthetic blocks use -1. */
	position: number;
	/** Characters of reader-visible text — the chunker's budget unit. */
	charCount: number;
}

export type HeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;

export interface TextBlock extends BlockBase {
	type: "text";
	content: string;
	/** Per-character formatting via run-length encoding. */
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
	/** Nesting level; 0 is the outermost list. */
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
	/** Raw bytes for CLI display / CDN upload. */
	data: Uint8Array | null;
}

export type Block = TextBlock | HeadingBlock | ListBlock | ImageBlock;

/** Blocks holding a single styled string, as opposed to items or bytes. */
export type ProseBlock = TextBlock | HeadingBlock;

export function isProseBlock(block: Block): block is ProseBlock {
	return block.type === "text" || block.type === "heading";
}

export interface ParsedChapter {
	index: number;
	title: string;
	blocks: Block[];
	/** True if this chapter is likely front matter (cover, title, copyright, TOC, etc.) */
	frontMatter: boolean;
}

export interface ParsedBook {
	title: string;
	author: string;
	chapters: ParsedChapter[];
	/** Cover image bytes, if found. */
	coverImage?: Uint8Array | null;
}

/** A parsed article or blog post — flat blocks, no chapters. */
export interface ParsedArticle {
	title: string;
	author: string;
	siteName: string;
	url: string;
	published?: string;
	blocks: Block[];
}

export interface ChunkConfig {
	/** Minimum characters per text chunk (merge short sentences up to this) */
	minChars: number;
	/** Maximum characters per text chunk (split long sentences at this) */
	maxChars: number;
	/** Whether to include chapter headers as their own blocks */
	includeChapterHeaders: boolean;
}

export const DEFAULT_CHUNK_CONFIG: ChunkConfig = {
	minChars: 80,
	maxChars: 600,
	includeChapterHeaders: true,
};
