import { parseHTML } from "linkedom";
import type {
	HeadingLevel,
	ListItem,
	StyleMapping,
	StyleRun,
} from "../../types.ts";
import { parseCssStyles } from "../../utils/css.ts";
import { collapseRuns, LINE_BREAK, runsText } from "../../utils/runs.ts";
import { INVISIBLE } from "../../utils/text.ts";
import type { BlockExtractor, RawBlock, RawTextBlock } from "./types.ts";

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
	imageAlts: string[];
}

const NODE_ELEMENT = 1;
const NODE_TEXT = 3;

const PRIVATE_USE = /\p{Co}/gu;

const LAYOUT_WHITESPACE = /[\n\r\t\f\v]/g;

function readable(raw: string | null | undefined): string {
	return (raw ?? "")
		.replace(PRIVATE_USE, "")
		.replace(INVISIBLE, "")
		.replace(LAYOUT_WHITESPACE, " ");
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
	"article",
	"aside",
	"header",
	"footer",
	"main",
	"figure",
	"figcaption",
	"caption",
	"tr",
	"dt",
	"dd",
	"pre",
	"address",
	"center",
]);

const CELL_SEPARATOR = " · ";

const ROW_BREAKERS = ["img", "ul", "ol", "table", "hr"];

const TITLE_HOST_TAGS = new Set(["p", "div", "section"]);

const TITLE_MAX_CHARS = 70;

