/** 组件与插件壳之间的门面接口（组件只依赖这里，不反向 import index.ts，避免循环）。 */
import type { Plugin } from "siyuan";
import type { GleanSettings } from "./services/settings";
import type { I18nBundle } from "./libs/i18n";

export interface GleanFacade {
    /** 插件实例（saveData / openTab 需要）；组件不得反向 import 壳文件 */
    readonly pluginInstance: Plugin;
    readonly i18n: I18nBundle;
    settings: GleanSettings;
    isMobile: boolean;
    /** 保存设置并广播（面板读 facade.settings 渲染） */
    updateSettings(patch: Partial<GleanSettings>): Promise<void>;
    /** 打开迁移器弹窗 */
    openMigrate(): void;
    /** 打开设置弹窗 */
    openSettings(): void;
    /** 打开迁移导入弹窗 */
    openImport(): void;
    /** 归档后处理三选对话框（T-1866：保留原位置/移入【归档】/删除文章+彻底删除二级） */
    openArchiveDialog(docId: string): void;
    /** 工作台弹出为独立浮窗 */
    openWorkbenchPopup(): void;
    /** 面板数据变更后的回调（如迁移完成后刷新） */
    notifyDataChanged(): void;
    /** 当前活动文档（右键/命令收录目标、高亮侧栏来源），无则空串 */
    currentDocId(): string;
    /** 用思源原生编辑器打开一篇文章，并记录会话内最近阅读文档。 */
    openReadingDocument(docId: string): void;
    /** 显式打开内嵌阅读页签（D-0029）；移动端回退原生查看器。 */
    openReader(docId: string): void;
    /** 阅读页签消费待打开的文档 ID（会话内存，不落 saveData）。 */
    consumeReaderFocus(): string;
    /** 从原生正文返回读库并定位到同一篇文章。 */
    openLibraryArticle(docId: string): Promise<void>;
    /** 新挂载工作台消费返回定位请求，避免 tab 异步初始化时丢失事件。 */
    consumeLibraryFocus(): string;
}
