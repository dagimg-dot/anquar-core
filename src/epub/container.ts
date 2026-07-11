import type { EpubZip } from "./zip.ts";

const CONTAINER_PATH = "META-INF/container.xml";

/**
 * Read META-INF/container.xml and extract the OPF package document path.
 * Returns the OPF path (e.g. "OEBPS/content.opf") relative to ZIP root.
 */
export function getOpfPath(zip: EpubZip): string {
  const xml = zip.readText(CONTAINER_PATH);
  if (!xml) {
    throw new Error("META-INF/container.xml not found — not a valid EPUB");
  }
  const match = xml.match(/full-path="([^"]+)"/);
  if (!match) {
    throw new Error("Could not find OPF path in container.xml");
  }
  return match[1];
}
