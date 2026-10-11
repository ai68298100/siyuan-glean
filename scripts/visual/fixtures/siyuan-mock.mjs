const store = new Map();

export function getFrontend() {
  return "desktop";
}

export function showMessage(message) {
  window.dispatchEvent(new CustomEvent("glean:preview-message", { detail: String(message) }));
}

export function openTab() {}
export function openMobileFileById() {}

const docs = [{ id: "preview-article-1", content: "隔离预览：如何把阅读变成可回看的积累", hpath: "/示例/阅读", box: "preview-box", updated: "20261011200000", tag: "剪藏" }];
const attrs = {
  "preview-article-1": {
    "custom-clip-status": "inbox",
    "custom-clip-url": "https://example.com/preview",
    "custom-clip-site": "example.com",
    "custom-clip-src": "manual",
    "custom-clip-time": "20261011200000",
    "custom-clip-content-type": "link",
    "custom-clip-time-source": "manual",
    tags: "剪藏",
  },
};

function response(route, body = {}) {
  if (route === "/api/query/sql") return docs;
  if (route === "/api/attr/batchGetBlockAttrs") return Object.fromEntries(Object.keys(attrs).map((id) => [id, attrs[id]]));
  if (route === "/api/export/exportMdContent") return { hPath: "/示例/阅读", content: "隔离预览正文" };
  if (route === "/api/notebook/lsNotebooks") return { notebooks: [{ id: "preview-box", name: "隔离预览" }] };
  if (route === "/api/filetree/getPathByID") return { path: "/示例/阅读" };
  if (route === "/api/attr/getBlockAttrs") return attrs[body.id] ?? {};
  if (route === "/api/setting/getCloudURL") return { url: "" };
  return {};
}

export function fetchPost(route, body, callback) {
  queueMicrotask(() => callback({ code: 0, msg: "", data: response(route, body) }));
}

export async function fetchSyncPost(route, body) {
  return { code: 0, msg: "", data: response(route, body) };
}

export function getAllEditor() {
  return [];
}

export class Dialog {
  constructor(options = {}) {
    this.element = document.createElement("div");
    this.element.className = "glean-preview-dialog";
    this.element.innerHTML = options.content ?? "";
    document.body.appendChild(this.element);
  }
  destroy() { this.element.remove(); }
  close() { this.destroy(); }
}

export class Protyle {}

export function __previewStore() {
  return store;
}
