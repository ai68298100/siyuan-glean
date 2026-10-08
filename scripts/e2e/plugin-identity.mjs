import fs from "node:fs";
import path from "node:path";

export const E2E_MANIFEST_VERSION = 1;
export const E2E_CREATED_BY = "siyuan-plugin-e2e-session";
export const LEGACY_E2E_CREATED_BY = "siyuan-glean-e2e-session";
export const E2E_SESSION_DIR_NAME = "siyuan-plugin-e2e-sessions";

const PLUGIN_NAME = /^[a-z0-9][a-z0-9._-]*$/;

function readJson(filePath) {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

export function isValidPluginName(name) {
    return typeof name === "string" && PLUGIN_NAME.test(name);
}

function assertPluginName(name) {
    if (!isValidPluginName(name)) {
        throw new Error("plugin.json name 必须是小写字母、数字、点、下划线或短横线组成的合法插件名");
    }
    return name;
}

export function resolvePluginBundle(pluginDir) {
    const root = path.resolve(pluginDir);
    const manifestPath = path.join(root, "plugin.json");
    const pluginManifest = readJson(manifestPath);
    const name = assertPluginName(pluginManifest.name);
    const version = typeof pluginManifest.version === "string" ? pluginManifest.version : null;
    const distDir = path.join(root, "dist");
    if (!fs.existsSync(path.join(distDir, "index.js"))) {
        throw new Error(`插件 dist 缺少 index.js：${distDir}`);
    }
    if (fs.existsSync(path.join(distDir, "plugin.json"))) {
        const distManifest = readJson(path.join(distDir, "plugin.json"));
        if (distManifest.name !== name || (version && distManifest.version !== version)) {
            throw new Error("dist/plugin.json 与源 plugin.json 的插件身份不一致");
        }
    }
    return { root, manifestPath, name, version, distDir };
}

export function isSupportedE2EManifest(manifest) {
    return Boolean(manifest)
        && manifest.version === E2E_MANIFEST_VERSION
        && [E2E_CREATED_BY, LEGACY_E2E_CREATED_BY].includes(manifest.createdBy);
}
