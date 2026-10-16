import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { transpileModule } from "typescript";

const root = resolve(import.meta.dirname, "..");
const read = (file: string) => readFileSync(resolve(root, file), "utf8");

test("onboarding exposes dialog naming, progress, selection and async states", () => {
    const source = read("src/ui/OnboardingDialog.svelte");
    assert.match(source, /const instanceId = \$props\.id\(\);/);
    assert.match(source, /aria-labelledby=\{titleId\}/);
    assert.match(source, /aria-busy=\{scanning\}/);
    assert.match(source, /<h2 id=\{titleId\}/);
    assert.match(source, /role="group" aria-labelledby=\{anchorTitleId\}/);
    assert.match(source, /aria-live="polite"/);
    assert.match(source, /aria-pressed=\{anchorNotebooks\.includes\(notebook\.id\)\}/);
    assert.match(source, /role="alert"/);
});

test("settings exposes names for groups, controls and save state", () => {
    const source = read("src/ui/SettingsView.svelte");
    assert.match(source, /const instanceId = \$props\.id\(\);/);
    assert.match(source, /aria-labelledby=\{titleId\}/);
    assert.match(source, /aria-busy=\{saveBusy\}/);
    assert.match(source, /aria-pressed=\{anchorNotebooks\.includes\(notebook\.id\)\}/);
    assert.match(source, /role="group" aria-label=\{t\(i18n, "settings\.aiEnrichMode"\)\}/);
    assert.match(source, /role="group" aria-label=\{t\(i18n, "settings\.aiChannel"\)\}/);
    assert.match(source, /role="group" aria-label=\{t\(i18n, "settings\.readerMode"\)\}/);
    assert.match(source, /aria-label=\{t\(i18n, "settings\.aiDailyCap"\)\}/);
    assert.match(source, /aria-label=\{t\(i18n, "settings\.checkinItem"\)\}/);
    assert.match(source, /role="tabpanel"[\s\S]*?inert=\{saveBusy\}/);
    assert.match(source, /customBaseUrlInsecure/);
    assert.match(source, /notebookLoadFailed/);
    assert.match(source, /checkinLoadFailed/);
    assert.match(source, /aiLogLoadFailed/);
    assert.match(source, /aria-busy=\{checkinLoading\}/);
    assert.match(source, /aria-busy=\{aiLogLoading\}/);
});

test("settings category navigation exposes tab semantics and the notebook filter is named (T-3314)", () => {
    const source = read("src/ui/SettingsView.svelte");
    assert.match(source, /role="tablist"/);
    assert.match(source, /role="tab"/);
    assert.match(source, /aria-selected=\{activeSection === section\.id\}/);
    assert.match(source, /role="tabpanel"/);
    assert.match(source, /aria-controls=\{panelId\}/);
    assert.match(source, /aria-label=\{t\(i18n, "settings\.anchorSearch"\)\}/);
    assert.ok(source.includes(`{t(i18n, "settings.anchorSelected", { n: anchorNotebooks.length, total: notebooks.length })}`));
    // 双语键集合：导航、分类描述与筛选文案必须两边都存在
    for (const file of ["public/i18n/zh_CN.json", "public/i18n/en_US.json"]) {
        const i18n = JSON.parse(readFileSync(new URL(`../${file}`, import.meta.url), "utf8"));
        for (const key of [
            "settings.navLabel", "settings.nav.workspace", "settings.nav.resurface", "settings.nav.reading", "settings.nav.ai",
            "settings.nav.aiChannel", "settings.nav.integration", "settings.nav.data", "settings.nav.maintenance",
            "settings.desc.workspace", "settings.desc.resurface", "settings.desc.reading", "settings.desc.ai",
            "settings.desc.aiChannel", "settings.desc.integration", "settings.desc.data", "settings.desc.maintenance",
            "settings.anchorSearch", "settings.anchorSelected", "settings.anchorClear", "settings.anchorNoMatch",
        ]) assert.ok(typeof i18n[key] === "string" && i18n[key].length > 0, `${file} 缺少 ${key}`);
    }
});

