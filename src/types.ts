/** A styled segment of text within a block. */
export interface StyleRun {
  text: string;
  bold: boolean;
  italic: boolean;
}

export interface TextBlock {
  type: "text";
  id: string;
  content: string;
  /** Per-character formatting via run-length encoding. */
  runs: StyleRun[];
  charCount: number;
  chapterIndex: number;
  position: number; // ordinal within chapter
}

export interface ImageBlock {
  type: "image";
  id: string;
  src: string;
  alt: string;
  data: Uint8Array | null; // raw bytes for CLI display / CDN upload
  chapterIndex: number;
  position: number;
}

export type Block = TextBlock | ImageBlock;

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
  maxChars: 300,
  includeChapterHeaders: true,
};
