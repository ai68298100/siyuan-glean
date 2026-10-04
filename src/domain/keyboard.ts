/** 键盘激活语义（L-002）：按钮化的非原生元素统一接受 Enter 与 Space。 */
export function isActivationKey(key: string): boolean {
    return key === "Enter" || key === " ";
}
