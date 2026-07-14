import { parseHTML } from "linkedom";

export interface OpfItem {
  id: string;
  href: string;
  mediaType: string;
}

export interface ParsedOpf {
  opfDir: string;
  manifest: Map<string, OpfItem>;
  spine: { idref: string }[];
  /** Book title from OPF metadata. */
  title: string;
  /** Book author from OPF metadata. */
  author: string;
}

/**
 * Parse raw OPF XML into a structured manifest + spine + metadata.
 * Uses linkedom DOM for robust handling of namespaces and formatting.
 */
export function parseOpf(opfXml: string, opfPath: string): ParsedOpf {
  const manifest = new Map<string, OpfItem>();
  const spine: { idref: string }[] = [];
  const opfDir = opfPath.includes("/") ? opfPath.replace(/\/[^/]+$/, "") + "/" : "";

  let doc: ReturnType<typeof parseHTML>["document"];
  try {
    doc = parseHTML(opfXml).document;
  } catch {
    return { opfDir, manifest, spine, title: "Unknown", author: "Unknown" };
  }

  // ── Metadata ────────────────────────────────────────────────
  // Namespaced elements like dc:title aren't reliably queriable,
  // so iterate all elements and match on tag name.
  let title = "Unknown";
  let author = "Unknown";
  for (const el of doc.querySelectorAll("*")) {
    const tag = (el.tagName || "").toLowerCase();
    if (tag === "dc:title" || tag.endsWith(":title")) {
      const t = (el.textContent || "").trim();
      if (t) title = t;
    }
    if (tag === "dc:creator" || tag.endsWith(":creator")) {
      const a = (el.textContent || "").trim();
      if (a) author = a;
    }
  }

  // ── Manifest ────────────────────────────────────────────────
  for (const el of doc.querySelectorAll("*")) {
    const tag = (el.tagName || "").toLowerCase();
    // Match "item" in any namespace (default opf or otherwise)
    if (tag === "item" || tag.endsWith(":item")) {
      const id = el.getAttribute("id");
      const href = el.getAttribute("href");
      const mediaType = el.getAttribute("media-type") || "";
      if (id && href) {
        manifest.set(id, { id, href, mediaType });
      }
    }
  }

  // ── Spine ────────────────────────────────────────────────────
  for (const el of doc.querySelectorAll("*")) {
    const tag = (el.tagName || "").toLowerCase();
    if (tag === "itemref" || tag.endsWith(":itemref")) {
      const idref = el.getAttribute("idref");
      if (idref) spine.push({ idref });
    }
  }

  return { opfDir, manifest, spine, title, author };
}
