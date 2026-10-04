import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BOARD_HEADING = "## 当前执行板";
const BOARD_END_HEADING = "### 先闭环";
const CURRENT_HANDOFF_HEADING = "# 当前有效交接";
const FIELD_LABELS = ["代码状态", "隔离验证", "真实验收", "延后原因"];

function sectionBetween(markdown, startHeading, endHeading) {
    const start = markdown.indexOf(startHeading);
    if (start < 0) throw new Error(`缺少章节：${startHeading}`);
    const end = markdown.indexOf(endHeading, start + startHeading.length);
    return markdown.slice(start, end < 0 ? markdown.length : end);
}

function taskLine(line) {
    const match = line.match(/^- \[([^\]]+)\] \*\*(T-\d+)\*\*(.*)$/);
    if (!match) return null;
    const fields = Object.fromEntries(FIELD_LABELS.map((label) => {
        const value = match[3].match(new RegExp(`${label}：([^；。]+)`))?.[1]?.trim() || "";
        return [label, value];
    }));
    return {
        id: match[2],
        boardStatus: match[1],
        description: match[3].split("代码状态：")[0].trim(),
        fields,
        line,
    };
}

function taskOccurrences(markdown) {
    const occurrences = new Map();
    markdown.split(/\r?\n/).forEach((line, index) => {
        const match = line.match(/^- \[[^\]]+\] \*{0,2}(T-\d+)\*{0,2}/);
        if (!match) return;
        const rows = occurrences.get(match[1]) || [];
        rows.push(index + 1);
        occurrences.set(match[1], rows);
    });
    return occurrences;
}

function currentHandoff(markdown) {
    const start = markdown.indexOf(CURRENT_HANDOFF_HEADING);
    if (start < 0) throw new Error(`缺少章节：${CURRENT_HANDOFF_HEADING}`);
    const next = markdown.indexOf(CURRENT_HANDOFF_HEADING, start + CURRENT_HANDOFF_HEADING.length);
    return markdown.slice(start, next < 0 ? markdown.length : next);
}

export function parseCurrentBoard(markdown) {
    const section = sectionBetween(markdown, BOARD_HEADING, BOARD_END_HEADING);
    return section.split(/\r?\n/).map(taskLine).filter(Boolean);
}

export function auditTaskLedger(todoMarkdown, handoffMarkdown) {
    const tasks = parseCurrentBoard(todoMarkdown);
    const currentIds = tasks.map((task) => task.id);
    const currentDuplicates = currentIds.filter((id, index) => currentIds.indexOf(id) !== index);
    const missingFields = tasks
        .filter((task) => FIELD_LABELS.some((label) => !task.fields[label]))
        .map((task) => task.id);
    const allOccurrences = taskOccurrences(todoMarkdown);
    const historicalDuplicates = [...allOccurrences.entries()]
        .filter(([, lines]) => lines.length > 1)
        .map(([id, lines]) => ({ id, lines }));
    const handoffSection = currentHandoff(handoffMarkdown);
    const currentBoardIdSet = new Set(currentIds);
    const staleNextTaskMentions = [...handoffSection.matchAll(/下一(?:主任务|步|步候选)[^\r\n]*/g)]
        .map((match) => match[0])
        .filter((mention) => {
            const ids = [...mention.matchAll(/T-\d+/g)].map((match) => match[0]);
            return ids.length === 0 || ids.some((id) => !currentBoardIdSet.has(id));
        });
    return {
        tasks,
        currentDuplicates: [...new Set(currentDuplicates)],
        missingFields: [...new Set(missingFields)],
        historicalDuplicates,
        staleNextTaskMentions,
        ok: tasks.length > 0 && currentDuplicates.length === 0 && missingFields.length === 0 && staleNextTaskMentions.length === 0,
    };
}

function tableValue(value) {
    return String(value).replaceAll("|", "/");
}

export function renderLedger(audit) {
    const lines = [
        "# 当前任务账本",
        "",
        "> 本页由 `TODO.md` 当前执行板派生；历史需求池和旧交接中的下一任务不产生当前开发承诺。校验命令：`pnpm task:ledger --check`。",
        "",
        "| 任务 | 看板状态 | 代码状态 | 隔离验证 | 真实验收 | 延后/阻塞原因 |",
        "| --- | --- | --- | --- | --- | --- |",
    ];
    for (const task of audit.tasks) {
        lines.push(`| ${task.id} | ${tableValue(task.boardStatus)} | ${tableValue(task.fields["代码状态"])} | ${tableValue(task.fields["隔离验证"])} | ${tableValue(task.fields["真实验收"])} | ${tableValue(task.fields["延后原因"])} |`);
    }
    lines.push(
        "",
        "## 审计结果",
        "",
        `- 当前执行板任务数：${audit.tasks.length}；当前板重复编号：${audit.currentDuplicates.length === 0 ? "无" : audit.currentDuplicates.join(", ")}。`,
        `- 历史重复编号：${audit.historicalDuplicates.length === 0 ? "无" : audit.historicalDuplicates.map((item) => `${item.id}（${item.lines.join(",")}行）`).join("、")}；历史重复只保留来源，不改变当前承诺。`,
        `- 当前交接中的过期下一任务：${audit.staleNextTaskMentions.length === 0 ? "无" : audit.staleNextTaskMentions.join("；")}。`,
        "- `真实验收：不适用` 只允许用于任务治理或开发工具本身；产品行为必须绑定作者、设备、模型或外部文件验收条件。",
        "",
    );
    return lines.join("\n");
}

function writeLedger(audit) {
    const ledgerPath = path.join(REPO, "docs", "TASK-LEDGER.md");
    fs.writeFileSync(ledgerPath, renderLedger(audit), "utf8");
    return ledgerPath;
}

function run(argv) {
    const todoPath = path.join(REPO, "TODO.md");
    const handoffPath = path.join(REPO, "docs", "HANDOFF.md");
    const todo = fs.readFileSync(todoPath, "utf8");
    const handoff = fs.readFileSync(handoffPath, "utf8");
    const audit = auditTaskLedger(todo, handoff);
    if (argv.includes("--write")) writeLedger(audit);
    if (argv.includes("--check")) {
        const ledgerPath = path.join(REPO, "docs", "TASK-LEDGER.md");
        const expected = renderLedger(audit);
        if (!fs.existsSync(ledgerPath) || fs.readFileSync(ledgerPath, "utf8") !== expected) {
            throw new Error("docs/TASK-LEDGER.md 不是当前 TODO 执行板的派生结果，请运行 pnpm task:ledger --write");
        }
        if (!audit.ok) throw new Error(`任务账本校验失败：${JSON.stringify(audit)}`);
    }
    console.log(JSON.stringify({
        ok: audit.ok,
        currentTasks: audit.tasks.map((task) => task.id),
        currentDuplicates: audit.currentDuplicates,
        missingFields: audit.missingFields,
        historicalDuplicateCount: audit.historicalDuplicates.length,
        staleNextTaskMentions: audit.staleNextTaskMentions,
    }, null, 2));
    return audit;
}

export const main = run;

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
    try {
        run(process.argv.slice(2));
    } catch (error) {
        console.error(`TASK LEDGER ERROR: ${error instanceof Error ? error.message : String(error)}`);
        process.exitCode = 2;
    }
}
