import AdmZip from "adm-zip";

/**
 * Thin wrapper around AdmZip for EPUB file access.
 * Provides path resolution helpers for EPUBS's
 * relative-path maze (OPF dir vs XHTML dir).
 */
export class EpubZip {
  private zip: AdmZip;

  constructor(input: string | Uint8Array) {
    switch (typeof input) {
      case "string":
        this.zip = new AdmZip(input);
        break;
      default:
        this.zip = new AdmZip(input as unknown as Buffer);
        break;
    }
  }

  /** Read a file from the ZIP as text. Returns empty string if not found. */
  readText(path: string): string {
    try {
      return this.zip.readAsText(path);
    } catch {
      return "";
    }
  }

  /** Read a file from the ZIP as binary. Returns null if not found. */
  readBinary(path: string): Uint8Array | null {
    try {
      return this.zip.readFile(path);
    } catch {
      return null;
    }
  }

  /** Check if a path exists in the ZIP. */
  has(path: string): boolean {
    return this.zip.getEntry(path) !== null;
  }

  /** List entries matching a prefix. */
  list(prefix: string): string[] {
    return this.zip
      .getEntries()
      .filter((e) => !e.isDirectory && e.entryName.startsWith(prefix))
      .map((e) => e.entryName);
  }

  /**
   * Normalise a relative path against a base directory.
   * Handles "../" traversal and "./" prefixes.
   *
   * @example
   *   resolvePath("OEBPS/", "../Images/foo.jpg") → "Images/foo.jpg"
   *   resolvePath("OEBPS/", "css/style.css") → "OEBPS/css/style.css"
   */
  resolvePath(base: string, rel: string): string {
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

  /**
   * Directory part of a path (everything before the last "/").
   * Returns empty string if no directory component.
   */
  dirname(path: string): string {
    const i = path.lastIndexOf("/");
    return i >= 0 ? path.slice(0, i + 1) : "";
  }
}
