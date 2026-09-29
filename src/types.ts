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
    /** 面板数据变更后的回调（如迁移完成后刷新） */
    notifyDataChanged(): void;
    /** 当前活动文档（右键/命令收录目标、高亮侧栏来源），无则空串 */
    currentDocId(): string;
}
