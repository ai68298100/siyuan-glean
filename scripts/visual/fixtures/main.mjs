import { mount } from "svelte";
import Preview from "./Preview.svelte";
import "../../../src/index.scss";
import "./preview.css";
import i18n from "../../../public/i18n/zh_CN.json";

globalThis.__GLEAN_I18N = i18n;

// 真实服务经 mock SDK 调用内存接口；漏出的 fetch 不得触达真实服务。
const browserFetch = window.fetch.bind(window);
window.fetch = (input, init) => {
    const url = new URL(typeof input === "string" ? input : input.url, location.href);
    if (url.origin !== location.origin || url.pathname.startsWith("/api/")) {
        return Promise.reject(new Error("隔离预览禁止网络业务请求"));
    }
    return browserFetch(input, init);
};
mount(Preview, { target: document.querySelector("#app") });
