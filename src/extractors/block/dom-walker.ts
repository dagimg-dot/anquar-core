import { parseHTML } from "linkedom";
import type {
	HeadingLevel,
	ListItem,
	StyleMapping,
	StyleRun,
} from "../../types.ts";
import { parseCssStyles } from "../../utils/css.ts";
import { collapseRuns, normalizeRuns, runsText } from "../../utils/runs.ts";
import type { BlockExtractor, RawBlock } from "./types.ts";

/**
 * Minimal node shape used by the DOM walker.
 * linkedom returns objects that duck-type to this interface —
 * using DOM's built-in types would create incompatibilities.
 */
interface WalkNode {
	nodeType: number;
	tagName?: string;
	textContent?: string | null;
	childNodes?: WalkNode[];
	getAttribute?(name: string): string | null;
}

interface Style {
	bold: boolean;
	italic: boolean;
}

/** A list found while gathering inline content, with the style in force there. */
interface DeferredList extends Style {
	node: WalkNode;
}

interface InlineScan {
	runs: StyleRun[];
	lists: DeferredList[];
}

const NODE_ELEMENT = 1;
const NODE_TEXT = 3;

const BOLD_TAGS = new Set(["b", "strong"]);
const ITALIC_TAGS = new Set(["i", "em"]);
const LIST_TAGS = new Set(["ul", "ol"]);

const HEADING_LEVELS = new Map<string, HeadingLevel>([
	["h1", 1],
	["h2", 2],
	["h3", 3],
	["h4", 4],
	["h5", 5],
	["h6", 6],
]);

const BLOCK_TAGS = new Set([
	"p",
	"div",
	"blockquote",
	"li",
	"section",
	"figure",
	"td",
	"th",
	"pre",
]);

const SKIP_TAGS = new Set([
	"script",
	"style",
	"noscript",
	"title",
	"meta",
	"link",
]);

/**
 * DOM-walking block extractor with bold/italic tracking.
 *
 * Walks the parsed XHTML body tree and emits paragraphs, headings,
 * lists and images in document order. Text is emitted as StyleRun[]
 * with computed bold/italic flags from:
 *   1. Semantic HTML tags (<strong>, <b>, <em>, <i>)
 *   2. Inline style attributes (font-weight, font-style)
 *   3. CSS class names resolved against a pre-parsed map
 *
 * Handles nested/inherited styling — style flags propagate
 * through the DOM tree via the recursive walker.
 */
export class DomWalkerBlockExtractor implements BlockExtractor {
	readonly name = "dom-walker";

