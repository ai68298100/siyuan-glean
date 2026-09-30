import fs from "node:fs";

function patch(path, pairs) {
    let text = fs.readFileSync(path, "utf8");
    for (const [old, next] of pairs) {
        if (!text.includes(old)) throw new Error("missing anchor in " + path + ": " + old.slice(0, 50));
        text = text.replace(old, next);
    }
    fs.writeFileSync(path, text);
}

const zh = "public/i18n/zh_CN.json";
const en = "public/i18n/en_US.json";

/* #3 术语：inbox → 待分拣（与"待确认候选"区分；"重新剪藏"等无关词不动） */
patch(zh, [
    ['  "queue.inbox": "新剪藏",', '  "queue.inbox": "待分拣",'],
    ['  "status.inbox": "新剪藏",', '  "status.inbox": "待分拣",'],
    ['  "settings.inboxQuota": "新剪藏提醒上限",', '  "settings.inboxQuota": "待分拣提醒上限",'],
    ['  "panel.quotaOver": "新剪藏 ${total} 篇，超过了提醒上限 ${quota}——建议先清一清",',
     '  "panel.quotaOver": "待分拣 ${total} 篇，超过了提醒上限 ${quota}——建议先清一清",'],
    ['  "reading.backToLibrary": "返回读库中的这篇",', '  "reading.backToLibrary": "返回读库",'],
]);
patch(en, [
    ['  "queue.inbox": "New",', '  "queue.inbox": "To sort",'],
    ['  "status.inbox": "New",', '  "status.inbox": "To sort",'],
]);

/* 新键：AI 通道进阶组 / 引导导入链接 / 拾遗继续阅读 */
patch(zh,
    '  "settings.aiGroup":',
    `  "settings.aiChannelGroup": "AI 通道 · 进阶",
  "settings.aiGroup":`);
patch(zh,
    '  "resurface.noAnchor"',
    `  "resurface.continueReading": "继续阅读",
  "resurface.noAnchor"`);
patch(zh,
    '  "onboarding.ctaConfirm"',
    `  "onboarding.importLink": "有 Pocket / Omnivore 存量？用导入器搬进来",
  "onboarding.ctaConfirm"`);

const enText = fs.readFileSync(en, "utf8");
const enAi = enText.match(/ {2}"settings\.aiGroup": "[^"]*",/)[0];
patch(en, enAi, enAi + "\n" + `  "settings.aiChannelGroup": "AI channel · advanced",`);
const enRel = fs.readFileSync(en, "utf8").match(/ {2}"resurface\.noAnchor": "[^"]*",/)[0];
patch(en, enRel, `  "resurface.continueReading": "Continue reading",\n` + enRel);
const enText2 = fs.readFileSync(en, "utf8");
const enCta = enText2.match(/ {2}"onboarding\.ctaConfirm": "[^"]*",/)[0];
patch(en, enCta, `  "onboarding.importLink": "Have Pocket / Omnivore archives? Bring them in with the importer",\n` + enCta);

/* #9 阅读条按钮收窄（en 同步缩写） */
patch(en, ['  "reading.backToLibrary": "Back to this article in the library",', '  "reading.backToLibrary": "Back to library",']);

console.log("i18n ok");
