import test from "node:test";
import assert from "node:assert/strict";
import { analyzeFormatting, buildFormattingPrompt, formattingCandidates, formattingSourceLink, parseFormattingPlan, renderFormatting } from "../src/domain/formatting.ts";

const longUrl = `https://example.test/article?tracking=${"a".repeat(90)}`;
const emptyPlan = { headings: [], cleanup: [] };

test("基础整理只缩短 URL 显示，目标、命名链接和尾部标点保留", () => {
    const original = `正文 ${longUrl}。\n\n[${longUrl}](${longUrl} "title")\n\n[来源](${longUrl})\n\n<${longUrl}>`;
    const result = renderFormatting(analyzeFormatting(original));
    assert.match(result, /正文 \[example\.test\/…\]\(<https:\/\/example\.test\/article\?tracking=a+>\)。/);
    assert.ok(result.includes(`[example.test/…](${longUrl} "title")`));
    assert.ok(result.includes(`[来源](${longUrl})`));
    assert.equal(result.split(longUrl).length - 1, 4);
});

test("普通段落多余空行收束到一个空行，保留首尾空白与 CRLF", () => {
    assert.equal(renderFormatting(analyzeFormatting("\n开头\n\n\n\n后文\n\n")), "\n开头\n\n后文\n\n");
    assert.equal(renderFormatting(analyzeFormatting("前文\r\n\r\n\r\n后文\r\n")), "前文\r\n\r\n后文\r\n");
});

test("HTML 注释允许 --!> 闭合，后文不被吞入受保护块", () => {
    const source = "<!--\n受保护内容\n--!>\n\n后文";
    const analysis = analyzeFormatting(source);
    assert.equal(analysis.blocks[0].raw.trimEnd(), "<!--\n受保护内容\n--!>");
    assert.equal(analysis.blocks[1].raw, "后文");
});

const protectedSamples = [
    `\`\`\`md\n${longUrl}\n\n\n代码\n\`\`\``,
    `~~~~text\n${longUrl}\n\n代码\n~~~~~`,
    `\`\`\`js\n${longUrl}\n\n未闭合代码`,
    `$$\n${longUrl}\n\n\n公式\n$$`,
    `> 引用\n> ${longUrl}`,
    `- 列表\n  ${longUrl}\n\n    延续`,
    `| 表头 |\n| --- |\n| ${longUrl} |`,
    `<div>\n<div>内部</div>\n\n${longUrl}\n</div>`,
    `<!--\n\n${longUrl}\n-->`,
    `{{{ row\n{{{ col\n内部\n}}}\n\n${longUrl}\n}}}`,
    `文本\n{: id="20261004120000-aaaaaaa" custom-name="test"}`,
    `    ${longUrl}\n\n    代码`,
    `正文含 \`代码 ${longUrl}\``,
    `[ref]: ${longUrl}\n\n[来源][ref]`,
    `---\nurl: ${longUrl}\n\nvalue: kept\n---`,
    `旧标题\n---`,
];

for (const [index, source] of protectedSamples.entries()) {
    test(`复杂结构 ${index + 1} 字节保留，AI 不得提升或清理`, () => {
        const analysis = analyzeFormatting(source);
        assert.equal(renderFormatting(analysis), source);
        const protectedBlock = analysis.blocks.find((block) => block.kind === "protected")!;
        assert.ok(protectedBlock);
        assert.equal(parseFormattingPlan(JSON.stringify({ headings: [], cleanup: [{ id: protectedBlock.id }] }), analysis), null);
        assert.equal(parseFormattingPlan(JSON.stringify({ headings: [{ id: protectedBlock.id, level: 2 }], cleanup: [] }), analysis), null);
    });
}

test("图片及推广候选默认不删，只删除用户选择且不触碰 assets", () => {
    const source = "正文\n\n请关注我们的公众号\n\n![图示](assets/figure.png)\n\n![再次出现](assets/figure.png)\n\n![](assets/other.png)";
    const analysis = analyzeFormatting(source);
    assert.deepEqual(analysis.candidates, [
        { id: "p2", reasons: ["promotion"] },
        { id: "p4", reasons: ["duplicateImage"] },
        { id: "p5", reasons: ["unlabelledImage"] },
    ]);
    assert.equal(renderFormatting(analysis), source);
    const selected = renderFormatting(analysis, emptyPlan, ["p2", "p4"]);
    assert.ok(!selected.includes("请关注"));
    assert.ok(selected.includes("![图示](assets/figure.png)"));
    assert.ok(!selected.includes("![再次出现]"));
    assert.ok(selected.includes("![](assets/other.png)"));
    assert.equal(analysis.source, source);
    assert.throws(() => renderFormatting(analysis, emptyPlan, ["p1"]));
});

