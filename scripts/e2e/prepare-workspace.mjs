import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isSupportedE2EManifest, resolvePluginBundle } from "./plugin-identity.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function parseArgs() {
    const options = {};
    for (let index = 2; index < process.argv.length; index += 1) {
        const argument = process.argv[index];
        if (argument === "--help") {
            console.log("node scripts/e2e/prepare-workspace.mjs --manifest path [--plugin-dir path]");
            process.exit(0);
        }
        if (!argument.startsWith("--")) throw new Error("未知参数: " + argument);
        const key = argument.slice(2);
        const value = process.argv[index + 1];
        if (!value || value.startsWith("--")) throw new Error("参数缺少值: --" + key);
        options[key] = value;
        index += 1;
    }
    return options;
}

function readJson(filePath) {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

const options = parseArgs();
if (!options.manifest) throw new Error("需要 --manifest");
const manifestPath = path.resolve(options.manifest);
const manifest = readJson(manifestPath);
if (!isSupportedE2EManifest(manifest)) throw new Error("manifest 创建者或版本不匹配");
if (!path.isAbsolute(manifest.workspace) || !manifest.marker) throw new Error("manifest 缺少隔离工作区或标记");
const workspace = path.resolve(manifest.workspace);
const markerPath = path.join(workspace, manifest.marker);
const marker = readJson(markerPath);
if (marker.createdBy !== manifest.createdBy) throw new Error("工作区标记不匹配，拒绝操作");

const plugin = resolvePluginBundle(options["plugin-dir"] || manifest.pluginDir || REPO);
if (manifest.pluginName && plugin.name !== manifest.pluginName) throw new Error("目标插件与 manifest 不匹配");
if (manifest.pluginVersion && plugin.version && plugin.version !== manifest.pluginVersion) throw new Error("目标插件版本与 manifest 不匹配");
const target = path.join(workspace, "data", "plugins", plugin.name);
fs.rmSync(target, { recursive: true, force: true });
fs.mkdirSync(target, { recursive: true });
fs.cpSync(plugin.distDir, target, { recursive: true });
console.log(JSON.stringify({ manifest: manifestPath, workspace, pluginName: plugin.name, pluginVersion: plugin.version, target }, null, 2));
