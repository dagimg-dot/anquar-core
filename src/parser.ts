import AdmZip from "adm-zip";
import { parseHTML } from "linkedom";
import type { ParsedBook, ParsedChapter, Block } from "./types.ts";

// ─── Internal types ─────────────────────────────────────────────────

interface OpfItem {
  id: string;
  href: string;
  mediaType: string;
}

interface ParsedOpf {
  manifest: Map<string, OpfItem>;
  spine: { idref: string }[];
  opfDir: string;
}

// ─── OPF parser ─────────────────────────────────────────────────────

function parseOpf(opfXml: string, opfPath: string): ParsedOpf {
  const manifest = new Map<string, OpfItem>();
  const spine: { idref: string }[] = [];
  const opfDir = opfPath.includes("/") ? opfPath.replace(/\/[^/]+$/, "/") : "";

  const itemRe = /<item\s[^>]*\/?>/gi;
  let m: RegExpExecArray | null;
  while ((m = itemRe.exec(opfXml)) !== null) {
    const id = m[0].match(/id="([^"]+)"/)?.[1];
    const href = m[0].match(/href="([^"]+)"/)?.[1];
    const mediaType = m[0].match(/media-type="([^"]+)"/)?.[1] || "";
    if (id && href) manifest.set(id, { id, href, mediaType });
  }

  const spineBlock = opfXml.match(/<spine[^>]*>([\s\S]*?)<\/spine>/i);
  if (spineBlock) {
    const refRe = /<itemref[^>]*idref="([^"]+)"[^>]*\/?>/gi;
    while ((m = refRe.exec(spineBlock[1])) !== null) {
      spine.push({ idref: m[1] });
    }
  }

  return { manifest, spine, opfDir };
}

// ─── XHTML → blocks ──────────────────────────────────────────────────

interface RawBlock {
  type: "text" | "image";
  content: string;
}

function extractBlocks(html: string): RawBlock[] {
  const { document } = parseHTML(html);
  const body = document.querySelector("body");
  if (!body) return [];

  const blockTags = new Set([
    "p", "div", "h1", "h2", "h3", "h4", "h5", "h6",
    "blockquote", "li", "section", "figure", "td", "th", "pre",
  ]);

  const blocks: RawBlock[] = [];
  const buf: string[] = [];

  function flush() {
    const t = buf.join(" ").replace(/\s+/g, " ").trim();
    if (t) blocks.push({ type: "text", content: t });
    buf.length = 0;
  }

  function walk(n: any, insideBlock: boolean) {
    if (!n) return;

    if (n.nodeType === 3) {
      const t = (n.textContent || "").trim();
      if (t) buf.push(t);
      return;
    }
    if (n.nodeType !== 1) return;

    const tag = (n.tagName || "").toLowerCase();
    if (["script", "style", "noscript", "title", "meta", "link"].includes(tag)) return;

    // <br> → implicit flush (line break = new segment)
    if (tag === "br") {
      if (buf.length > 0) buf.push(" ");
      return;
    }

    // <hr> → explicit break
    if (tag === "hr") {
      flush();
      return;
    }

    if (tag === "img") {
      flush();
      const src = n.getAttribute("src") || "";
      blocks.push({ type: "image", content: src });
      return;
    }

    const isBlock = blockTags.has(tag);
    // If this is a new block element with content in buffer, flush first
    if (isBlock && buf.length > 0) {
      // Check if it's a wrapper around a single img
      const kids = n.childNodes || [];
      const nonTextKids = Array.from(kids).filter(
        (k: any) => k.nodeType === 1 && !["script", "style", "br"].includes((k.tagName || "").toLowerCase())
      );
      if (nonTextKids.length === 1 && nonTextKids[0]?.nodeType === 1 &&
          (nonTextKids[0]?.tagName || "").toLowerCase() === "img") {
        // Will be handled when we walk into it
      } else {
        flush();
      }
    }

    const kids = n.childNodes || [];
    for (const c of kids) walk(c, isBlock);

    // Flush after block end so each paragraph is its own block
    if (isBlock) flush();
  }

  walk(body, false);
  flush();
  return blocks;
}

// ─── Main parser ─────────────────────────────────────────────────────