const SCENE_BREAK_ORNAMENT = /^[\s*•·⁂◆◇❖✦✧★☆~#§=_–—-]{1,24}$/u;

const NOTE_TYPES =
	/\b(noteref|footnote|endnote|rearnote|doc-noteref|doc-footnote|doc-endnote)\b/;

const NOTE_MARKER = /^\[?(fn)?\d{1,3}\]?$|^[*†‡§¶]{1,3}$/;

const NOTE_CLASS = /note/i;

const NOTE_LABEL = /^\[?\d{1,3}\]?\.?$/;

const LABEL_TAGS = new Set(["a", "sup", "span"]);

const SKIP_TAGS = new Set([
	"script",
	"style",
	"noscript",
	"title",
	"meta",
	"link",
	"head",
]);

function readsAsTitle(runs: StyleRun[], text: string): boolean {
	if (text.length < 2 || text.length > TITLE_MAX_CHARS) return false;
	const endsLikeSentence = /[.!?;:,…]$/.test(text.replace(/["'”’»)\]]+$/u, ""));
	if (endsLikeSentence) return false;
	if (!/[\p{L}\p{N}]/u.test(text)) return false;
	const opensLikeTitle = /^[\p{Lu}\p{N}"'“‘([]/u.test(text);
	if (!opensLikeTitle) return false;
	return runs.every((r) => r.bold || !r.text.trim());
}

function promoteTitles(blocks: RawBlock[], candidates: Set<number>): void {
	for (const i of candidates) {
		const next = blocks[i + 1];
		if (next?.type !== "text" || candidates.has(i + 1)) continue;
		if (!/^[\p{Lu}\p{N}"'“‘]/u.test(next.content)) continue;

		const block = blocks[i];
		if (block.type !== "text") continue;
		blocks[i] = {
			type: "heading",
			level: 2,
			content: block.content,
			runs: block.runs,
		};
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
		let cellAwaitingSeparator = false;
		let cellHasText = false;
		let rowDepth = 0;
		let openingBacklink: string | undefined;
		const titleCandidates = new Set<number>();

		const pushBreak = () => {
			const last = blocks[blocks.length - 1];
			if (last && last.type !== "break") blocks.push({ type: "break" });
		};

		const flush = () => {
			const backlink = openingBacklink;
			openingBacklink = undefined;
			if (runs.length === 0) return;
			const collapsed = collapseRuns(runs);
			const content = runsText(collapsed);
			if (SCENE_BREAK_ORNAMENT.test(content)) {
				pushBreak();
			} else if (content) {
				if (
					TITLE_HOST_TAGS.has(pendingTag) &&
					readsAsTitle(collapsed, content)
				) {
					titleCandidates.add(blocks.length);
				}
				const block: RawTextBlock = { type: "text", content, runs: collapsed };
				if (backlink) block.backlink = backlink;
				blocks.push(block);
			}
			runs.length = 0;
			pendingTag = "";
			cellAwaitingSeparator = false;
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

		const linkIn = (n: WalkNode): string | null | undefined => {
			for (const c of n.childNodes ?? []) {
				if (c.nodeType !== NODE_ELEMENT) continue;
				if (tagOf(c) === "a") return c.getAttribute?.("href");
				const nested = linkIn(c);
				if (nested) return nested;
			}
			return null;
		};

		const contains = (n: WalkNode, wanted: string): boolean =>
			(n.childNodes ?? []).some(
				(c) =>
					c.nodeType === NODE_ELEMENT &&
					(tagOf(c) === wanted || contains(c, wanted)),
			);

		const labelLink = (n: WalkNode, tag: string): string | undefined => {
			if (!LABEL_TAGS.has(tag)) return undefined;
			const href = (tag === "a" ? n.getAttribute?.("href") : linkIn(n)) ?? "";
			const [file, fragment] = href.split("#");
			const numbered = NOTE_LABEL.test(readable(n.textContent).trim());
			return file && fragment !== undefined && numbered ? href : undefined;
		};

		const paragraphsIn = (n: WalkNode): number => {
			let count = 0;
			let ownText = false;
			for (const c of n.childNodes ?? []) {
				if (c.nodeType === NODE_TEXT) {
					if (readable(c.textContent).trim()) ownText = true;
					continue;
				}
				if (c.nodeType !== NODE_ELEMENT) continue;
				const tag = tagOf(c);
				if (SKIP_TAGS.has(tag)) continue;
				if (BLOCK_TAGS.has(tag) || HEADING_LEVELS.has(tag)) {
					count += paragraphsIn(c);
				} else if (readable(c.textContent).trim()) {
					ownText = true;
				}
			}
			return count + (ownText ? 1 : 0);
		};

		const readsAsOneLine = (row: WalkNode): boolean => {
			const cells = (row.childNodes ?? []).filter(
				(c) =>
					c.nodeType === NODE_ELEMENT &&
					(tagOf(c) === "td" || tagOf(c) === "th"),
			);
			return (
				cells.length > 1 &&
				!ROW_BREAKERS.some((tag) => contains(row, tag)) &&
				cells.every((cell) => paragraphsIn(cell) <= 1)
			);
		};

		const isNote = (n: WalkNode, tag: string, before: string): boolean => {
			const kind = `${n.getAttribute?.("epub:type") ?? ""} ${n.getAttribute?.("role") ?? ""}`;
			if (NOTE_TYPES.test(kind)) return true;
			if (tag !== "sup" && tag !== "a") return false;
			const marker = readable(n.textContent).trim();
			if (!NOTE_MARKER.test(marker)) return false;
			const href = tag === "a" ? n.getAttribute?.("href") : linkIn(n);
			if (!href?.includes("#")) return false;
			const raised = tag === "sup" || contains(n, "sup");
			const noteClass = NOTE_CLASS.test(n.getAttribute?.("class") ?? "");
			const gluedToWord = before !== "" && !/[\s\d]/.test(before);
			return raised || noteClass || gluedToWord || /^[*†‡§¶]/.test(marker);
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
			const imageAlts: string[] = [];

			const visit = (n: WalkNode, style: Style) => {
				if (n.nodeType === NODE_TEXT) {
					const text = readable(n.textContent);
					if (text) collected.push({ text, ...style });
					return;
				}
				if (n.nodeType !== NODE_ELEMENT) return;

				const tag = tagOf(n);
				const before = collected[collected.length - 1]?.text.slice(-1) ?? "";
				if (SKIP_TAGS.has(tag) || isNote(n, tag, before)) return;
				if (tag === "img") {
					const alt = readable(n.getAttribute?.("alt")).trim();
					if (alt) imageAlts.push(alt);
					return;
				}
				if (LIST_TAGS.has(tag)) {
					lists.push({ node: n, ...computeStyle(n, style) });
					return;
				}
				if (tag === "br") {
					collected.push({ text: LINE_BREAK, ...style });
					return;
				}

				const own = computeStyle(n, style);
				for (const c of n.childNodes ?? []) visit(c, own);
			};

			for (const c of parent.childNodes ?? []) visit(c, inherited);
			return { runs: collapseRuns(collected), lists, imageAlts };
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
				const text = readable(n.textContent);
				const visible = text.trim() !== "";
				if (cellAwaitingSeparator && visible) {
					runs.push({ text: CELL_SEPARATOR, bold: false, italic: false });
					cellAwaitingSeparator = false;
				}
				if (text) runs.push({ text, ...inherited });
				if (visible) cellHasText = true;
				return;
			}

			if (n.nodeType !== NODE_ELEMENT) return;

			const tag = tagOf(n);
			const before = runs[runs.length - 1]?.text.slice(-1) ?? "";
			const label = labelLink(n, tag);
			if (label && !runsText(runs).trim()) openingBacklink = label;
			if (SKIP_TAGS.has(tag) || isNote(n, tag, before)) return;

			if (tag === "br") {
				runs.push({ text: LINE_BREAK, ...inherited });
				return;
			}

			if (tag === "hr") {
				flush();
				pushBreak();
				return;
			}

			if (tag === "img") {
				flush();
				blocks.push({
					type: "image",
					src: n.getAttribute?.("src") || "",
					alt: readable(n.getAttribute?.("alt")).trim(),
				});
				return;
			}

			const style = computeStyle(n, inherited);

			if (rowDepth > 0) {
				if (tag === "td" || tag === "th") {
					cellAwaitingSeparator = runsText(runs).trim() !== "";
					cellHasText = false;
				} else if (
					(BLOCK_TAGS.has(tag) || HEADING_LEVELS.has(tag)) &&
					cellHasText
				) {
					runs.push({ text: LINE_BREAK, ...style });
				}
				for (const c of n.childNodes ?? []) walk(c, style);
				return;
			}

			if (tag === "tr" && readsAsOneLine(n)) {
				flush();
				pendingTag = "tr";
				rowDepth++;
				for (const c of n.childNodes ?? []) walk(c, style);
				rowDepth--;
				flush();
				return;
			}

			const level = HEADING_LEVELS.get(tag);
			if (level !== undefined) {
				flush();
				const scan = scanInline(n, style);
				let content = runsText(scan.runs);
				let headingRuns = scan.runs;
				if (!content && scan.imageAlts.length > 0) {
					content = scan.imageAlts.join(" ");
					headingRuns = [{ text: content, ...style }];
				}
				if (content) {
					blocks.push({ type: "heading", level, content, runs: headingRuns });
				}
				return;
			}

			if (LIST_TAGS.has(tag)) {
				flush();
				const items: ListItem[] = [];
				gatherItems(n, style, 0, items);
				const start = Number.parseInt(n.getAttribute?.("start") ?? "", 10);
				if (items.length > 0)
					blocks.push({
						type: "list",
						ordered: tag === "ol",
						start: Number.isFinite(start) ? start : 1,
						items,
					});
				return;
			}

			if ((tag === "td" || tag === "th") && pendingTag === "tr") {
				cellAwaitingSeparator = runsText(runs).trim() !== "";
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

		while (blocks[blocks.length - 1]?.type === "break") blocks.pop();
		return blocks;
	}
}
