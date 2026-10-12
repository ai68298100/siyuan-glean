import { readFileSync } from "node:fs";

// Repeatable source-level inventory of design-related declarations in src/index.scss.
// This is a text audit (not a compiled CSS AST); a declaration using a theme/design
// variable is classified as tokenized even when it also contains literal offsets.
const source = readFileSync(new URL("../src/index.scss", import.meta.url), "utf8");
const target = /^(?:color|background(?:-color)?|border(?:-[\w]+)?|fill|stroke|margin(?:-[\w]+)?|padding(?:-[\w]+)?|gap|row-gap|column-gap|font-size|line-height|font-weight|letter-spacing|border-radius|box-shadow|transition|animation-duration)$/;
const literal = /(?:#[\da-f]{3,8}\b|\b(?:rgba?|hsla?)\(|\b\d*\.?\d+(?:px|rem|em|vw|vh|ms|s)\b)/i;
const counts = { total: 0, tokenized: 0, hardcoded: 0, other: 0 };

for (const line of source.split(/\r?\n/)) {
    const match = line.match(/^\s*([\w-]+)\s*:\s*(.*?)\s*;\s*(?:\/\*.*)?$/);
    if (!match || !target.test(match[1])) continue;
    counts.total += 1;
    if (/var\(--(?:glean|b3)-/i.test(match[2])) counts.tokenized += 1;
    else if (literal.test(match[2])) counts.hardcoded += 1;
    else counts.other += 1;
}

counts.tokenizedPercent = Number((counts.tokenized / counts.total * 100).toFixed(1));
console.log(JSON.stringify(counts, null, 2));
