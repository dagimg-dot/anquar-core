// ── Public API ───────────────────────────────────────────────────

// Chunker
export {
	chunkBlocks,
	chunkBook,
	hardSplit,
	splitSentences,
} from "./chunker.ts";
// Config
export type { ParseOptions } from "./config.ts";
// ZIP reader (Node via AdmZip, browser via JSZip)
export { EpubZip } from "./epub/zip.ts";
export type { ArticleOptions } from "./everything/article.ts";

// Article parser
export { parseArticle } from "./everything/article.ts";
// parseEpub (path-based) lives in ./node.ts — it is Node-only.
export { parseEpubFromFile, parseEpubFromZip } from "./parser.ts";
// Types
export type {
	Block,
	ChunkConfig,
	ImageBlock,
	ParsedArticle,
	ParsedBook,
	ParsedChapter,
	StyleMapping,
	StyleRun,
	TextBlock,
} from "./types.ts";
export { DEFAULT_CHUNK_CONFIG } from "./types.ts";