test("乱码检测不猜测改写", () => {
    const source = "无法恢复 � 原句\n\n疑似 Ã©Ã±\n\n正常文本";
    const analysis = analyzeFormatting(source);
    assert.equal(analysis.encodingWarnings, 2);
    assert.equal(renderFormatting(analysis), source);
});

test("AI 只增加标题标记，段落原句与顺序不变", () => {
    const analysis = analyzeFormatting("第一节\n\n原句一。\n\n第二节\n\n原句二。");
    const plan = parseFormattingPlan('```json\n{"headings":[{"id":"p1","level":2},{"id":"p3","level":3}],"cleanup":[]}\n```', analysis)!;
    assert.equal(renderFormatting(analysis, plan), "## 第一节\n\n原句一。\n\n### 第二节\n\n原句二。");
});

test("AI 非法 ID、层级、字段、重复、重写正文或多行标题整体拒绝", () => {
    const analysis = analyzeFormatting("标题\n\n原句一\n原句二");
    const invalid = [
        { headings: [{ id: "other", level: 2 }], cleanup: [] },
        { headings: [{ id: "p1", level: 1 }], cleanup: [] },
        { headings: [{ id: "p2", level: 2 }], cleanup: [] },
        { headings: [{ id: "p1", level: 2, text: "新句" }], cleanup: [] },
        { headings: [{ id: "p1", level: 2 }], cleanup: [{ id: "p1" }] },
        { headings: [], cleanup: [{ id: "p1" }, { id: "p1" }] },
        { headings: [], cleanup: [], markdown: "替换正文" },
        { headings: [], cleanup: [{ id: "p1", reason: "overwrite" }] },
    ];
    for (const input of invalid) assert.equal(parseFormattingPlan(JSON.stringify(input), analysis), null);
    assert.equal(parseFormattingPlan("[]", analysis), null);
    assert.equal(parseFormattingPlan("not JSON", analysis), null);
});

test("AI 清理建议必须另行勾选且基础候选合并不变异", () => {
    const analysis = analyzeFormatting("正文\n\n请关注公众号\n\n其他段落");
    const plan = { headings: [], cleanup: [{ id: "p2" }, { id: "p3" }] };
    assert.equal(renderFormatting(analysis, plan), analysis.source);
    assert.deepEqual(formattingCandidates(analysis, plan), [
        { id: "p2", reasons: ["promotion", "ai"] },
        { id: "p3", reasons: ["ai"] },
    ]);
    assert.deepEqual(analysis.candidates[0].reasons, ["promotion"]);
});

test("过长文章或过多段落不静默截断送模型，保护块仅送占位", () => {
    assert.equal(buildFormattingPrompt(analyzeFormatting("文".repeat(24001))), null);
    assert.equal(buildFormattingPrompt(analyzeFormatting(Array.from({ length: 401 }, () => "段落").join("\n\n"))), null);
    const prompt = buildFormattingPrompt(analyzeFormatting("标题\n\n```\nprivate code\n```"))!;
    assert.ok(prompt.includes("标题"));
    assert.ok(prompt.includes("[protected]"));
    assert.ok(!prompt.includes("private code"));
});

test("AI prompt masks image metadata and rejects visual cleanup without image input", () => {
    const analysis = analyzeFormatting("说明文字\n\n![私人截图](https://images.example.test/private.png?token=secret)\n\n结尾");
    const prompt = buildFormattingPrompt(analysis)!;
    assert.ok(prompt.includes('"kind":"image"'));
    assert.ok(prompt.includes('"text":"[image]"'));
    assert.ok(!prompt.includes("images.example.test"));
    assert.ok(!prompt.includes("private.png"));
    assert.ok(!prompt.includes("私人截图"));
    assert.equal(parseFormattingPlan(JSON.stringify({ headings: [], cleanup: [{ id: "p2" }] }), analysis), null);
});

test("来源回链仅接受安全的 HTTP(S) URL", () => {
    for (const source of ["javascript:alert(1)", "https://example.test/ x", "https://example.test/<x>", "https://example.test/\\x", ""]) assert.equal(formattingSourceLink(source), "");
    assert.equal(formattingSourceLink(longUrl), longUrl);
});
