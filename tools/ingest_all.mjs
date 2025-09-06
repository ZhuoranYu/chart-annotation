import fs from "fs";
import path from "path";
import { createClient } from "@supabase/supabase-js";
import mime from "mime-types";

// ==== 环境变量（本地导入用 service role key）====
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY env vars.");
  process.exit(1);
}
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// ==== 本地资源根路径 & Storage bucket ====
const JSON_ROOT    = "./server/data"; // 1文件=1个task
const IMG_ROOT_PDF = "./images/pdf";  // pdf 导出的 png 根目录
const BUCKET       = "charts";

// ==== 上传稳态参数 ====
const EXTS = [".png", ".jpg", ".jpeg", ".webp"];
const MAX_RETRIES = 5;
const BASE_DELAY_MS = 300; // 300ms, 指数退避
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ========== 工具函数 ==========

// 取 example_id：优先用对象key，其次 custom_id，再其次 id，再退化为 index
function getExampleId(idx, key, item) {
  return (
    (key ?? null) ||
    item?.custom_id ||
    item?.metadata?.custom_id ||
    item?.id ||
    String(idx)
  );
}

// 取 question（冗余列）
function getQuestion(item) {
  return item?.question ?? item?.metadata?.question ?? null;
}

// 建立图片索引：index[task].get(exampleId) = fullPath（递归扫描）
function buildImageIndex(rootDir) {
  const index = new Map(); // task -> Map<exampleId, fullPath>
  function walk(dir) {
    if (!fs.existsSync(dir)) return;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const ent of entries) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        walk(full);
      } else {
        const ext = path.extname(ent.name).toLowerCase();
        if (!EXTS.includes(ext)) continue;
        const rel = path.relative(IMG_ROOT_PDF, full); // e.g. counterfactual/line/line-0.png
        const segs = rel.split(path.sep);
        if (segs.length < 2) continue;
        const task = segs[0];
        const exampleId = path.basename(ent.name, ext);
        if (!index.has(task)) index.set(task, new Map());
        if (!index.get(task).has(exampleId)) {
          index.get(task).set(exampleId, full);
        }
      }
    }
  }
  walk(rootDir);
  return index;
}

// 根据 item.pdf_path 推导本地 PNG 路径和 Storage 目标路径
// 规则：把 pdf_path 的扩展名 .pdf 改成 .png，并在本地前面加 images/pdf/
//      Storage 路径前面加 pdf/
function derivePathsFromPdf(task, exampleId, item) {
  const pdfPath = item?.pdf_path || item?.metadata?.pdf_path || null;
  if (!pdfPath) return { localPng: null, storagePng: null };

  const normPdf = pdfPath.replace(/\\/g, "/"); // 兼容 Windows 路径
  const idx = normPdf.toLowerCase().indexOf(task.toLowerCase() + "/");
  const relative = idx >= 0
    ? normPdf.slice(idx) // e.g., "counterfactual/line/line-0.pdf"
    : path.join(task, path.basename(normPdf));

  const relPng = relative.replace(/\.[Pp][Dd][Ff]$/, ".png");
  const localPng = path.join(IMG_ROOT_PDF, relPng); // images/pdf/<relative>.png
  const storagePng = path.posix.join("pdf", relPng.replace(/\\/g, "/")); // bucket 内部路径
  return { localPng, storagePng };
}

// 上传文件到 Storage，返回 public URL（带重试和指数退避）
async function uploadAndGetPublicUrl(localPath, storagePath) {
  const buf = fs.readFileSync(localPath);
  const contentType = mime.lookup(localPath) || "application/octet-stream";

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const { error } = await supabase
        .storage
        .from(BUCKET)
        .upload(storagePath, buf, { upsert: true, contentType });

      if (!error) {
        const { data } = supabase.storage.from(BUCKET).getPublicUrl(storagePath);
        return data?.publicUrl || null;
      }
      throw error;
    } catch (e) {
      const tag = `[upload retry ${attempt}/${MAX_RETRIES}] ${storagePath}`;
      const msg = e?.message || e?.status || e?.statusCode || String(e);
      console.warn(tag, msg);
      if (attempt >= MAX_RETRIES) throw e;
      await sleep(BASE_DELAY_MS * Math.pow(2, attempt - 1)); // 0.3s 0.6s 1.2s 2.4s 4.8s
    }
  }
  return null; // 理论到不了
}

