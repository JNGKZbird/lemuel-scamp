#!/usr/bin/env node
/**
 * Release guard: the public code repo must not ship game assets.
 *
 * Vite copies public/ into dist/, and Tauri bundles dist/ into installers.
 * Refuse to build an installer while public/models or dist/models is non-empty.
 */
import { readdir } from "node:fs/promises";

const roots = ["public/models", "dist/models"];
const found = [];

for (const root of roots) {
  let entries;
  try {
    entries = await readdir(root);
  } catch {
    continue;
  }
  if (entries.length > 0) found.push(`${root}/ (${entries.length} entries)`);
}

if (found.length > 0) {
  console.error("Refusing to build a release with game assets present:");
  for (const item of found) console.error(`  - ${item}`);
  console.error(
    "Move public/models out of the project, or remove dist/models, before building an installer.",
  );
  process.exit(1);
}

console.log(
  "Release asset guard: no game assets under public/models or dist/models.",
);
