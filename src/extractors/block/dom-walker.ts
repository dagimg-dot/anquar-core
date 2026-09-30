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

interface DeferredList extends Style {
	node: WalkNode;
}

interface InlineScan {
	runs: StyleRun[];
	lists: DeferredList[];
}

const NODE_ELEMENT = 1;
const NODE_TEXT = 3;

const PRIVATE_USE = /\p{Co}/gu;

const INVISIBLE = /[\u00AD\u200B-\u200D\uFEFF]/g;

function readable(raw: string | null | undefined): string {
	return (raw ?? "").replace(PRIVATE_USE, "").replace(INVISIBLE, "");
}

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

const TITLE_HOST_TAGS = new Set(["p", "div", "section"]);

const TITLE_MAX_CHARS = 70;

function readsAsTitle(runs: StyleRun[], text: string): boolean {
	if (text.length < 2 || text.length > TITLE_MAX_CHARS) return false;
	if (/[.!?;:,]$/.test(text)) return false;
	if (!/[\p{L}\p{N}]/u.test(text)) return false;
	if (!/^[\p{Lu}\p{N}"'“‘([]/u.test(text)) return false;
	return runs.every((r) => r.bold || !r.text.trim());
}

const SKIP_TAGS = new Set([
	"script",
	"style",
	"noscript",
	"title",
	"meta",
	"link",
]);

function promoteTitles(blocks: RawBlock[], candidates: Set<number>): void {
	for (const i of candidates) {
		const next = blocks[i + 1];
		if (next?.type !== "text" || candidates.has(i + 1)) continue;
		if (!/^[\p{Lu}\p{N}"'“‘]/u.test(next.content.trim())) continue;

		const block = blocks[i];
		if (block.type !== "text") continue;
		const runs = collapseRuns(block.runs);
		blocks[i] = { type: "heading", level: 2, content: runsText(runs), runs };
	}
}

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

		const cssMap = new Map(externalCss);
		for (const st of doc.querySelectorAll("style")) {
			const parsed = parseCssStyles(st.textContent || "");
			for (const [k, v] of parsed) {
				if (!cssMap.has(k)) cssMap.set(k, v);
			}
		}

		const blocks: RawBlock[] = [];
		const runs: StyleRun[] = [];

		const tagOf = (n: WalkNode): string => (n.tagName || "").toLowerCase();

		let pendingTag = "";
		const titleCandidates = new Set<number>();

		const flush = () => {
			if (runs.length === 0) return;
			const norm = normalizeRuns(runs);
			const content = runsText(norm);
			if (content.trim()) {
				const collapsed = collapseRuns(norm);
				if (
					TITLE_HOST_TAGS.has(pendingTag) &&
					readsAsTitle(collapsed, runsText(collapsed))
				) {
					titleCandidates.add(blocks.length);
				}
				blocks.push({ type: "text", content, runs: norm });
			}
			runs.length = 0;
			pendingTag = "";
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

		const scanInline = (parent: WalkNode, inherited: Style): InlineScan => {
			const collected: StyleRun[] = [];
			const lists: DeferredList[] = [];

			const visit = (n: WalkNode, style: Style) => {
				if (n.nodeType === NODE_TEXT) {
					const text = readable(n.textContent);
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
				const raw = readable(n.textContent);
				if (!raw.length) return;
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
			if (isBlock) pendingTag = tag;

			for (const c of n.childNodes ?? []) {
				walk(c, style);
			}

			if (isBlock) flush();
		};

		walk(body as unknown as WalkNode, { bold: false, italic: false });
		flush();
		promoteTitles(blocks, titleCandidates);

		return blocks;
	}
}
