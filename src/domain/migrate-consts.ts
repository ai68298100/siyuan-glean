/** 迁移/批量的数值约束（domain 放常量，services/UI 引用，避免循环依赖）。 */

/** 规划书 T-1102：每批写入 ≤50 */
export const MAX_MIGRATE_BATCH_SIZE = 50;
export const DEFAULT_MIGRATE_BATCH_SIZE = 25;
