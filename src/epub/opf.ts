/**
 * Parse the OPF (Open Packaging Format) file.
 *
 * The OPF is the EPUB's manifest — it lists every resource file
 * (XHTML, images, CSS, fonts) and defines the spine (reading order).
 */

export interface OpfItem {
  id: string;
  href: string;
  mediaType: string;
}

export interface ParsedOpf {
  /** Directory prefix of the OPF file itself (for resolving relative hrefs). */
  opfDir: string;
  /** All resources keyed by manifest id. */
  manifest: Map<string, OpfItem>;
  /** Document order (spine itemrefs referencing manifest ids). */
  spine: { idref: string }[];
}

/**
 * Parse raw OPF XML into a structured manifest + spine.
 *
 * @param opfXml — raw XML text of the .opf file
 * @param opfPath — path within the EPUB ZIP (e.g. "OEBPS/content.opf")
 */
export function parseOpf(opfXml: string, opfPath: string): ParsedOpf {
  const manifest = new Map<string, OpfItem>();
  const spine: { idref: string }[] = [];
  const opfDir = opfPath.includes("/") ? opfPath.replace(/\/[^/]+$/, "") + "/" : "";

  // Parse <manifest> <item ... /> entries
  const itemRe = /<item\s[^>]*\/?>/gi;
  let m: RegExpExecArray | null;
  while ((m = itemRe.exec(opfXml)) !== null) {
    const id = attr(m[0], "id");
    const href = attr(m[0], "href");
    const mediaType = attr(m[0], "media-type") || "";
    if (id && href) {
      manifest.set(id, { id, href, mediaType });
    }
  }

  // Parse <spine> <itemref ... /> entries
  const spineBlock = opfXml.match(/<spine[^>]*>([\s\S]*?)<\/spine>/i);
  if (spineBlock) {
    const refRe = /<itemref[^>]*idref="([^"]+)"[^>]*\/?>/gi;
    while ((m = refRe.exec(spineBlock[1])) !== null) {
      spine.push({ idref: m[1] });
    }
  }

  return { opfDir, manifest, spine };
}

/** Extract an attribute value from an XML tag string. */
function attr(tag: string, name: string): string | undefined {
  // Try double-quoted first, then single-quoted
  const dq = tag.match(new RegExp(`${name}="([^"]*)"`));
  if (dq) return dq[1];
  const sq = tag.match(new RegExp(`${name}='([^']*)'`));
  return sq?.[1];
}
