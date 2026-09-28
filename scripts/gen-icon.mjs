/**
 * 生成小驴拾遗 logo（小驴系列视觉：浅底圆角 + 渐变主形 + 白色图形）。
 * 与打卡(紫色对勾+橙点)、雷切(蓝色闪电)、人脉(青绿双人)区分：
 * 拾遗 = 琥珀金系 + 麦穗（glean/拾穗意象）+ 一粒脱落的谷粒（"遗落→捡回"）。
 * SDF 距离场绘制 + 3x3 超采样，纯 Node 零依赖（范式移植自小驴人脉 gen-icon.mjs）。
 *
 * 用法：
 *   node scripts/gen-icon.mjs a            # 生成变体 a → icon.png + preview.png
 *   node scripts/gen-icon.mjs a b c --all  # 生成 320px 预览 icon-variant-*.png
 * 变体：a 琥珀卡片·白麦穗+落粒 / b 无卡片琥珀麦穗 / c 深琥珀底白描边
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

/* ---------- PNG 编码 ---------- */

function crc32(buffer) {
    let table = crc32.table;
    if (!table) {
        table = crc32.table = new Int32Array(256);
        for (let n = 0; n < 256; n += 1) {
            let c = n;
            for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
            table[n] = c;
        }
    }
    let crc = -1;
    for (const byte of buffer) crc = (crc >>> 8) ^ table[(crc ^ byte) & 0xff];
    return (crc ^ -1) >>> 0;
}

function chunk(type, data) {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
}

function encodePng(width, height, pixelAt) {
    const raw = Buffer.alloc(height * (1 + width * 3));
    for (let y = 0; y < height; y += 1) {
        const rowStart = y * (1 + width * 3);
        raw[rowStart] = 0;
        for (let x = 0; x < width; x += 1) {
            const [r, g, b] = pixelAt(x, y);
            const offset = rowStart + 1 + x * 3;
            raw[offset] = r;
            raw[offset + 1] = g;
            raw[offset + 2] = b;
        }
    }
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(width, 0);
    ihdr.writeUInt32BE(height, 4);
    ihdr[8] = 8;
    ihdr[9] = 2;
    return Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        chunk("IHDR", ihdr),
        chunk("IDAT", zlib.deflateSync(raw)),
        chunk("IEND", Buffer.alloc(0)),
    ]);
}

/* ---------- SDF ---------- */

const sdCircle = (px, py, cx, cy, r) => Math.hypot(px - cx, py - cy) - r;

function sdRoundRect(px, py, cx, cy, hx, hy, r) {
    const qx = Math.abs(px - cx) - (hx - r);
    const qy = Math.abs(py - cy) - (hy - r);
    return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}

function sdCapsule(px, py, ax, ay, bx, by, r) {
    const pax = px - ax;
    const pay = py - ay;
    const bax = bx - ax;
    const bay = by - ay;
    const h = Math.min(Math.max((pax * bax + pay * bay) / (bax * bax + bay * bay), 0), 1);
    return Math.hypot(pax - bax * h, pay - bay * h) - r;
}

/** 白描边（描边宽度 w） */
const sdRing = (px, py, cx, cy, r, w) => Math.abs(Math.hypot(px - cx, py - cy) - r) - w;

function shape(sdf, fill, alpha = 1) {
    return { sdf, fill, alpha };
}

function mix(base, over, alpha) {
    return [
        base[0] + (over[0] - base[0]) * alpha,
        base[1] + (over[1] - base[1]) * alpha,
        base[2] + (over[2] - base[2]) * alpha,
    ];
}

/** 对角渐变（左上→右下） */
function diagGradient(topLeft, bottomRight) {
    return (x, y) => {
        const t = Math.min(Math.max((x + y) / 200, 0), 1);
        return [
            topLeft[0] + (bottomRight[0] - topLeft[0]) * t,
            topLeft[1] + (bottomRight[1] - topLeft[1]) * t,
            topLeft[2] + (bottomRight[2] - topLeft[2]) * t,
        ];
    };
}

function vGradient(y0, y1, top, bottom) {
    return (_x, y) => {
        const t = Math.min(Math.max((y - y0) / (y1 - y0), 0), 1);
        return [
            top[0] + (bottom[0] - top[0]) * t,
            top[1] + (bottom[1] - top[1]) * t,
            top[2] + (bottom[2] - top[2]) * t,
        ];
    };
}

function render(width, height, shapes) {
    const scale = Math.min(width, height) / 160;
    const offsetX = (width - 160 * scale) / 2;
    const offsetY = (height - 160 * scale) / 2;
    const ss = 3;
    const offsets = [];
    for (let sy = 0; sy < ss; sy += 1) for (let sx = 0; sx < ss; sx += 1) offsets.push([(sx + 0.5) / ss, (sy + 0.5) / ss]);
    return (x, y) => {
        let acc = [255, 255, 255];
        for (const [sx, sy] of offsets) {
            const ux = (x + sx - offsetX) / scale;
            const uy = (y + sy - offsetY) / scale;
            let color = [255, 255, 255];
            for (const item of shapes) {
                const d = item.sdf(ux, uy);
                const cover = Math.min(Math.max(0.5 - d, 0), 1);
                if (cover <= 0) continue;
                const fill = typeof item.fill === "function" ? item.fill(ux, uy) : item.fill;
                color = mix(color, fill, cover * item.alpha);
            }
            acc = [acc[0] + color[0] / (ss * ss), acc[1] + color[1] / (ss * ss), acc[2] + color[2] / (ss * ss)];
        }
        return [Math.round(acc[0]), Math.round(acc[1]), Math.round(acc[2])];
    };
}

