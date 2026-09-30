import { resolveKernel, prepareWorkspace, assertTestPortAvailable, startKernel, createApiClient, waitForBoot, shutdownKernel } from "./kernel-harness.mjs";
import { fetchPost } from "siyuan";
import os from "node:os";
import path from "node:path";

const HOST = "127.0.0.1";
const port = 38000 + Math.floor(Math.random() * 5000);
const WORKSPACE = path.join(os.tmpdir(), `ial-test-${Date.now()}`);
const kernel = resolveKernel();
prepareWorkspace(WORKSPACE, "ial-test-marker.json", "ial-test");
await assertTestPortAvailable(HOST, port);
const { child, lines } = startKernel(kernel, path.join(process.cwd(), "..", ".."), WORKSPACE, port);
await waitForBoot(HOST, lines, () => {}, null);
const client = createApiClient(HOST, port);

globalThis.__gleanS1FetchPost = (route, body, cb) => {};

