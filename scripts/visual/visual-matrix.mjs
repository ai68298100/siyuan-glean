export const VISUAL_VIEWPORTS = Object.freeze([
    { id: "desktop", width: 1280, height: 800, label: "桌面" },
    { id: "narrow", width: 768, height: 1024, label: "窄屏" },
    { id: "mobile", width: 390, height: 844, label: "移动端" },
]);

export const VISUAL_STATES = Object.freeze([
    { id: "default", label: "默认", expectation: "主路径可操作，当前任务和下一步清晰" },
    { id: "empty", label: "空", expectation: "明确没有内容，并给出低打扰入口" },
    { id: "loading", label: "加载", expectation: "保留上下文，说明正在处理且不伪造结果" },
    { id: "no-results", label: "无结果", expectation: "区分无匹配与空库，并提供清除条件入口" },
    { id: "failure", label: "失败", expectation: "说明影响、保留已有数据并提供重试或降级" },
    { id: "partial-success", label: "部分成功", expectation: "逐项说明成功、跳过和失败，允许继续处理" },
    { id: "success", label: "成功", expectation: "反馈真实结果，成功提示可继续或撤销" },
    { id: "undo", label: "撤销", expectation: "只恢复仍未被外部修改的动作，并说明结果" },
]);

export function visualCaseId(viewportId, stateId) {
    return `${viewportId}--${stateId}`;
}

export function buildVisualCases() {
    return VISUAL_VIEWPORTS.flatMap((viewport) => VISUAL_STATES.map((state) => ({
        id: visualCaseId(viewport.id, state.id),
        viewport: viewport.id,
        state: state.id,
        screenshot: `docs/visual-regression/baseline/${visualCaseId(viewport.id, state.id)}.png`,
        recording: `output/visual-regression/${visualCaseId(viewport.id, state.id)}.webm`,
        status: "pending-host",
    })));
}

