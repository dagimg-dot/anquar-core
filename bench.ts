#!/usr/bin/env bun
/**
 * Benchmarks the actual CLI on all sample EPUBs.
 * Runs `buktok parse <file.epub> --stats` as a subprocess and times it.
 * This includes Bun's startup time, parsing, chunking, and stats generation.
 *
 * Usage: bun run bench.ts
 */

import { readdirSync, statSync } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const CLI = join(__dirname, "src", "index.ts");
const samplesDir = join(__dirname, "samples");

const files = readdirSync(samplesDir)
  .filter((f: string) => f.endsWith(".epub"))
  .sort();

console.log(`${"File".padEnd(42)} ${"Size".padEnd(8)} ${"Time".padEnd(8)} ${"Chaps".padEnd(6)} ${"Blocks".padEnd(7)}`);
console.log("─".repeat(75));

let totalTime = 0;
let totalBlocks = 0;

for (const file of files) {
  const path = join(samplesDir, file);
  const sizeBytes = statSync(path).size;
  const size = (sizeBytes / 1024 / 1024).toFixed(1) + "M";

  const t0 = performance.now();
  const proc = Bun.spawnSync(["bun", "run", CLI, "parse", path, "--stats"], {
    env: { ...process.env },
  });
  const elapsed = (performance.now() - t0).toFixed(0);

  const stdout = proc.stdout.toString();
  const stderr = proc.stderr.toString();

  // Parse chapters and blocks from stderr (tracing goes to stderr)
  const chapMatch = stderr.match(/(\d+) chapters? → (\d+) blocks?/);
  const chaps = chapMatch?.[1] ?? "?";
  const blocks = parseInt(chapMatch?.[2] ?? "0");

  totalTime += parseInt(elapsed);
  totalBlocks += blocks;

  const status = proc.exitCode === 0 ? " " : "⚠";
  console.log(`${status} ${file.padEnd(40)} ${size.padEnd(8)} ${elapsed.padEnd(8)} ${String(chaps).padEnd(6)} ${String(blocks).padEnd(7)}`);

  if (proc.exitCode !== 0) {
    console.error(`  └─ exit ${proc.exitCode}: ${stderr.slice(0, 200)}`);
  }
}

console.log("─".repeat(75));
const numFiles = files.length;
console.log(`  ${numFiles} files, ${totalTime}ms total, ${totalBlocks} blocks`);
console.log(`  Avg: ${(totalTime / numFiles).toFixed(0)}ms per file`);
console.log(`  Blocks/sec: ${(totalBlocks / (totalTime / 1000)).toFixed(0)}`);