export async function parseEpub(filePath: string): Promise<ParsedBook> {
  const zip = new AdmZip(filePath);

  // container.xml → OPF path
  const container = zip.readAsText("META-INF/container.xml");
  const opfRel = container.match(/full-path="([^"]+)"/)?.[1];
  if (!opfRel) throw new Error("OPF path not found in container.xml");

  const opfXml = zip.readAsText(opfRel);
  const opf = parseOpf(opfXml, opfRel);

  const title = opfXml.match(/<dc:title[^>]*>([^<]*)<\/dc:title>/i)?.[1] || "Unknown";
  const author = opfXml.match(/<dc:creator[^>]*>([^<]*)<\/dc:creator>/i)?.[1] || "Unknown";

  // Pre-index image paths for fast lookup
  const imgPaths = new Map<string, string>();
  for (const item of opf.manifest.values()) {
    if (item.mediaType.startsWith("image/")) {
      imgPaths.set(item.href, resolvePath(opf.opfDir, item.href));
    }
  }

  // Build chapter title map from NCX (Navigation Control XML)
  const tocTitles = new Map<string, string>();
  try {
    const ncxPath = resolvePath(opf.opfDir, "toc.ncx");
    const ncx = zip.readAsText(ncxPath);
    const navRe = /<navPoint[^>]*>[\s\S]*?<text>([^<]*)<\/text>[\s\S]*?<content[^>]*src="([^"]*)"[\s\S]*?<\/navPoint>/gi;
    let nm: RegExpExecArray | null;
    while ((nm = navRe.exec(ncx)) !== null) {
      const href = nm[2].split("#")[0]; // strip anchor
      const title = htmlDecode(nm[1].replace(/&amp;/g, "&"));
      tocTitles.set(href, title);
    }
  } catch {
    // NCX might not exist — that's fine
  }

  const chapters: ParsedChapter[] = [];

  for (const sp of opf.spine) {
    const item = opf.manifest.get(sp.idref);
    if (!item) continue;
    if (!item.mediaType.includes("xhtml") && !item.mediaType.includes("html")) continue;

    const xhtmlPath = resolvePath(opf.opfDir, item.href);
    let html: string;
    try { html = zip.readAsText(xhtmlPath); } catch { continue; }

    const raw = extractBlocks(html);
    if (raw.length === 0) continue;

    // Chapter title: NCX > h1/h2 > <title>
    const tocTitle = tocTitles.get(item.href);
    const hMatch = html.match(/<h[12][^>]*>([^<]*)<\/h[12]>/i);
    const tMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i);
    const rawTitle = tocTitle || hMatch?.[1]?.trim() || tMatch?.[1]?.trim() || `Chapter ${chapters.length + 1}`;
    const chTitle = htmlDecode(rawTitle);

    const blocks: Block[] = raw.map((b, i) => {
      if (b.type === "text") {
        return {
          type: "text",
          id: `c${chapters.length}-${i}`,
          content: b.content,
          charCount: b.content.length,
          chapterIndex: chapters.length,
          position: i,
        } as const;
      }
      // Resolve image to bytes
      let data: Uint8Array | null = null;
      const resolved = resolvePath(opf.opfDir, b.content);
      try { data = zip.readFile(resolved); } catch {
        // try via pre-indexed
        const alt = imgPaths.get(b.content);
        if (alt) try { data = zip.readFile(alt); } catch {}
      }
      return {
        type: "image",
        id: `c${chapters.length}-${i}`,
        src: b.content,
        alt: "",
        data,
        chapterIndex: chapters.length,
        position: i,
      } as const;
    });

    chapters.push({ index: chapters.length, title: chTitle, blocks });
  }

  return { title, author, chapters };
}

// ─── Helpers ─────────────────────────────────────────────────────────

function resolvePath(base: string, rel: string): string {
  if (rel.startsWith("/")) return rel.slice(1);
  let p = rel.startsWith("./") ? rel.slice(2) : rel;
  const parts = (base + p).split("/").filter(Boolean);
  const out: string[] = [];
  for (const seg of parts) {
    if (seg === "..") out.pop();
    else if (seg !== ".") out.push(seg);
  }
  return out.join("/");
}

function htmlDecode(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#821[67];/g, "'")
    .replace(/&#821[12];/g, "–")
    .replace(/&#821[23];/g, "—")
    .replace(/&#8230;/g, "…")
    .replace(/&#x201[89];/g, "'")
    .replace(/&#x201[34];/g, "–")
    .replace(/&#x2014;/g, "—")
    .replace(/&#x2026;/g, "…")
    .replace(/&#160;/g, " ")
    .replace(/&#x00A0;/g, " ");
}
