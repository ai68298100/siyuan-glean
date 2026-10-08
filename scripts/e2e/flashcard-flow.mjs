import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

export async function runFlashcardFlow({ client, plugin, until, pass, workspace }) {
    const cards = await import("../../src/services/flashcard-service.ts");
    const clipStore = await import("../../src/services/clip-store.ts");
    const { normalizeSettings } = await import("../../src/services/settings.ts");
    const evidenceDir = path.join(workspace, "flashcard-flow");
    fs.mkdirSync(evidenceDir, { recursive: true });
    const calls = [];
    const storageWrites = [];
    const monitoredPlugin = {
        ...plugin,
        async saveData(name, value) {
            storageWrites.push({ name });
            await plugin.saveData(name, value);
        },
    };
    const transport = globalThis.__gleanS1FetchSyncPost;
    assert.equal(typeof transport, "function");
    let loseNextReply;
    globalThis.__gleanS1FetchSyncPost = async (route, body) => {
        const call = { route, body: structuredClone(body) };
        calls.push(call);
        if (route.startsWith("/api/ai/")) throw new Error("制卡隔离 E2E 禁止真实 AI 调用");
        const result = await transport(route, body);
        if (loseNextReply === route && result.code === 0) {
            loseNextReply = undefined;
            call.actualKernelAccepted = true;
            call.replyDiscarded = true;
            throw new Error("隔离测试：内核已接受请求，客户端丢失响应");
        }
        return result;
    };
    const evidence = {
        workspace: path.resolve(workspace), startedAt: new Date().toISOString(), completed: false,
        scenarios: [], calls, storageWrites,
    };
    const writeEvidence = () => fs.writeFileSync(path.join(evidenceDir, "flashcard-evidence.json"), `${JSON.stringify(evidence, null, 2)}\n`);
    const record = (label, details = {}) => {
        evidence.scenarios.push({ label, ...details });
        writeEvidence();
        pass(label);
    };
    const inserts = (offset) => calls.slice(offset).filter((call) => call.route === "/api/block/insertBlock");
    const registrations = (offset) => calls.slice(offset).filter((call) => call.route === "/api/riff/addRiffCards");
    const mutations = (offset) => calls.slice(offset).filter((call) => /\/(?:insertBlock|setBlockAttrs|createDocWithMd|createRiffDeck|addRiffCards)$/.test(call.route));
    const attrsOf = (id) => client.apiChecked("/api/attr/getBlockAttrs", { id });
    const bodyOf = async (id) => (await client.apiChecked("/api/export/exportMdContent", { id, yfm: false, addTitle: false, refMode: 2 })).content;
    const deckSize = async (deckId) => {
        const decks = await client.apiChecked("/api/riff/getRiffDecks", {});
        const deck = decks.find((item) => item.id === deckId);
        assert(deck, "真实牌组必须存在");
        assert(Number.isSafeInteger(Number(deck.size)));
        return Number(deck.size);
    };
    const requestedCardId = (call) => {
        const tag = [...call.body.data.matchAll(/<div\b[^>]*>/g)].map((match) => match[0]).find((value) => /data-type="NodeListItem"/.test(value) && /data-node-id=/.test(value));
        const id = tag?.match(/data-node-id="(\d{14}-[a-z0-9]{7})"/)?.[1];
        assert.match(id ?? "", /^\d{14}-[a-z0-9]{7}$/);
        return id;
    };
    const readCard = async (id, hostDocId, content) => {
        const row = await until("确切卡片块 SQL 归属", async () => {
            const rows = await client.apiChecked("/api/query/sql", { stmt: `SELECT id, root_id, type FROM blocks WHERE id='${id}' LIMIT 1` });
            return rows[0] ?? false;
        });
        assert.equal(row.id, id);
        assert.equal(row.type, "i");
        assert.equal(row.root_id, hostDocId);
        const markdown = await client.apiChecked("/api/block/getBlockKramdown", { id });
        assert.equal(typeof markdown.kramdown, "string");
        assert(markdown.kramdown.includes(content.front));
        for (const line of content.back.split("\n").filter(Boolean)) assert(markdown.kramdown.includes(line));
        return { ...row, kramdown: markdown.kramdown };
    };

    try {
        evidence.kernelVersion = await client.apiChecked("/api/system/version");
        const notebookName = `siyuan-glean-flashcard-${process.pid}`;
        await client.apiChecked("/api/notebook/createNotebook", { name: notebookName });
        const listing = await client.apiChecked("/api/notebook/lsNotebooks", {});
        const box = listing.notebooks.find((item) => item.name === notebookName)?.id;
        assert.match(box ?? "", /^\d{14}-[a-z0-9]{7}$/);
        evidence.notebookId = box;
        const quote = "制卡来源引文：保存之前先核对预览，再明确确认。";
        const sourceId = await client.apiChecked("/api/filetree/createDocWithMd", {
            notebook: box, path: "/制卡来源文章", markdown: `# 制卡来源文章\n\n${quote}\n\n用户原文不能被制卡动作改变。`, tags: "制卡用户标签",
        });
        const foreignId = await client.apiChecked("/api/filetree/createDocWithMd", {
            notebook: box, path: "/其他来源文章", markdown: "# 其他来源文章\n\n这段文字属于其他文章。", tags: "另一用户标签",
        });
        await until("制卡来源文章 SQL", async () => {
            const docs = await clipStore.listAnchorDocs([box]);
            return [sourceId, foreignId].every((id) => docs.some((doc) => doc.id === id));
        });
        await clipStore.writeClip(monitoredPlugin, sourceId, { status: "later", url: "https://example.org/flashcard-source", author: "制卡手填作者", priority: 5, rating: 4 });
        const sourceBlocks = await client.apiChecked("/api/query/sql", { stmt: `SELECT id, content FROM blocks WHERE root_id='${sourceId}' AND type='p' ORDER BY id ASC` });
        const sourceBlock = sourceBlocks.find((block) => block.content === quote);
        assert(sourceBlock);
        const foreignBlocks = await client.apiChecked("/api/query/sql", { stmt: `SELECT id FROM blocks WHERE root_id='${foreignId}' AND type='p' ORDER BY id ASC` });
        assert(foreignBlocks[0]);
        const before = await Promise.all([sourceId, foreignId].map(async (id) => ({ id, attrs: await attrsOf(id), body: await bodyOf(id) })));
        evidence.source = { docId: sourceId, blockId: sourceBlock.id, foreignId, foreignBlockId: foreignBlocks[0].id };
        const source = { title: "制卡来源文章", quote, docId: sourceId, blockId: sourceBlock.id };
        const settings = normalizeSettings({ anchorNotebooks: [box] });
        const decksBefore = await client.apiChecked("/api/riff/getRiffDecks", {});
        const initialDeckSize = Number(decksBefore.find((deck) => deck.name === "拾遗卡片")?.size ?? 0);
        const hostBefore = await client.apiChecked("/api/query/sql", { stmt: `SELECT id FROM blocks WHERE type='d' AND box='${box}' AND content='拾遗卡片'` });
        assert.deepEqual(hostBefore, []);
        const assertSourcePreserved = async () => {
            for (const original of before) {
                assert.deepEqual(await attrsOf(original.id), original.attrs, "制卡不能更改来源文章任何属性或用户标签");
                assert.equal(await bodyOf(original.id), original.body, "制卡不能更改来源文章正文");
            }
        };

        const positionOffset = calls.length;
        const positionStorageOffset = storageWrites.length;
        const initialPosition = await clipStore.readReadingPosition(sourceId);
        assert.equal(initialPosition.raw, null);
        assert.equal(initialPosition.position, null);
        await clipStore.verifyReadingBlock(sourceId, sourceBlock.id);
        assert.equal(mutations(positionOffset).length, 0);
        assert.equal(storageWrites.length, positionStorageOffset);
        const position = { version: 1, blockId: sourceBlock.id, offset: 145, at: new Date().toISOString() };
        const savedPosition = await clipStore.saveReadingPosition(monitoredPlugin, sourceId, initialPosition, position);
        const positionReadback = await clipStore.readReadingPosition(sourceId);
        assert.deepEqual(savedPosition.position, position);
        assert.deepEqual(positionReadback.position, position);
        assert.equal(savedPosition.raw, JSON.stringify(position));
        assert.equal(positionReadback.raw, savedPosition.raw);
        const sourceOriginal = before.find((item) => item.id === sourceId);
        const bookmarkedAttrs = await attrsOf(sourceId);
        const withoutPosition = (attrs) => Object.fromEntries(Object.entries(attrs).filter(([key]) => !["custom-clip-reading-position", "updated"].includes(key)));
        assert.deepEqual(withoutPosition(bookmarkedAttrs), withoutPosition(sourceOriginal.attrs));
        assert.equal(await bodyOf(sourceId), sourceOriginal.body);
        sourceOriginal.attrs = bookmarkedAttrs;
        const stalePositionOffset = calls.length;
        await assert.rejects(clipStore.saveReadingPosition(monitoredPlugin, sourceId, initialPosition, { ...position, offset: 290 }), { reason: "changed" });
        assert.equal(mutations(stalePositionOffset).length, 0);
        assert.equal((await clipStore.readReadingPosition(sourceId)).raw, savedPosition.raw);
        await assertSourcePreserved();
        record("阅读书签真实段落：初始null只读、显式块ID/偏移/时间写入与读回；旧expected拒写且五态/正文/手填保持", { initialPosition, savedPosition, positionReadback });

        const foreignPositionOffset = calls.length;
        await assert.rejects(clipStore.verifyReadingBlock(sourceId, foreignBlocks[0].id), { reason: "missing" });
        await assert.rejects(clipStore.verifyReadingBlock(foreignId, sourceBlock.id), { reason: "missing" });
        await assert.rejects(clipStore.saveReadingPosition(monitoredPlugin, sourceId, savedPosition, { ...position, blockId: foreignBlocks[0].id }), { reason: "missing" });
        assert.equal(mutations(foreignPositionOffset).length, 0);
        const { exportLibraryBackup } = await import("../../src/services/backup-service.ts");
        const positionBackup = await exportLibraryBackup(monitoredPlugin, settings);
        fs.writeFileSync(path.join(evidenceDir, "reading-position-backup.json"), `${positionBackup}\n`);
        const backedUpSource = JSON.parse(positionBackup).documents.find((document) => document.id === sourceId);
        assert(backedUpSource);
        assert.equal(backedUpSource.attrs["custom-clip-reading-position"], savedPosition.raw);
        await assertSourcePreserved();
        record("阅读书签跨文档归属拒写；JSON备份保留完整原始书签字符串，对账/导出不改正文或书签", { sourceId, foreignBlockId: foreignBlocks[0].id, backedUpRawPosition: backedUpSource.attrs["custom-clip-reading-position"] });

        const previewOffset = calls.length;
        const previewStorageOffset = storageWrites.length;
        const input = { ...source };
        const session = cards.createFlashcardSession(input);
        input.title = "外部改动不得污染预览";
        assert.equal(session.source.title, source.title);
        assert.equal(Object.isFrozen(session.source), true);
        assert.equal(session.state, "ready");
        session.draft = { front: "已编辑预览正面", back: "已编辑预览背面" };
        const cancelled = cards.createFlashcardSession(source);
        cards.cancelFlashcardSession(cancelled);
        assert.deepEqual(await cards.confirmFlashcard(monitoredPlugin, cancelled, settings, cancelled.draft), { ok: false, reason: "cancelled" });
        assert.equal(calls.length, previewOffset);
        assert.equal(storageWrites.length, previewStorageOffset);
        assert.deepEqual(await client.apiChecked("/api/riff/getRiffDecks", {}), decksBefore);
        assert.deepEqual(await client.apiChecked("/api/query/sql", { stmt: `SELECT id FROM blocks WHERE type='d' AND box='${box}' AND content='拾遗卡片'` }), hostBefore);
        await assertSourcePreserved();
        record("制卡本地预览与编辑/取消零请求、零写入，不创建牌组、文档或块");

        const disabledOffset = calls.length;
        const disabledStorageOffset = storageWrites.length;
        assert.equal(settings.ai.questionCardEnabled, false);
        assert.equal(cards.questionCardEnabled(settings), false);
        assert.deepEqual(await cards.draftQuestionCard(monitoredPlugin, session, settings), { ok: false, reason: "off" });
        assert.equal(calls.length, disabledOffset);
        assert.equal(storageWrites.length, disabledStorageOffset);
        for (const [content, reason] of [[{ front: " ", back: "答案" }, "emptyFront"], [{ front: "问题", back: "\n" }, "emptyBack"]]) {
            assert.deepEqual(await cards.confirmFlashcard(monitoredPlugin, session, settings, content), { ok: false, reason });
        }
        assert.equal(calls.length, disabledOffset);
        record("AI问句制卡默认关闭且服务拒绝真实调用；空卡面在准备牌组前拒绝并保留预览");

        const edited = { front: "手工编辑问题：为什么要显式确认？", back: "手工编辑答案：先预览再制卡。\n保留作者与原文。" };
        const confirmOffset = calls.length;
        const saved = await cards.confirmFlashcard(monitoredPlugin, session, settings, edited);
        assert.equal(saved.ok, true, `明确确认失败：${saved.reason}`);
        assert.equal(session.state, "saved");
        assert.match(saved.cardBlockId, /^\d{14}-[a-z0-9]{7}$/);
        assert.match(saved.hostDocId, /^\d{14}-[a-z0-9]{7}$/);
        assert.notEqual(saved.hostDocId, sourceId);
        const confirmedInserts = inserts(confirmOffset);
        assert.equal(confirmedInserts.length, 1);
        assert.equal(requestedCardId(confirmedInserts[0]), saved.cardBlockId);
        assert.equal(confirmedInserts[0].body.parentID, saved.hostDocId);
        assert.deepEqual(registrations(confirmOffset).map((call) => call.body), [{ deckID: session.deckId, blockIDs: [saved.cardBlockId] }]);
        const savedCard = await readCard(saved.cardBlockId, saved.hostDocId, edited);
        await until("真实牌组登记第一张卡", async () => await deckSize(session.deckId) === initialDeckSize + 1);
        assert.equal((await clipStore.readClip(saved.hostDocId)).internal, true);
        const repeatOffset = calls.length;
        assert.deepEqual(await cards.confirmFlashcard(monitoredPlugin, session, settings, { front: "第二次不应替换", back: "第二次不应再插入" }), saved);
        assert.equal(calls.length, repeatOffset);
        assert.equal(await deckSize(session.deckId), initialDeckSize + 1);
        await assertSourcePreserved();
        record("明确确认仅插入编辑后的正背面，真实列表项ID登记riff；重复确认零请求且不重复插入", { saved, deckId: session.deckId, card: savedCard, deckSize: initialDeckSize + 1 });

        const registrationSession = cards.createFlashcardSession(source);
        const registrationContent = { front: "登记响应丢失问题", back: "内核登记成功后丢弃客户端响应，只重试原卡ID。" };
        const registrationOffset = calls.length;
        loseNextReply = "/api/riff/addRiffCards";
        const registrationFailure = await cards.confirmFlashcard(monitoredPlugin, registrationSession, settings, registrationContent);
        assert.equal(loseNextReply, undefined, "故障必须命中已成功的真实登记请求");
        assert.equal(registrationFailure.ok, false);
        assert.equal(registrationFailure.reason, "registerFailed");
        assert.equal(registrationSession.state, "inserted");
        assert.equal(registrationFailure.cardBlockId, registrationSession.cardBlockId);
        const registrationCard = await readCard(registrationFailure.cardBlockId, registrationFailure.hostDocId, registrationContent);
        await until("响应丢失仍真实登记第二张卡", async () => await deckSize(registrationSession.deckId) === initialDeckSize + 2);
        assert.equal(registrations(registrationOffset)[0].replyDiscarded, true);
        const registered = await cards.confirmFlashcard(monitoredPlugin, registrationSession, settings, { front: "重试不替换卡面", back: "重试不能再插入" });
        assert.equal(registered.ok, true);
        assert.equal(registered.cardBlockId, registrationFailure.cardBlockId);
        assert.equal(inserts(registrationOffset).length, 1);
        const registrationAttempts = registrations(registrationOffset);
        assert.equal(registrationAttempts.length, 2);
        assert.deepEqual(registrationAttempts[0].body, registrationAttempts[1].body);
        assert.deepEqual(registrationAttempts[1].body.blockIDs, [registrationFailure.cardBlockId]);
        assert.equal(await deckSize(registrationSession.deckId), initialDeckSize + 2);
        await readCard(registered.cardBlockId, registered.hostDocId, registrationContent);
        await assertSourcePreserved();
        record("riff真实成功响应丢失后保留确切卡ID；显式重试仅登记同ID，卡数与正文不重复", { registrationFailure, registered, card: registrationCard, registrationAttempts });

        const unknownSession = cards.createFlashcardSession(source);
        const unknownContent = { front: "插入响应丢失问题", back: "内核已建卡块，未知结果不能自动另建或登记。" };
        const unknownOffset = calls.length;
        loseNextReply = "/api/block/insertBlock";
        const unknownResult = await cards.confirmFlashcard(monitoredPlugin, unknownSession, settings, unknownContent);
        assert.equal(loseNextReply, undefined, "故障必须命中已成功的真实插入请求");
        assert.equal(unknownResult.ok, false);
        assert.equal(unknownResult.reason, "insertUnknown");
        assert.equal(unknownSession.state, "unknown");
        const unknownInserts = inserts(unknownOffset);
        assert.equal(unknownInserts.length, 1);
        assert.equal(unknownInserts[0].actualKernelAccepted, true);
        assert.equal(unknownInserts[0].replyDiscarded, true);
        const actualUnknownId = requestedCardId(unknownInserts[0]);
        const unknownCard = await readCard(actualUnknownId, unknownResult.hostDocId, unknownContent);
        const unknownRetryOffset = calls.length;
        assert.equal((await cards.confirmFlashcard(monitoredPlugin, unknownSession, settings, unknownContent)).reason, "insertUnknown");
        assert.equal(calls.length, unknownRetryOffset);
        assert.equal(inserts(unknownOffset).length, 1);
        assert.equal(registrations(unknownOffset).length, 0);
        assert.equal(await deckSize(session.deckId), initialDeckSize + 2);
        await assertSourcePreserved();
        record("真实插入响应丢失：确切原块已存在，服务保留未知状态并拒绝重发/猜块/登记", { unknownResult, actualUnknownId, card: unknownCard });

        const pendingRecovery = await cards.loadFlashcardRecovery(monitoredPlugin);
        assert.equal(pendingRecovery?.phase, "insert-intent");
        assert.equal(pendingRecovery?.cardBlockId, actualUnknownId);
        assert.equal(pendingRecovery?.hostDocId, unknownResult.hostDocId);
        assert.equal(pendingRecovery?.deckId, unknownSession.deckId);
        const recoveryOffset = calls.length;
        const recoveryStorageOffset = storageWrites.length;
        const recoveryResult = await cards.resumeFlashcardRecovery(monitoredPlugin);
        assert.equal(recoveryResult.ok, true);
        assert.equal(recoveryResult.registered, true);
        assert.equal(recoveryResult.recovery?.phase, "registered");
        assert.equal(recoveryResult.recovery?.cardBlockId, actualUnknownId);
        assert.equal(recoveryResult.recovery?.hostDocId, unknownResult.hostDocId);
        assert.equal(recoveryResult.recovery?.deckId, unknownSession.deckId);
        assert.equal(await cards.loadFlashcardRecovery(monitoredPlugin), null);
        assert.equal(inserts(recoveryOffset).length, 0);
        assert.equal(registrations(recoveryOffset).length, 1);
        assert.deepEqual(registrations(recoveryOffset)[0].body, { deckID: unknownSession.deckId, blockIDs: [actualUnknownId] });
        assert.equal(storageWrites.length, recoveryStorageOffset + 2);
        assert.equal(await deckSize(unknownSession.deckId), initialDeckSize + 3);
        await assertSourcePreserved();
        record("插入响应丢失后的恢复路径：按确切卡片ID显式登记、记录推进到registered并清理检查点，不重复插入", { pendingRecovery, recoveryResult, actualUnknownId });

        const invalidSource = cards.createFlashcardSession({ ...source, blockId: foreignBlocks[0].id });
        const ownershipOffset = calls.length;
        const ownershipStorageOffset = storageWrites.length;
        const ownershipResult = await cards.confirmFlashcard(monitoredPlugin, invalidSource, settings, invalidSource.draft);
        assert.deepEqual(ownershipResult, { ok: false, reason: "sourceChanged" });
        assert.equal(invalidSource.state, "ready");
        assert.equal(mutations(ownershipOffset).length, 0);
        assert.equal(storageWrites.length, ownershipStorageOffset);
        assert(calls.slice(ownershipOffset).every((call) => call.route === "/api/query/sql"));
        await assertSourcePreserved();
        record("合法ID但来源块属于其他文章时拒绝确认，真实SQL归属守门且不准备牌组或写入", { ownershipResult, sourceDocId: sourceId, foreignBlockId: foreignBlocks[0].id });

        evidence.sourceReadback = await Promise.all(before.map(async (original) => ({ ...original, afterAttrs: await attrsOf(original.id), afterBody: await bodyOf(original.id) })));
        assert.equal(calls.filter((call) => call.route.startsWith("/api/ai/")).length, 0);
        record("制卡全链真实读回：来源正文、五态、作者、URL、优先级、评分及用户tags完整保持，模型调用为0");
        evidence.completed = true;
        evidence.completedAt = new Date().toISOString();
        writeEvidence();
        return { evidencePath: path.join(evidenceDir, "flashcard-evidence.json"), scenarios: evidence.scenarios.length };
    } catch (error) {
        evidence.failure = { message: error.message, stack: error.stack };
        writeEvidence();
        throw error;
    } finally {
        globalThis.__gleanS1FetchSyncPost = transport;
    }
}