// upsert 一条记录：json_blob 原样保存，只额外加 pdf_image_url（写回 json_blob）
// 同时把 image_path 也填上（存 storage 内部相对路径，便于后续需要）
async function upsertRow({ task, exampleId, obj, pdfImagePath, pdfImageUrl }) {
  const mergedBlob = { ...obj };
  if (pdfImageUrl) mergedBlob.pdf_image_url = pdfImageUrl;

  const patch = {
    task,
    example_id: exampleId,
    json_blob: mergedBlob,
    question: getQuestion(obj),
    image_path: pdfImagePath ?? null,
    updated_at: new Date().toISOString()
  };

  const { error } = await supabase
    .from("examples")
    .upsert(patch, { onConflict: "task,example_id" });
  if (error) throw error;
}

// ========== 主流程 ==========
async function main() {
  const files = fs.readdirSync(JSON_ROOT).filter(f => f.endsWith(".json"));
  if (files.length === 0) {
    console.error(`No JSON files under ${JSON_ROOT}`);
    process.exit(1);
  }

  // 建立图片索引（递归）
  const imageIndex = buildImageIndex(IMG_ROOT_PDF);
  const failures = [];

  for (const jf of files) {
    const task = path.parse(jf).name; // 文件名即 task
    const raw = JSON.parse(fs.readFileSync(path.join(JSON_ROOT, jf), "utf8"));
    const entries = Array.isArray(raw)
      ? raw.map((item, idx) => [getExampleId(idx, null, item), item])
      : Object.entries(raw); // [exampleId, item]

    for (let i = 0; i < entries.length; i++) {
      const [maybeId, item] = entries[i];
      const exampleId = getExampleId(i, maybeId, item);

      try {
        // ① 先用索引命中
        let localPng = imageIndex.get(task)?.get(exampleId);
        let storagePng = null;

        // ② 失败再按 pdf_path 推导一次
        if (!localPng) {
          const derived = derivePathsFromPdf(task, exampleId, item);
          if (derived.localPng && fs.existsSync(derived.localPng)) {
            localPng = derived.localPng;
            storagePng = derived.storagePng;
          }
        }

        // ③ 上传（若找到了本地图）；并限速
        let pdfImagePath = null;
        let pdfImageUrl = null;
        if (localPng) {
          if (!storagePng) {
            const rel = path.relative(IMG_ROOT_PDF, localPng).replace(/\\/g, "/");
            storagePng = `pdf/${rel}`;
          }
          pdfImageUrl = await uploadAndGetPublicUrl(localPng, storagePng);
          pdfImagePath = storagePng;
          await sleep(100); // 轻微限速，避免边缘限流
        }

        // ④ 写入/更新数据库（json_blob 原样 + pdf_image_url）
        await upsertRow({ task, exampleId, obj: item, pdfImagePath, pdfImageUrl });

        // ⑤ 进度输出
        console.log(`[OK] ${task}/${exampleId} ${pdfImageUrl ? "-> " + pdfImagePath : "(no pdf image)"}`);

        // 每 200 条小憩 2 秒，继续稳态跑
        if (i > 0 && i % 200 === 0) {
          await sleep(2000);
        }
      } catch (e) {
        const msg = e?.message || e?.status || e?.statusCode || String(e);
        failures.push({ task, exampleId, error: msg });
        console.error(`[FAIL] ${task}/${exampleId}: ${msg}`);
        // 不中断，继续下一条
      }
    }
  }

  if (failures.length) {
    fs.writeFileSync("upload_failures.json", JSON.stringify(failures, null, 2));
    console.warn(`Failed ${failures.length} items. See upload_failures.json`);
  }
  console.log("All done.");
}

main().catch(e => { console.error(e); process.exit(1); });