test("settings tabs use one keyboard stop and close requires resolving unsaved drafts", () => {
    const settings = read("src/ui/SettingsView.svelte");
    const dialog = read("src/libs/dialog.ts");
    assert.match(settings, /tabindex=\{activeSection === section\.id \? 0 : -1\}/);
    assert.match(settings, /registerCloseGuard\?\.\(canCloseSettings\)/);
    assert.match(settings, /function canCloseSettings\(\): boolean[\s\S]*?if \(saveBusy\) return false;[\s\S]*?if \(draftDirty\)[\s\S]*?confirmDiscardOpen = true/);
    assert.match(settings, /if \(confirmDiscardOpen\) return false;[\s\S]*if \(draftDirty\)/);
    assert.match(settings, /settings\.discardConfirmTitle/);
    assert.match(settings, /settings\.discardAndClose/);
    assert.match(settings, /function discardAndClose\(\): void[\s\S]*?loadDraft\(originalSettings\)[\s\S]*?onClose\?\.\(\)/);
    assert.match(settings, /function cancel\(\)\s*\{\s*if \(!canCloseSettings\(\)\) return;[\s\S]*?loadDraft\(originalSettings\)[\s\S]*?onClose\?\.\(\)/);
    assert.match(settings, /saveBusy = false;\s*onClose\?\.\(\);/);
    assert.match(dialog, /args\.canClose\?\.\(\) === false/);
    assert.match(dialog, /closeGuard\?\.\(\) \?\? true/);
    assert.match(dialog, /stopImmediatePropagation\(\);/);
});

test("settings validation activates the field's category before rendering and focusing it", async () => {
    const source = read("src/ui/SettingsView.svelte");
    const sectionStart = source.indexOf("function selectSection(");
    const sectionEnd = source.indexOf("/** ARIA tabs", sectionStart);
    const validationStart = source.indexOf("function validateDraft(");
    const validationEnd = source.indexOf("function buildDraftSettings(", validationStart);
    const saveStart = source.indexOf("async function save()");
    const saveEnd = source.indexOf("async function dismissNewbieHint", saveStart);
    assert.ok(sectionStart >= 0 && sectionEnd > sectionStart && validationStart >= 0 && validationEnd > validationStart && saveStart >= 0 && saveEnd > saveStart);
    const functions = transpileModule([
        source.slice(sectionStart, sectionEnd),
        source.slice(validationStart, validationEnd),
        source.slice(saveStart, saveEnd),
    ].join("\n"), {}).outputText;
    const cases = [
        { field: "aiDailyCap", section: "ai", patch: { aiDailyCap: 501 } },
        { field: "dailyCount", section: "resurface", patch: { dailyCount: 0 } },
        { field: "inboxQuota", section: "resurface", patch: { inboxQuota: 4 } },
        { field: "staleDays", section: "resurface", patch: { staleDays: Number.NaN } },
        { field: "customBaseUrl", section: "aiChannel", patch: { aiChannel: "custom", customBaseUrl: "" } },
        { field: "customModel", section: "aiChannel", patch: { aiChannel: "custom", customModel: " " } },
        { field: "customSecretName", section: "aiChannel", patch: { aiChannel: "custom", customSecretName: " " } },
    ];
    for (const scenario of cases) {
        let renderedSection = "workspace";
        let focused = false;
        const state = {
            activeSection: "workspace", dataVisited: false, maintenanceVisited: false,
            saveBusy: false, validationField: "", validationError: "",
            aiDailyCap: 10, dailyCount: 3, inboxQuota: 50, staleDays: 90,
            aiChannel: "siyuan", customBaseUrl: "https://example.test/v1", customModel: "model", customSecretName: "secret",
            i18n: {}, t: (_: unknown, key: string) => key,
            tick: async () => {
                assert.equal(state.activeSection, scenario.section, "分类必须先切换，再等待字段挂载");
                assert.equal(focused, false);
                renderedSection = state.activeSection;
            },
            settingsRoot: {
                querySelector(selector: string) {
                    assert.equal(selector, '[aria-invalid="true"]');
                    assert.equal(renderedSection, scenario.section, "隐藏分类的字段尚未挂载，不能提前聚焦");
                    assert.equal(state.validationField, scenario.field);
                    return { focus: () => { focused = true; } };
                },
            },
            facade: { updateSettings: () => assert.fail("校验失败不应保存设置") },
            ...scenario.patch,
        };
        const save = runInNewContext(`${functions}; save`, state);
        await save();
        assert.equal(focused, true, scenario.field);
        assert.ok(state.validationError.length > 0);
        assert.equal(state.saveBusy, false);
    }
});

test("settings clears only resolved validation without saving, navigating or replacing the draft", async () => {
    const source = read("src/ui/SettingsView.svelte");
    const sectionStart = source.indexOf("function selectSection(");
    const validationStart = source.indexOf("function clearResolvedValidation(");
    assert.ok(validationStart >= 0);
    const functions = transpileModule([
        source.slice(sectionStart, source.indexOf("/** ARIA tabs", sectionStart)),
        source.slice(validationStart, source.indexOf("function buildDraftSettings(", validationStart)),
        source.slice(source.indexOf("async function save()"), source.indexOf("async function dismissNewbieHint")),
    ].join("\n"), {}).outputText;
    let refreshValidation: () => void = () => assert.fail("校验清理必须接入草稿响应更新");
    const focused: string[] = [];
    const state = {
        activeSection: "workspace", dataVisited: false, maintenanceVisited: false,
        saveBusy: false, validationField: "", validationError: "",
        aiDailyCap: 10, dailyCount: 0, inboxQuota: 50, staleDays: 90,
        aiChannel: "siyuan", customBaseUrl: "https://example.test/v1", customModel: "model", customSecretName: "secret",
        readerMode: "edit", i18n: {}, t: (_: unknown, key: string) => key,
        $effect: (effect: () => void) => { refreshValidation = effect; },
        tick: async () => {},
        settingsRoot: { querySelector: () => ({ focus: () => focused.push(state.validationField) }) },
        facade: { updateSettings: () => assert.fail("纠正字段不能自动保存设置") },
    };
    const save = runInNewContext(`${functions}; save`, state);
    await save();
    assert.equal(state.validationField, "dailyCount");
    const originalError = state.validationError;
    refreshValidation();
    state.dailyCount = -1;
    refreshValidation();
    assert.equal(state.validationError, originalError, "字段仍无效时必须保留错误提示");

    state.aiDailyCap = 501;
    refreshValidation();
    assert.equal(state.validationField, "dailyCount", "其他字段变成更早的错误也不能清除仍无效的当前字段");
    state.activeSection = "reading";
    state.dailyCount = 3;
    refreshValidation();
    assert.equal(state.validationField, "", "纠正后同步清除 aria-invalid 的来源");
    assert.equal(state.validationError, "");
    assert.equal(state.activeSection, "reading", "清理提示不能跳分类");
    assert.equal(state.dailyCount, 3);
    assert.equal(state.aiDailyCap, 501, "保留其他未保存草稿");
    assert.equal(state.readerMode, "edit");
    assert.deepEqual(focused, ["dailyCount"], "纠正字段不能移动焦点");

    await save();
    assert.equal(state.validationField, "aiDailyCap", "下一次保存再定位其他字段错误");
    assert.equal(state.activeSection, "ai");
    assert.deepEqual(focused, ["dailyCount", "aiDailyCap"]);

    state.aiDailyCap = 10;
    refreshValidation();
    state.aiChannel = "custom";
    state.customModel = " ";
    await save();
    assert.equal(state.validationField, "customModel");
    state.customModel = "replacement-model";
    refreshValidation();
    assert.equal(state.validationField, "");
    assert.equal(state.validationError, "");
    assert.equal(state.customModel, "replacement-model");

    state.customSecretName = " ";
    await save();
    assert.equal(state.validationField, "customSecretName");
    state.aiChannel = "siyuan";
    refreshValidation();
    assert.equal(state.validationField, "", "切离自定义通道后不保留已不适用的错误");
    assert.equal(state.validationError, "");
    assert.equal(state.customSecretName, " ", "隐藏自定义通道不能改写其草稿");
});

test("migration checkpoints expose loading, retry, and distinct empty-filter feedback", () => {
    const migrate = read("src/ui/MigrateDialog.svelte");
    assert.match(migrate, /progressLoadState = \$state<"loading" \| "ready" \| "error" \| "invalid">\("loading"\)/);
    assert.match(migrate, /migrate\.progressLoadFailed/);
    assert.match(migrate, /migrate\.progressInvalid/);
    assert.match(migrate, /migrate\.clearCorruptProgress/);
    assert.match(migrate, /discardingCorruptProgress/);
    assert.match(migrate, /onclick=\{\(\) => void reloadResumeProgress\(\)\}/);
    assert.match(migrate, /disabled=\{progressLoadState !== "ready" \|\| Boolean\(progressActionError\)\} onclick=\{\(\) => void startScan\(\)\}/);
    assert.match(migrate, /migrate\.filterNoResults/);
    assert.doesNotMatch(migrate, /window\.confirm/);
    assert.match(migrate, /role="group" aria-busy=\{discardBusy\} aria-labelledby=/);
});

test("archive permanent deletion confirms themed document details before the irreversible action", () => {
    const archive = read("src/ui/ArchiveDialog.svelte");
    assert.doesNotMatch(archive, /window\.confirm/);
    assert.match(archive, /role="group" aria-busy=\{pending\} aria-labelledby=/);
    assert.match(archive, /archive\.purgeDocTitle/);
    assert.match(archive, /archive\.purgeDocPath/);
    assert.match(archive, /archive\.purgeDocSource/);
    assert.match(archive, /onclick=\{\(\) => void confirmPurge\(\)\}/);
    assert.match(archive, /glean-btn--danger/);
});

test("stats uses per-instance section names and readable daily heatmap labels", () => {
    const source = read("src/ui/StatsView.svelte");
    assert.match(source, /const instanceId = \$props\.id\(\);/);
    assert.match(source, /const idFor = \(part: string\) => `\$\{idPrefix\}-\$\{part\}`;/);
    assert.match(source, /aria-labelledby=\{idFor\("activity-title"\)\}/);
    assert.match(source, /role="group" aria-label=\{t\(i18n, "review\.heatmap"/);
    assert.match(source, /class="glean-stats__day" role="img" aria-label=\{t\(i18n, "review\.heatmapDay", \{ date: day\.date, n: day\.count \}\)\}/);
    assert.match(source, /i18n, "review\.heatmapDay"/);
    assert.doesNotMatch(source, /id="glean-stats-(?:overview|activity|breakdown|completed)-title"/);
});

test("highlight selection controls and exports form separate named action groups", () => {
    const source = read("src/ui/HighlightView.svelte");
    const styles = read("src/index.scss");
    assert.match(source, /const titleId = `glean-highlights-title-\$\{instanceId\}`;/);
    assert.match(source, /aria-labelledby=\{titleId\}/);
    assert.match(source, /aria-pressed=\{direction === "asc"\}/);
    assert.match(source, /library\.directionAscending/);
    assert.doesNotMatch(source, /glean-highlights__tools glean-highlights__tools--selection" role=/);
    assert.match(source, /class="glean-highlights__selection-actions" role="group"/);
    assert.match(source, /class="glean-highlights__export-actions" role="group"/);
    assert.match(source, /glean-highlights__preview-action/);
    assert.match(source, /item\.text\.slice\(0, 120\)/);
    assert.match(source, /\(visible\.page - 1\) \* highlightPageSize/);
    assert.match(styles, /@media \(max-width: 560px\)[\s\S]*\.glean-highlights__selection-actions,[\s\S]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
});

test("reader controls and sections use per-instance ids", () => {
    const source = read("src/ui/ReaderTab.svelte");
    assert.match(source, /const instanceId = \$props\.id\(\);/);
    assert.match(source, /const idFor = \(part: string\) => `glean-reader-\$\{instanceId\}-\$\{part\}`;/);
    assert.match(source, /aria-controls=\{sidebarId\}/);
    assert.match(source, /aria-controls=\{appearancePanelId\}/);
    assert.match(source, /bind:open=\{appearanceOpen\}/);
    assert.match(source, /reader\.companionTitle/);
    assert.match(source, /aria-controls=\{shortcutsId\}/);
    assert.match(source, /id=\{speechRateId\}/);
    assert.match(source, /<label for=\{speechRateId\}/);
    assert.doesNotMatch(source, /id="glean-reader-(?:sidebar|shortcuts|sidebar-title|recent-title|appearance-title|outline-title|excerpt-title|speech-title|ai-title|rank-title)"/);
    assert.doesNotMatch(source, /id="glean-speech-rate"/);
});

test("reading context labels are unique per mounted instance", () => {
    const source = read("src/ui/ReadingContext.svelte");
    assert.match(source, /const instanceId = \$props\.id\(\);/);
    assert.match(source, /const titleId = `glean-reading-context-title-\$\{instanceId\}`;/);
    assert.match(source, /aria-labelledby=\{titleId\}/);
    assert.match(source, /<div id=\{titleId\}/);
    assert.doesNotMatch(source, /aria-labelledby="glean-reading-context-title"/);
    assert.doesNotMatch(source, /id="glean-reading-context-title"/);
});

test("Dock 搜索打开后自动聚焦，并提供清空、关闭和 Esc 返回焦点", () => {
    const source = read("src/ui/DockPanel.svelte");
    assert.match(source, /bind:this=\{searchInput\}/);
    assert.match(source, /bind:this=\{searchToggle\}/);
    assert.match(source, /searchInput\?\.focus\(\)/);
    assert.match(source, /searchToggle\?\.focus\(\)/);
    assert.match(source, /event\.key === "Escape"\) closeSearch\(\)/);
    assert.match(source, /class="glean-search__clear"/);
    assert.match(source, /aria-label=\{t\(i18n, "panel\.searchClear"\)\}/);
    assert.match(source, /aria-label=\{t\(i18n, "panel\.searchClose"\)\}/);
});

test("mobile onboarding entry remains guarded by frontend detection", () => {
    const source = read("src/index.ts");
    assert.match(source, /const frontend = getFrontend\(\);/);
    assert.match(source, /this\.isMobile = frontend === "mobile" \|\| frontend === "browser-mobile";/);
    assert.match(source, /if \(!this\.isMobile\) \{/);
    assert.match(source, /if \(this\.isMobile\) return;/);
});

test("新用户可从空库、今日拾遗和设置页重新打开引导，忙碌时锁住向导动作", () => {
    const dock = read("src/ui/DockPanel.svelte");
    const resurface = read("src/ui/ResurfaceView.svelte");
    const settings = read("src/ui/SettingsView.svelte");
    const onboarding = read("src/ui/OnboardingDialog.svelte");
    assert.ok((dock.match(/facade\.openOnboarding\(\)/g) ?? []).length >= 2, "读库无锚点和空库状态均可打开引导");
    assert.match(resurface, /facade\.openOnboarding\(\)/);
    assert.match(settings, /facade\.openOnboarding\(\)/);
    assert.match(onboarding, /disabled=\{actionBusy \|\| scanning\}/);
    assert.match(onboarding, /if \(disposed \|\| completed \|\| scanning \|\| actionBusy\) return;/);
    for (const file of ["public/i18n/zh_CN.json", "public/i18n/en_US.json"]) {
        const i18n = JSON.parse(readFileSync(resolve(root, file), "utf8"));
        assert.ok(i18n["panel.openOnboarding"]);
        assert.ok(i18n["settings.openOnboarding"]);
    }
});

test("responsive and visually-hidden UI contracts remain present", () => {
    const source = read("src/index.scss");
    assert.match(source, /@media \(max-width: 560px\)/);
    assert.match(source, /\.glean-sr-only\s*\{/);
    assert.match(source, /\.glean-settings__footer\s*\{/);
    assert.match(source, /\.glean-settings__wide-input\s*\{/);
});

test("shared dialogs expose modal semantics and return focus after closing", () => {
    const dialog = read("src/libs/dialog.ts");
    const modalFocus = read("src/libs/modal-focus.ts");
    assert.match(dialog, /setAttribute\("role", "dialog"\)/);
    assert.match(dialog, /setAttribute\("aria-modal", "true"\)/);
    assert.match(dialog, /setAttribute\("aria-label", args\.title\)/);
    assert.match(dialog, /installModalFocus\(modalRoot/);
    assert.match(modalFocus, /event\.key === "Escape"/);
    assert.match(modalFocus, /event\.key !== "Tab"/);
    assert.match(modalFocus, /addEventListener\("focusin"/);
    assert.match(modalFocus, /previousFocus && available\(previousFocus\)/);
    assert.match(modalFocus, /focusableElements\(root\)\[0\]/);
});

test("import and migration dialogs provide unique headings and accessible progress values", () => {
    const importDialog = read("src/ui/ImportDialog.svelte");
    const migrateDialog = read("src/ui/MigrateDialog.svelte");
    assert.match(importDialog, /const instanceId = \$props\.id\(\);/);
    assert.match(importDialog, /aria-labelledby=\{titleId\}/);
    assert.match(importDialog, /<h2 id=\{titleId\}/);
    assert.match(importDialog, /role="group" aria-label=\{t\(i18n, "import\.importing"\)\}/);
    assert.match(importDialog, /role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow=\{progress\}/);
    assert.match(migrateDialog, /const instanceId = \$props\.id\(\);/);
    assert.match(migrateDialog, /aria-labelledby=\{titleId\}/);
    assert.match(migrateDialog, /<h2 id=\{titleId\}/);
    assert.match(migrateDialog, /role="group" aria-label=\{t\(i18n, "migrate\.writing"\)\}/);
    assert.match(migrateDialog, /role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow=\{progressPct\}/);
    assert.match(importDialog, /import.retryFailed[\s\S]*!targetAvailable/);
    const restoreDialog = read("src/ui/RestoreDialog.svelte");
    assert.match(restoreDialog, /aria-busy=\{pending \|\| contextLoading\}/);
    assert.match(restoreDialog, /contextError[\s\S]*action\.retry/);
    assert.match(restoreDialog, /actionError[\s\S]*action\.retry/);
});

test("icon-only actions expose labels independent of hover tooltips", () => {
    const dock = read("src/ui/DockPanel.svelte");
    const resurface = read("src/ui/ResurfaceView.svelte");
    const readingContext = read("src/ui/ReadingContext.svelte");
    assert.match(dock, /class="glean-icon-btn glean-head-action" title=\{t\(i18n, "panel\.popup"\)\} aria-label=\{t\(i18n, "panel\.popup"\)\}/);
    assert.match(dock, /title=\{snapshotLabel\(entry\)\}\s*aria-label=\{snapshotLabel\(entry\)\}/);
    assert.match(dock, /title=\{t\(i18n, "candidate\.fixUrl"\)\} aria-label=\{t\(i18n, "candidate\.fixUrl"\)\}/);
    assert.match(resurface, /title=\{t\(i18n, "action\.refresh"\)\} aria-label=\{t\(i18n, "action\.refresh"\)\}/);
    assert.match(readingContext, /title=\{t\(i18n, "clip\.bodyCheckHint"\)\}\s*aria-label=\{t\(i18n, "clip\.bodyCheckHint"\)\}/);
});

test("library card actions use native title buttons without nested button roles", () => {
    const dock = read("src/ui/DockPanel.svelte");
    assert.doesNotMatch(dock, /role="button"/);
    assert.match(dock, /draggable="true"\s+role="group"\s+aria-label=\{entry\.title/);
    for (const className of ["glean-kcard__t", "glean-drow__ti", "glean-card__title"]) {
        assert.match(dock, new RegExp(`<button type="button" class="${className}" aria-label=`));
    }
    assert.match(dock, /if \(failed\.length\) staleSelected = new Set\(failed\)/);
    assert.match(dock, /panel\.staleArchivePartial/);
    assert.match(dock, /aria-busy=\{archivingStale\}/);
    assert.match(dock, /aria-busy=\{loading\} disabled=\{loading\} onclick=\{\(\) => \{ closeMobileMore\(\); void reload\(\); \}\}/);
});

test("preview and today's gleaning keep the full state path and actionable candidate empty state", () => {
    const preview = read("src/ui/WorkbenchPreview.svelte");
    const resurface = read("src/ui/ResurfaceView.svelte");
    assert.match(preview, /const statuses: ClipStatus\[\] = \["inbox", "later", "reading", "done", "archived"\]/);
    assert.match(resurface, /candidateCount = \$derived\(Object\.keys\(index\.candidates\)\.length\)/);
    assert.match(resurface, /panel\.candidatesDetected/);
    assert.match(resurface, /panel\.viewCandidates/);
    assert.match(resurface, /disabled=\{Boolean\(actingId \|\| undoingId\)\}/);
});

test("successful library mutations broadcast cross-view refreshes", () => {
    const dock = read("src/ui/DockPanel.svelte");
    const resurface = read("src/ui/ResurfaceView.svelte");
    const inbox = read("src/ui/InboxSection.svelte");
    const migrate = read("src/ui/MigrateDialog.svelte");
    assert.match(dock, /if \(ok === 1\) facade\.notifyDataChanged\(\);/);
    assert.match(dock, /if \(result\.ok > 0\) facade\.notifyDataChanged\(\);/);
    assert.match(dock, /await setSurfacePinned\([\s\S]*?facade\.notifyDataChanged\(\);/);
    assert.match(dock, /await snapshotClip\([\s\S]*?facade\.notifyDataChanged\(\);/);
    assert.match(resurface, /await actOnSurface\([\s\S]*?facade\.notifyDataChanged\(\);/);
    assert.match(resurface, /await undoSurfaceAction\([\s\S]*?facade\.notifyDataChanged\(\);/);
    assert.match(inbox, /if \(result\.cloudRemoved\) \{[\s\S]*?facade\.notifyDataChanged\(\);/);
    assert.match(migrate, /if \(last\.updatedRows\.length > 0\) notifyAfterRun = true/);
    assert.match(migrate, /expectedTaskId \? \{ expectedTaskId \} : \{\}/);
    assert.match(migrate, /onclick=\{\(\) => void reloadResumeProgress\(\)\}.*action\.retry/s);
});

test("migration batches update local rows without rehydrating the full checkpoint each batch", () => {
    const migrate = read("src/ui/MigrateDialog.svelte");
    const batchLoop = /while \(true\) \{([\s\S]*?)\n        \}/.exec(migrate)?.[1];
    assert.ok(batchLoop);
    assert.match(batchLoop, /runBackfillBatch/);
    assert.match(batchLoop, /updatedRows/);
    assert.doesNotMatch(batchLoop, /refreshProgress/);
    assert.match(migrate, /await refreshProgress\(\);\s*phase = last\?\.finished/);
});

test("stale migration windows must explicitly reload before binding a replacement task", () => {
    const migrate = read("src/ui/MigrateDialog.svelte");
    const resume = /async function resume\(\) \{([\s\S]*?)\n\}/.exec(migrate)?.[1];
    assert.ok(resume);
    assert.match(resume, /const expectedTaskId = activeTaskId/);
    assert.match(resume, /refresh: true, \s*\.\.\.\(expectedTaskId \? \{ expectedTaskId \} : \{\}\)/);
    assert.match(migrate, /if \(phase !== "intro" \|\| progressLoadState !== "ready" \|\| progressActionError\) return/);
    assert.match(migrate, /\{#if progressActionError\}[\s\S]*reloadResumeProgress/);
});

test("migration row decisions lock while a write is in flight", () => {
    const migrate = read("src/ui/MigrateDialog.svelte");
    assert.match(migrate, /let rowBusyId = \$state\(""\)/);
    assert.match(migrate, /if \(rowBusyId\) return;\s*rowBusyId = row\.id/);
    assert.match(migrate, /finally \{\s*rowBusyId = "";\s*\}/);
    assert.match(migrate, /disabled=\{Boolean\(rowBusyId\)\}[^>]*title=\{t\(i18n, "migrate\.fixUrl"\)/);
    assert.match(migrate, /disabled=\{Boolean\(rowBusyId\)\}[^>]*onclick=\{\(\) => void startScan\(\)\}/);
});

test("status semantics and accessibility modes do not rely on color or motion alone", () => {
    const styles = read("src/index.scss");
    assert.match(styles, /\.glean-st-badge\s*\{[\s\S]*&::before/);
    assert.match(styles, /glean-st-badge--inbox[\s\S]*content:\s*"✦"/);
    assert.match(styles, /glean-st-badge--done[\s\S]*content:\s*"✓"/);
    assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/);
    assert.match(styles, /@media \(prefers-contrast: more\)/);
    assert.match(styles, /@media \(forced-colors: active\)/);
    assert.match(styles, /:focus-visible[\s\S]*outline:\s*2px solid var\(--b3-theme-primary\)/);
    assert.match(styles, /forced-colors: active[\s\S]*outline-color:\s*Highlight/);
});

test("reading status actions surface write failures and always release busy state", () => {
    const reader = read("src/ui/ReaderTab.svelte");
    const context = read("src/ui/ReadingContext.svelte");
    assert.match(reader, /阅读状态变更失败/);
    assert.match(reader, /showMessage\(t\(i18n, "msg\.statusFailed"\), 3000\)/);
    assert.match(context, /阅读上下文状态变更失败/);
    assert.match(context, /showMessage\(t\(i18n, "msg\.statusFailed"\), 3000\)/);
});

test("migration progress reads have visible failure feedback", () => {
    const source = read("src/ui/MigrateDialog.svelte");
    assert.match(source, /迁移进度读取失败/);
    assert.match(source, /迁移进度刷新失败/);
    assert.match(source, /迁移恢复失败/);
    assert.match(source, /迁移批次设置保存失败/);
    assert.match(source, /msg\.actionFailed/);
});

test("onboarding async actions expose visible failure feedback", () => {
    const source = read("src/ui/OnboardingDialog.svelte");
    assert.match(source, /引导进度读取失败/);
    assert.match(source, /引导笔记本读取失败/);
    assert.match(source, /引导设置保存失败/);
    assert.match(source, /引导完成失败/);
    assert.match(source, /跳过引导失败/);
    assert.match(source, /role="alert"/);
    assert.match(source, /msg\.actionFailed/);
});

test("reading review save exposes unexpected failures", () => {
    const source = read("src/ui/StatsView.svelte");
    assert.match(source, /阅读回顾保存失败/);
    assert.match(source, /msg\.actionFailed/);
});

test("workbench preference reads expose retry feedback", () => {
    const source = read("src/ui/DockPanel.svelte");
    assert.match(source, /工作台偏好读取失败/);
    assert.match(source, /prefsError/);
    assert.match(source, /msg\.actionFailed/);
    assert.match(source, /restorePreferences/);
});
