import { parseHTML } from "linkedom";
import type { EpubZip } from "./zip.ts";

const CONTAINER_PATH = "META-INF/container.xml";

export function getOpfPath(zip: EpubZip): string {
  const xml = zip.readText(CONTAINER_PATH);
  if (!xml) {
    throw new Error("META-INF/container.xml not found — not a valid EPUB");
  }
  let doc: ReturnType<typeof parseHTML>["document"];
  try {
    doc = parseHTML(xml).document;
  } catch {
    throw new Error("Failed to parse container.xml");
  }
  const rootfile = doc.querySelector("rootfile");
  if (!rootfile) {
    throw new Error("Could not find OPF path in container.xml");
  }
  const path = rootfile.getAttribute("full-path");
  if (!path) {
    throw new Error("rootfile element missing full-path attribute");
  }
  return path;
}
