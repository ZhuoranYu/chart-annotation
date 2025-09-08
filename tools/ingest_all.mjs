// tools/ingest_all.mjs
import fs from "fs";
import path from "path";
import { createClient } from "@supabase/supabase-js";
import mime from "mime-types";

// ==== Env (use SERVICE ROLE KEY locally) ====
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY env vars.");
  process.exit(1);
}
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// ==== Local roots & Storage bucket/prefix ====
const JSON_ROOT = "./server/data";           // one file = one task
const IMG_ROOT  = "./images/chart-only";     // <-- EXACTLY this (hyphen)
const BUCKET    = "charts";
const STORAGE_PREFIX = "chart-only";         // charts/chart-only/** in Storage

// ==== Upload stability ====
const EXTS = [".png", ".jpg", ".jpeg", ".webp"];
const MAX_RETRIES = 5;
const BASE_DELAY_MS = 300;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const VERBOSE = process.env.VERBOSE === "1" || process.env.VERBOSE === "true";
const logv = (...args) => { if (VERBOSE) console.log(...args); };

// ---------- helpers ----------
function getExampleId(idx, key, item) {
  return (
    (key ?? null) ||
    item?.custom_id ||
    item?.metadata?.custom_id ||
    item?.id ||
    String(idx)
  );
}
function getQuestion(item) {
  return item?.question ?? item?.metadata?.question ?? null;
}

function walkImages(rootDir) {
  const out = [];
  function walk(dir) {
    if (!fs.existsSync(dir)) return;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const ent of entries) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) walk(full);
      else {
        const ext = path.extname(ent.name).toLowerCase();
        if (EXTS.includes(ext)) out.push(full);
      }
    }
  }
  walk(rootDir);
  return out;
}

// Build indices for quick lookup
function buildImageIndexes(rootDir) {
  const byTask = new Map(); // task -> Map<exampleId, absPath>
  const byName = new Map(); // exampleId -> unique absPath
  const collisions = new Set();

  const files = walkImages(rootDir);
  for (const full of files) {
    const rel = path.relative(IMG_ROOT, full); // e.g. counterfactual/line/line-0.png
    const segs = rel.split(path.sep);
    const ext = path.extname(full).toLowerCase();
    const exampleId = path.basename(full, ext);
    const task = segs[0]; // first folder after IMG_ROOT

    if (task) {
      if (!byTask.has(task)) byTask.set(task, new Map());
      if (!byTask.get(task).has(exampleId)) byTask.get(task).set(exampleId, full);
    }

    if (byName.has(exampleId) && byName.get(exampleId) !== full) {
      collisions.add(exampleId);
    } else if (!byName.has(exampleId)) {
      byName.set(exampleId, full);
    }
  }
  for (const id of collisions) byName.delete(id);

  logv("Index stats:", `files=${files.length}`, `tasks=${byTask.size}`, `globalUniqueNames=${byName.size}`);
  return { byTask, byName };
}

// Resolve local image path for this exampleId, preferring:
// 1) byTask index -> 2) chart_path from JSON -> 3) byName -> 4) brute force
function resolveLocalChartPath(task, exampleId, item, indexes) {
  // 1) byTask
  const hit = indexes.byTask.get(task)?.get(exampleId);
  if (hit) { logv(`[HIT byTask] ${task}/${exampleId} -> ${hit}`); return { local: hit, storage: null }; }

  // 2) from JSON chart_path (or aliases). Expect "images/chart-only/..."
  const p =
    item?.chart_path ||
    item?.chart_png_path ||
    item?.chart_only_path ||
    item?.chart_image ||
    item?.chart_image_path ||
    item?.metadata?.chart_path ||
    item?.metadata?.chart_png_path ||
    item?.metadata?.chart_only_path ||
    item?.metadata?.chart_image ||
    item?.metadata?.chart_image_path ||
    null;

  if (p) {
    const norm = String(p).replace(/\\/g, "/");
    // If JSON already stores "images/chart-only/...", use that absolute-from-project-root
    const candidates = [];
    if (/^(\.\/)?images\/chart-?only\//i.test(norm)) {
      candidates.push(path.join(process.cwd(), norm));
    }
    // Also try under IMG_ROOT
    candidates.push(path.join(IMG_ROOT, norm));
    // And try IMG_ROOT + task + basename
    candidates.push(path.join(IMG_ROOT, task, path.basename(norm)));

    for (const cand of candidates) {
      if (fs.existsSync(cand)) {
        const rel = path.relative(IMG_ROOT, cand).replace(/\\/g, "/");
        const storage = `${STORAGE_PREFIX}/${rel}`;
        logv(`[HIT from JSON path] ${task}/${exampleId} -> ${cand}`);
        return { local: cand, storage };
      }
    }
  }

  // 3) global byName (if unique)
  const nameHit = indexes.byName.get(exampleId);
  if (nameHit) {
    logv(`[HIT byName] ${task}/${exampleId} -> ${nameHit}`);
    return { local: nameHit, storage: null };
  }

  // 4) brute force
  for (const ext of EXTS) {
    const guess = path.join(IMG_ROOT, exampleId + ext);
    if (fs.existsSync(guess)) {
      logv(`[HIT brute-force] ${task}/${exampleId} -> ${guess}`);
      return { local: guess, storage: null };
    }
  }

  logv(`[MISS] ${task}/${exampleId}`);
  return { local: null, storage: null };
}

