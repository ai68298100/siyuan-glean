import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const stylesheet = resolve('src/index.scss');
const current = readFileSync(stylesheet, 'utf8');
const baseline = execFileSync('git', ['show', 'HEAD:src/index.scss'], { encoding: 'utf8' });

const groups = {
  spacing: /^(?:gap|row-gap|column-gap|padding(?:-(?:block|inline|top|right|bottom|left))?|margin(?:-(?:block|inline|top|right|bottom|left))?)$/,
  typography: /^(?:font-size|font-weight|line-height|letter-spacing)$/,
  radius: /^border-radius$/,
  shadow: /^box-shadow$/,
  layering: /^z-index$/,
  motion: /^(?:transition|animation)$/,
};

function analyze(source) {
  const stats = Object.fromEntries(Object.keys(groups).map((name) => [name, {
    declarations: 0,
    tokenized: 0,
    rawValues: new Map(),
  }]));
  const rawColorValues = new Map();
  const tokenNames = new Set();
  const tokenLiteralValues = new Map();
  const rootStart = source.indexOf(':root');
  const rootOpen = rootStart >= 0 ? source.indexOf('{', rootStart) : -1;
  let rootBlock = '';
  if (rootOpen >= 0) {
    let depth = 0;
    for (let index = rootOpen; index < source.length; index += 1) {
      if (source[index] === '{') depth += 1;
      if (source[index] === '}' && --depth === 0) {
        rootBlock = source.slice(rootOpen + 1, index);
        break;
      }
    }
  }
  const rootTokens = [...rootBlock.matchAll(/(--glean-[\w-]+)\s*:\s*([^;{}]+);/g)]
    .map(([, name, rawValue]) => [name, rawValue.trim().replace(/\s+/g, ' ')]);
  const declarations = source.matchAll(/^\s*([a-z-]+)\s*:\s*([^;{}]+);/gim);

  for (const [, property, rawValue] of declarations) {
    const name = Object.keys(groups).find((key) => groups[key].test(property.toLowerCase()));
    if (name) {
      const entry = stats[name];
      const value = rawValue.trim().replace(/\s+/g, ' ');
      entry.declarations += 1;
      if (/var\(/i.test(value)) entry.tokenized += 1;
      else entry.rawValues.set(value, (entry.rawValues.get(value) ?? 0) + 1);
    }
  }

  for (const match of source.matchAll(/#[\da-f]{3,8}\b|\brgba?\([^)]*\)|\bhsla?\([^)]*\)/gi)) {
    const value = match[0].toLowerCase().replace(/\s+/g, ' ');
    rawColorValues.set(value, (rawColorValues.get(value) ?? 0) + 1);
  }

  for (const [, name, rawValue] of source.matchAll(/(--glean-[\w-]+)\s*:\s*([^;{}]+);/g)) {
    tokenNames.add(name);
    const value = rawValue.trim().replace(/\s+/g, ' ');
    if (!/var\(/i.test(value)) {
      tokenLiteralValues.set(value, (tokenLiteralValues.get(value) ?? 0) + 1);
    }
  }

  return { stats, rawColorValues, tokenNames, tokenLiteralValues, rootTokens };
}

function summarize(label, source) {
  const { stats, rawColorValues, tokenNames, tokenLiteralValues, rootTokens } = analyze(source);
  console.log(`\n${label}`);
  for (const [name, entry] of Object.entries(stats)) {
    const coverage = entry.declarations === 0 ? 100 : Math.round(entry.tokenized / entry.declarations * 1000) / 10;
    const repeated = [...entry.rawValues.entries()]
      .filter(([, count]) => count > 1)
      .sort((a, b) => b[1] - a[1]);
    console.log(`${name}: ${entry.tokenized}/${entry.declarations} 使用 var() (${coverage}%)；${entry.rawValues.size} 种原始值；重复值 ${repeated.length} 种`);
    if (repeated.length) console.log(`  高频原始值: ${repeated.slice(0, 8).map(([value, count]) => `${value} ×${count}`).join(' | ')}`);
  }
  console.log(`颜色字面量: ${[...rawColorValues.values()].reduce((sum, count) => sum + count, 0)} 处；${rawColorValues.size} 种`);
  console.log(`重复颜色: ${[...rawColorValues.entries()].filter(([, count]) => count > 1).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([value, count]) => `${value} ×${count}`).join(' | ') || '无'}`);
  const duplicateTokens = [...tokenLiteralValues.entries()]
    .filter(([, count]) => count > 1)
    .sort((a, b) => b[1] - a[1]);
  console.log(`自定义令牌: ${tokenNames.size} 个唯一名称；${[...tokenLiteralValues.values()].reduce((sum, count) => sum + count, 0)} 个字面量声明；重复字面量 ${duplicateTokens.length} 种`);
  console.log(`重复令牌值: ${duplicateTokens.slice(0, 8).map(([value, count]) => `${value} ×${count}`).join(' | ') || '无'}`);
  const spacingTokens = rootTokens.filter(([name, value]) => name.startsWith('--glean-space-') && /^-?\d+(?:\.\d+)?px$/.test(value));
  const gridSpacing = spacingTokens.filter(([, value]) => Number.parseFloat(value) % 4 === 0);
  const gridCoverage = spacingTokens.length === 0 ? 100 : Math.round(gridSpacing.length / spacingTokens.length * 1000) / 10;
  const typeSizes = rootTokens.filter(([name, value]) => name.startsWith('--glean-text-') && /^\d+(?:\.\d+)?px$/.test(value));
  console.log(`:root 尺度：${rootTokens.length} 个令牌；间距 4px 栅格 ${gridSpacing.length}/${spacingTokens.length} (${gridCoverage}%)；字号原始档 ${typeSizes.length} 个`);
  const rootNames = new Set(rootTokens.map(([name]) => name));
  const unresolved = [...source.matchAll(/var\((--glean-[\w-]+)/g)]
    .map(([, name]) => name)
    .filter((name) => !rootNames.has(name));
  console.log(`未在 :root 声明的运行时变量: ${[...new Set(unresolved)].join(', ') || '无（运行时注入变量除外）'}`);
}

summarize('基线 (HEAD)', baseline);
summarize('当前工作树', current);