	extract(html: string, externalCss?: Map<string, StyleMapping>): RawBlock[] {
		let doc: ReturnType<typeof parseHTML>["document"];
		try {
			doc = parseHTML(html).document;
		} catch {
			return [];
		}
		const body = doc.querySelector("body");
		if (!body) return [];

		// Build CSS class map: merge external (from parser) with inline <style>
		const cssMap = new Map(externalCss);
		for (const st of doc.querySelectorAll("style")) {
			const parsed = parseCssStyles(st.textContent || "");
			for (const [k, v] of parsed) {
				if (!cssMap.has(k)) cssMap.set(k, v); // inline wins over external
			}
		}

		const blocks: RawBlock[] = [];
		const runs: StyleRun[] = [];

		const tagOf = (n: WalkNode): string => (n.tagName || "").toLowerCase();

		const flush = () => {
			if (runs.length === 0) return;
			const norm = normalizeRuns(runs);
			const content = runsText(norm);
			if (content.trim()) {
				blocks.push({ type: "text", content, runs: norm });
			}
			runs.length = 0;
		};

		const isSingleImageWrapper = (n: WalkNode): boolean => {
			const kids = n.childNodes ?? [];
			const nonText = kids.filter(
				(k) => k.nodeType === NODE_ELEMENT && !SKIP_TAGS.has(tagOf(k)),
			);
			return (
				nonText.length === 1 &&
				nonText[0] !== undefined &&
				tagOf(nonText[0]) === "img"
			);
		};

		const computeStyle = (n: WalkNode, inherited: Style): Style => {
			let { bold, italic } = inherited;
			const tag = tagOf(n);

			if (BOLD_TAGS.has(tag)) bold = true;
			if (ITALIC_TAGS.has(tag)) italic = true;

			const styleAttr = n.getAttribute?.("style") || "";
			if (/\bfont-weight\s*:\s*bold\b/i.test(styleAttr)) bold = true;
			if (/\bfont-style\s*:\s*italic\b/i.test(styleAttr)) italic = true;

			const classAttr = n.getAttribute?.("class") || "";
			if (classAttr && cssMap.size > 0) {
				for (const cls of classAttr.split(/\s+/)) {
					const s = cssMap.get(cls);
					if (s) {
						if (s.bold) bold = true;
						if (s.italic) italic = true;
					}
				}
			}

			return { bold, italic };
		};

		/**
		 * Gather the inline content of a subtree without touching the block
		 * stream. Nested lists are set aside rather than flattened into the
		 * text, so the caller can emit them as their own items.
		 */
		const scanInline = (parent: WalkNode, inherited: Style): InlineScan => {
			const collected: StyleRun[] = [];
			const lists: DeferredList[] = [];

			const visit = (n: WalkNode, style: Style) => {
				if (n.nodeType === NODE_TEXT) {
					const text = n.textContent || "";
					if (text) collected.push({ text, ...style });
					return;
				}
				if (n.nodeType !== NODE_ELEMENT) return;

				const tag = tagOf(n);
				if (SKIP_TAGS.has(tag) || tag === "img") return;
				if (LIST_TAGS.has(tag)) {
					lists.push({ node: n, ...computeStyle(n, style) });
					return;
				}
				if (tag === "br") {
					collected.push({ text: " ", ...style });
					return;
				}

				const own = computeStyle(n, style);
				for (const c of n.childNodes ?? []) visit(c, own);
			};

			for (const c of parent.childNodes ?? []) visit(c, inherited);
			return { runs: collapseRuns(collected), lists };
		};

		const gatherItems = (
			list: WalkNode,
			inherited: Style,
			depth: number,
			out: ListItem[],
		): void => {
			for (const child of list.childNodes ?? []) {
				if (child.nodeType !== NODE_ELEMENT) continue;

				const tag = tagOf(child);
				const style = computeStyle(child, inherited);

				// A list nested directly under <ul>/<ol>, with no <li> of its own.
				if (LIST_TAGS.has(tag)) {
					gatherItems(child, style, depth + 1, out);
					continue;
				}
				if (tag !== "li") continue;

				const { runs: itemRuns, lists } = scanInline(child, style);
				const content = runsText(itemRuns);
				if (content) out.push({ content, runs: itemRuns, depth });

				for (const nested of lists) {
					gatherItems(nested.node, nested, depth + 1, out);
				}
			}
		};

		const walk = (n: WalkNode | null, inherited: Style) => {
			if (!n) return;

			if (n.nodeType === NODE_TEXT) {
				const raw = n.textContent || "";
				if (!raw.length) return;
				// Inter-element whitespace (indentation, newlines) → single space
				const t = /^\s+$/.test(raw) ? " " : raw;
				runs.push({ text: t, ...inherited });
				return;
			}

			if (n.nodeType !== NODE_ELEMENT) return;

			const tag = tagOf(n);
			if (SKIP_TAGS.has(tag)) return;

			if (tag === "br") {
				if (runs.length > 0)
					runs.push({ text: " ", bold: false, italic: false });
				return;
			}

			if (tag === "hr") {
				flush();
				return;
			}

			if (tag === "img") {
				flush();
				blocks.push({
					type: "image",
					src: n.getAttribute?.("src") || "",
					alt: n.getAttribute?.("alt") || "",
				});
				return;
			}

			const style = computeStyle(n, inherited);

			const level = HEADING_LEVELS.get(tag);
			if (level !== undefined) {
				flush();
				const { runs: headingRuns } = scanInline(n, style);
				const content = runsText(headingRuns);
				if (content)
					blocks.push({ type: "heading", level, content, runs: headingRuns });
				return;
			}

			if (LIST_TAGS.has(tag)) {
				flush();
				const items: ListItem[] = [];
				gatherItems(n, style, 0, items);
				if (items.length > 0)
					blocks.push({ type: "list", ordered: tag === "ol", items });
				return;
			}

			const isBlock = BLOCK_TAGS.has(tag);
			if (isBlock && runs.length > 0 && !isSingleImageWrapper(n)) {
				flush();
			}

			for (const c of n.childNodes ?? []) {
				walk(c, style);
			}

			if (isBlock) flush();
		};

		walk(body as unknown as WalkNode, { bold: false, italic: false });
		flush();

		return blocks;
	}
}