async function uploadAndGetPublicUrl(localPath, storagePath) {
  const buf = fs.readFileSync(localPath);
  const contentType = mime.lookup(localPath) || "application/octet-stream";

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const { error } = await supabase.storage
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
      await sleep(BASE_DELAY_MS * Math.pow(2, attempt - 1));
    }
  }
  return null;
}

// Upsert row: preserve json_blob; add image_path; add chart URL to json_blob as well
async function upsertRow({ task, exampleId, obj, chartImagePath, chartImageUrl }) {
  const mergedBlob = { ...obj };
  if (chartImageUrl) {
    mergedBlob.pdf_image_url = chartImageUrl;    // frontend already checks this first
    mergedBlob.chart_image_url = chartImageUrl;  // also store a clearer name
  }

  const patch = {
    task,
    example_id: exampleId,
    json_blob: mergedBlob,
    question: getQuestion(obj),
    image_path: chartImagePath ?? null,  // chart-only/... relative key in bucket
    updated_at: new Date().toISOString()
  };

  const { error } = await supabase
    .from("examples")
    .upsert(patch, { onConflict: "task,example_id" });
  if (error) throw error;
}

// ========== main ==========
async function main() {
  const files = fs.readdirSync(JSON_ROOT).filter(f => f.endsWith(".json"));
  if (files.length === 0) {
    console.error(`No JSON files under ${JSON_ROOT}`);
    process.exit(1);
  }

  const indexes = buildImageIndexes(IMG_ROOT);
  const failures = [];

  for (const jf of files) {
    const task = path.parse(jf).name; // file name as task
    const raw = JSON.parse(fs.readFileSync(path.join(JSON_ROOT, jf), "utf8"));
    const entries = Array.isArray(raw)
      ? raw.map((item, idx) => [getExampleId(idx, null, item), item])
      : Object.entries(raw); // [exampleId, item]

    for (let i = 0; i < entries.length; i++) {
      const [maybeId, item] = entries[i];
      const exampleId = getExampleId(i, maybeId, item);

      try {
        let { local, storage } = resolveLocalChartPath(task, exampleId, item, indexes);

        let chartImagePath = null;
        let chartImageUrl = null;
        if (local) {
          if (!storage) {
            const rel = path.relative(IMG_ROOT, local).replace(/\\/g, "/");
            storage = `${STORAGE_PREFIX}/${rel}`;
          }
          chartImageUrl = await uploadAndGetPublicUrl(local, storage);
          chartImagePath = storage;
          await sleep(60); // light throttle to be nice to API
        }

        await upsertRow({ task, exampleId, obj: item, chartImagePath, chartImageUrl });

        console.log(
          `[OK] ${task}/${exampleId} ${chartImageUrl ? "-> " + chartImagePath : "(no chart image)"}`
        );

        if (i > 0 && i % 300 === 0) await sleep(1500);
      } catch (e) {
        const msg = e?.message || e?.status || e?.statusCode || String(e);
        failures.push({ task, exampleId, error: msg });
        console.error(`[FAIL] ${task}/${exampleId}: ${msg}`);
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
