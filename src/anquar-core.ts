// ── Public API ───────────────────────────────────────────────────

// Types
export type {
  ParsedBook,
  ParsedArticle,
  ParsedChapter,
  Block,
  TextBlock,
  ImageBlock,
  StyleRun,
  StyleMapping,
  ChunkConfig,
} from "./types.ts";

export { DEFAULT_CHUNK_CONFIG } from "./types.ts";

// EPUB parser
export { parseEpub, parseEpubFromZip, parseEpubFromFile } from "./parser.ts";

// ZIP reader (Node via AdmZip, browser via JSZip)
export { EpubZip } from "./epub/zip.ts";

// Article parser
export { parseArticle } from "./everything/article.ts";
export type { ArticleOptions } from "./everything/article.ts";

// Chunker
export { chunkBook, chunkBlocks, splitSentences, hardSplit } from "./chunker.ts";

// Config
export type { ParseOptions } from "./config.ts";
