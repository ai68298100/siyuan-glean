const fs = require("fs");
let s = fs.readFileSync("src/index.ts", "utf8");

// 1) imports
s = s.replace(
`import { captureClip } from "./services/clip-store";`,
`import { captureClip } from "./services/clip-store";
import { autoEnrich, enrichClip } from "./services/enrich-service";
import { ensurePresetActions } from "./services/ai-actions";`);

// 2) onload：预置 AI 动作（幂等、静默）+ 智能体工具三件
s = s.replace(
`        // 右键菜单"加入读库"（收录入口三件套之一）
        this.eventBus.on("open-menu-content", this.onMenuContent);`,
`        // 右键菜单"加入读库"（收录入口三件套之一）
        this.eventBus.on("open-menu-content", this.onMenuContent);

        // M3：预置 AI 动作（总结/要点/反方观点），静默幂等
        if (this.settings.ai.presetActions) {
            void ensurePresetActions().catch(() => undefined);
        }

        // M3：智能体工具（思源 AI 可发现的读库能力）
        this.registerAgentTools();`);

// 3) 右键/命令收录后自动富化
s = s.replace(
`        const result = await captureClip(this, docId, { src: "manual" });
        showMessage(t(this.i18n, result.captured ? "msg.added" : "msg.alreadyIn"), 3000);
        this.notifyDataChanged();
    }

    private readonly onMenuContent`,
`        const result = await captureClip(this, docId, { src: "manual" });
        showMessage(t(this.i18n, result.captured ? "msg.added" : "msg.alreadyIn"), 3000);
        if (result.captured) autoEnrich(this, docId, this.settings);
        this.notifyDataChanged();
    }

    private readonly onMenuContent`);
s = s.replace(
`            click: async () => {
                const result = await captureClip(this, rootId, { src: "manual" });
                showMessage(t(this.i18n, result.captured ? "msg.added" : "msg.alreadyIn"), 3000);
                this.notifyDataChanged();
            },`,
`            click: async () => {
                const result = await captureClip(this, rootId, { src: "manual" });
                showMessage(t(this.i18n, result.captured ? "msg.added" : "msg.alreadyIn"), 3000);
                if (result.captured) autoEnrich(this, rootId, this.settings);
                this.notifyDataChanged();
            },`);

// 4) 手动富化命令门面方法
s = s.replace(
`    /* ---------- 弹窗 ---------- */`,
`    async enrichCurrentDoc(): Promise<void> {
        const docId = this.currentDocId();
        if (!docId) {
            showMessage(t(this.i18n, "msg.noSelection"), 3000);
            return;
        }
        showMessage(t(this.i18n, "ai.enriching"), 3000);
        const outcome = await enrichClip(this, docId);
        if (outcome.ok) {
            showMessage(
                outcome.duplicates.length > 0
                    ? t(this.i18n, "ai.similarFound", { title: outcome.duplicates[0].title })
                    : t(this.i18n, "ai.enrichDone"),
                3500
            );
        } else {
            showMessage(t(this.i18n, "ai.enrichFailed"), 3000);
        }
        this.notifyDataChanged();
    }

    /* ---------- M3：智能体工具（addAgentCapability，D-0007） ---------- */

    private registerAgentTools(): void {
        const schema = { type: "object", properties: {}, required: [] as string[] };
        this.addAgentCapability({
            name: "list_unread",
            description: "列出小驴拾遗读库中未读完的文章（新剪藏/稍后读/阅读中），返回标题、状态、站点与预计阅读分钟。",
            inputSchema: schema,
            handler: async () => {
                const { reconcileIndex } = await import("./services/clip-store");
                const index = await reconcileIndex(this, this.settings);
                const unread = Object.values(index.clips)
                    .filter((clip) => clip.status === "inbox" || clip.status === "later" || clip.status === "reading")
                    .sort((a, b) => (a.time || "") < (b.time || "") ? 1 : -1);
                return {
                    structuredContent: { count: unread.length, items: unread.slice(0, 50).map((clip) => ({ id: clip.id, title: clip.title, status: clip.status, site: clip.site, minutes: clip.minutes, url: clip.url })) },
                    result: unread.slice(0, 50).map((clip) => `[${clip.status}] ${clip.title}（${clip.site || "未知来源"}，约 ${clip.minutes || "?"} 分钟）`).join("\n") || "读库中没有未读文章",
                };
            },
        });
        this.addAgentCapability({
            name: "archive_stale",
            description: `把读库中超过 ${this.settings.staleDays} 天未读的新剪藏/稍后读文章标记为归档候选并归档。`,
            inputSchema: schema,
            handler: async () => {
                const { reconcileIndex, batchSetStatus } = await import("./services/clip-store");
                const index = await reconcileIndex(this, this.settings);
                const cutoff = Date.now() - this.settings.staleDays * 86_400_000;
                const stale = Object.values(index.clips).filter((clip) => {
                    if (clip.status !== "inbox" && clip.status !== "later") return false;
                    if (!/^\d{14}$/.test(clip.time)) return false;
                    const t = new Date(Number(clip.time.slice(0, 4)), Number(clip.time.slice(4, 6)) - 1, Number(clip.time.slice(6, 8))).getTime();
                    return t < cutoff;
                });
                await batchSetStatus(this, stale.map((clip) => clip.id), "archived");
                return { structuredContent: { archived: stale.length }, result: `已归档 ${stale.length} 篇超龄文章` };
            },
        });
        this.addAgentCapability({
            name: "weekly_digest",
            description: "生成读库本周摘要：新增收录、完成阅读、未读压力与标签分布。",
            inputSchema: schema,
            handler: async () => {
                const { reconcileIndex } = await import("./services/clip-store");
                const { buildStats } = await import("./services/stats-service");
                const index = await reconcileIndex(this, this.settings);
                const stats = buildStats(index);
                const lines = [
                    `读库共 ${stats.total} 篇，已读 ${stats.done} 篇（${stats.total > 0 ? Math.round((stats.done / stats.total) * 100) : 0}%）。`,
                    `本周新增收录 ${stats.dailyCaptured.reduce((a, b) => a + b, 0)} 篇，完成 ${stats.doneThisWeek} 篇。`,
                    `未读压力：新剪藏 ${stats.inbox} 篇、阅读中 ${stats.reading} 篇。`,
                    stats.byTag.length > 0 ? `近期主题：${stats.byTag.slice(0, 5).map((tag) => tag.name + "×" + tag.count).join("、")}` : "",
                ];
                return { structuredContent: { stats }, result: lines.filter(Boolean).join("\n") };
            },
        });
    }

    /* ---------- 弹窗 ---------- */`);

fs.writeFileSync("src/index.ts", s);
console.log("index.ts wired for M3");
