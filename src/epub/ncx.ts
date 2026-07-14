import { parseHTML } from "linkedom";
import { decodeEntities } from "../utils/entities.ts";

/**
 * Parse the NCX (Navigation Control XML) file.
 *
 * Uses linkedom DOM to recursively extract <navPoint> entries
 * with their <text> titles and <content> hrefs.
 */
export function parseNcx(ncxXml: string): Map<string, string> {
  const titles = new Map<string, string>();

  let doc: ReturnType<typeof parseHTML>["document"];
  try {
    doc = parseHTML(ncxXml).document;
  } catch {
    return titles;
  }

  // Walk all elements looking for navPoint in any namespace
  for (const el of doc.querySelectorAll("*")) {
    const tag = (el.tagName || "").toLowerCase();
    if (tag === "navpoint" || tag.endsWith(":navpoint")) {
      const textEl = findChild(el, "text");
      const contentEl = findChild(el, "content");
      if (!textEl || !contentEl) continue;

      const title = decodeEntities((textEl.textContent || "").trim());
      const href = (contentEl.getAttribute("src") || "").split("#")[0];
      if (title && href && !titles.has(href)) {
        titles.set(href, title);
      }
    }
  }

  return titles;
}

/** Find first child element with a matching local tag name (ignoring namespace). */
function findChild(parent: Element, localName: string): Element | null {
  for (const child of parent.children || []) {
    const tag = ((child as any).tagName || "").toLowerCase();
    if (tag === localName || tag.endsWith(`:${localName}`)) {
      return child as Element;
    }
  }
  return null;
}
