/** i18n 助手：键缺失回退英文键名；支持 ${name} 插值。 */

export type I18nBundle = Record<string, string>;

export function t(i18n: I18nBundle, key: string, vars?: Record<string, string | number>): string {
    const template = i18n[key] ?? key;
    if (!vars) return template;
    return template.replace(/\$\{(\w+)\}/g, (_, name: string) =>
        vars[name] !== undefined ? String(vars[name]) : `\${${name}}`
    );
}
