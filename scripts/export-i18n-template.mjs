#!/usr/bin/env node
// Exports the current English dictionary from frontend/src/lib/i18n.tsx as a
// flat {"key": "value"} JSON file -- a starting point for someone
// contributing a third language (see CONTRIBUTING.md's "Translations"
// section). Deliberately just an export/template tool, not a build step:
// i18n.tsx stays the single source of truth compiled into the app, this
// script only makes it easy to get a reference copy in a translator-
// friendly format. There is no runtime language-pack loading here -- a
// contributed translation still becomes a real `dictionaries.xx` block in
// i18n.tsx via a PR, same as de/en today.
//
// Regex-based on purpose: i18n.tsx's dictionaries are plain, flat
// `"key": "value",` lines (see the file itself) with no nesting or
// interpolation to worry about, so a full TS/AST parser would be more
// machinery than the format needs.

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const I18N_PATH = resolve(__dirname, "../frontend/src/lib/i18n.tsx");
const OUTPUT_PATH = resolve(__dirname, "../i18n-template.json");

const source = readFileSync(I18N_PATH, "utf-8");

const enStart = source.indexOf("\n  en: {");
if (enStart === -1) {
  throw new Error(`Could not find the "en: {" block in ${I18N_PATH} -- has the file structure changed?`);
}
const enBlockEnd = source.indexOf("\n  },", enStart);
if (enBlockEnd === -1) {
  throw new Error(`Could not find the end of the "en: {" block in ${I18N_PATH}.`);
}
const enBlock = source.slice(enStart, enBlockEnd);

// Matches lines like `"key.name": "Value here",` -- including the
// multi-line ones in i18n.tsx (a long value split across two lines with
// the string continuing on the next), since JS allows the `"key":` and the
// opening `"` of its value to be separated by a line break/whitespace.
const ENTRY_RE = /"([a-zA-Z0-9_.]+)":\s*\n?\s*"((?:[^"\\]|\\.)*)"/g;

const entries = {};
let match;
while ((match = ENTRY_RE.exec(enBlock)) !== null) {
  const [, key, rawValue] = match;
  entries[key] = rawValue.replace(/\\"/g, '"').replace(/\\n/g, "\n");
}

const keyCount = Object.keys(entries).length;
if (keyCount < 100) {
  // Sanity check -- i18n.tsx has hundreds of keys; a near-empty result
  // means the regex above stopped matching (e.g. after a file restructure)
  // rather than that the dictionary genuinely shrank to almost nothing.
  throw new Error(`Only extracted ${keyCount} keys from the en block -- something's wrong, refusing to write a near-empty template.`);
}

writeFileSync(OUTPUT_PATH, JSON.stringify(entries, null, 2) + "\n", "utf-8");
console.log(`Wrote ${keyCount} keys to ${OUTPUT_PATH}`);