const LIGHT_BG = (x, y) => vGradient(2, 158, [253, 248, 238], [248, 236, 224])(x, y);
const basePlate = () => shape((x, y) => sdRoundRect(x, y, 80, 80, 78, 78, 34), LIGHT_BG);

/* ---------- 麦穗（glean/拾穗意象） ---------- */

const AMBER = { a: [249, 188, 82], b: [231, 116, 44] };
const WHITE = [255, 255, 255];

/** 白色麦穗：茎 + 三对麦粒 + 顶粒 + 双芒 + 一片叶 + 右下落粒 */
function wheatSpike(cx = 80, white = WHITE, awnAlpha = 1) {
    const cap = (ax, ay, bx, by, r, alpha = 1) => shape((x, y) => sdCapsule(x, y, ax, ay, bx, by, r), white, alpha);
    return [
        // 茎
        cap(cx, 118, cx, 70, 3.4),
        // 叶（左向一片）
        cap(cx + 1, 104, cx - 17, 95, 3.6),
        // 麦粒三对（自下而上渐短）
        cap(cx, 82, cx - 15, 70, 6),
        cap(cx, 82, cx + 15, 70, 6),
        cap(cx, 66, cx - 15, 54, 6),
        cap(cx, 66, cx + 15, 54, 6),
        cap(cx, 50, cx - 13, 40, 5.5),
        cap(cx, 50, cx + 13, 40, 5.5),
        // 顶粒
        cap(cx, 46, cx, 32, 5.5),
        // 芒（顶部细针）
        cap(cx - 3, 38, cx - 9, 22, 1.3, awnAlpha),
        cap(cx + 3, 38, cx + 9, 22, 1.3, awnAlpha),
    ];
}

/** a：琥珀渐变卡片 + 白麦穗 + 落粒（推荐） */
function variantA() {
    return [
        basePlate(),
        // 琥珀渐变圆角卡片（区别于打卡紫/雷切蓝/人脉青绿）
        shape((x, y) => sdRoundRect(x, y, 80, 82, 47, 44, 16), diagGradient(AMBER.a, AMBER.b)),
        ...wheatSpike(80, WHITE, 1),
        // 脱落的谷粒（"遗落→捡回"的拾遗叙事）
        shape((x, y) => sdCircle(x, y, 107, 108, 4), WHITE, 0.9),
    ];
}

/** b：无卡片，琥珀麦穗直接立于浅底 */
function variantB() {
    const amberFill = diagGradient(AMBER.a, AMBER.b);
    const cap = (ax, ay, bx, by, r, alpha = 1) => shape((x, y) => sdCapsule(x, y, ax, ay, bx, by, r), amberFill, alpha);
    return [
        basePlate(),
        shape((x, y) => sdCapsule(x, y, 80, 120, 80, 70, 3.6), amberFill),
        shape((x, y) => sdCapsule(x, y, 81, 105, 63, 96, 3.8), amberFill),
        cap(80, 82, 64, 69, 6.2),
        cap(80, 82, 96, 69, 6.2),
        cap(80, 66, 64, 53, 6.2),
        cap(80, 66, 96, 53, 6.2),
        cap(80, 50, 67, 39, 5.7),
        cap(80, 50, 93, 39, 5.7),
        cap(80, 46, 80, 31, 5.7),
        cap(77, 37, 70, 20, 1.4),
        cap(83, 37, 90, 20, 1.4),
        shape((x, y) => sdCircle(x, y, 107, 110, 4.5), amberFill, 0.85),
    ];
}

/** c：深琥珀底 + 白描边麦穗（最大货架辨识度） */
function variantC() {
    const outline = (ax, ay, bx, by, r, alpha = 1) => shape((x, y) => sdCapsule(x, y, ax, ay, bx, by, r), [0, 0, 0], 0);
    void outline;
    const capOutline = (ax, ay, bx, by, r, alpha = 1) =>
        shape(
            (x, y) => Math.abs(sdCapsule(x, y, ax, ay, bx, by, r - 1.8)) - 1.8,
            WHITE,
            alpha
        );
    return [
        shape((x, y) => sdRoundRect(x, y, 80, 80, 78, 78, 34), diagGradient([214, 138, 44], [198, 84, 32])),
        ...wheatSpike(80, WHITE, 0.95),
        capOutline(80, 118, 80, 70, 3.4, 0),
        shape((x, y) => sdCircle(x, y, 107, 108, 4), WHITE, 0.9),
    ];
}

const VARIANTS = { a: variantA, b: variantB, c: variantC };

const root = path.resolve(import.meta.dirname, "..");
const args = process.argv.slice(2);
const wantAll = args.includes("--all");
const picked = args.find((arg) => VARIANTS[arg]) ?? "a";

if (wantAll) {
    for (const name of Object.keys(VARIANTS)) {
        fs.writeFileSync(path.join(root, `icon-variant-${name}.png`), encodePng(320, 320, render(320, 320, VARIANTS[name]())));
    }
    console.log("预览 icon-variant-a/b/c.png (320px) 已生成");
} else {
    fs.writeFileSync(path.join(root, "icon.png"), encodePng(160, 160, render(160, 160, VARIANTS[picked]())));
    fs.writeFileSync(path.join(root, "preview.png"), encodePng(1920, 1280, render(1920, 1280, VARIANTS[picked]())));
    console.log(`icon.png / preview.png 已生成（变体 ${picked}）`);
}
