// src/api.js
import { createClient } from "@supabase/supabase-js";
import JSZip from "jszip";

// ---- Supabase client（前端用 anon key） ----
const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);

// 调试口
if (typeof window !== "undefined") window.__supabase = supabase;

const norm = (s) => (s || "").trim().toLowerCase();
const BUCKET = import.meta.env.VITE_SUPABASE_BUCKET || "charts";

// ---------- 小工具 ----------
function pick(obj, keys) {
  for (const k of keys) {
    const v = k.split(".").reduce((o, key) => (o ? o[key] : undefined), obj);
    if (v !== undefined && v !== null) return v;
  }
  return null;
}
const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
function normalizeOptions(raw) {
  if (!raw) return [];
  // 统一转成 [{label:'A', text:'...'}, ...]
  let texts = [];
  if (Array.isArray(raw)) {
    texts = raw.map(x =>
      typeof x === "string" ? x : (x?.text ?? x?.label ?? x?.value ?? x?.answer ?? "")
    );
  } else if (typeof raw === "string") {
    texts = raw.split(/[\n|;,]/g);
  } else if (typeof raw === "object") {
    const keys = Object.keys(raw);
    const looksLikeLetters = keys.every(k => /^[A-Z]$/.test(k));
    const arr = looksLikeLetters
      ? keys.sort().map(k => [k, raw[k]])
      : keys.map((k, i) => [LETTERS[i] || String(i + 1), raw[k]]);
    return arr
      .map(([L, v]) => String(v ?? "").trim())
      .filter(Boolean)
      .map((t, i) => ({ label: (arr[i][0] || LETTERS[i] || String(i + 1)), text: t }));
  }
  const uniq = Array.from(new Set(texts.map(s => String(s).trim()).filter(Boolean)));
  return uniq.map((t, i) => ({ label: LETTERS[i] || String(i + 1), text: t }));
}

// ---- 图片 URL：先 public，再签名兜底 ----
async function resolveImageURL(row) {
  const ex = row?.json_blob || {};
  if (ex.pdf_image_url) return ex.pdf_image_url;

  const key = row?.image_path?.replace(/^\/+/, "");
  if (!key) return null;

  const pub = supabase.storage.from(BUCKET).getPublicUrl(key).data?.publicUrl;
  if (pub) return pub;

  const s = await supabase.storage.from(BUCKET).createSignedUrl(key, 60 * 60 * 24 * 7);
  return s.data?.signedUrl || null;
}

// ---- 任务列表 ----
export async function fetchTasks() {
  const tasks = new Set();
  const page = 1000;
  let from = 0, to = page - 1;

  for (;;) {
    const { data, error } = await supabase
      .from("examples")
      .select("task")
      .order("task", { ascending: true })
      .range(from, to);

    if (error) throw error;
    if (!data?.length) break;

    data.forEach(r => { if (r.task) tasks.add(r.task.trim()); });

    if (data.length < page) break;
    from += page; to += page;
  }

  return { tasks: Array.from(tasks) };
}

// ---- 统计 ----
export async function getStats(task) {
  const t = norm(task);

  const countWhere = async (fn) => {
    let q = supabase
      .from("examples")
      .select("example_id", { count: "exact", head: true })
      .ilike("task", t);
    if (fn) q = fn(q);
    const { count, error } = await q;
    if (error) throw error;
    return count ?? 0;
  };

  const [total, answered, missing, remaining] = await Promise.all([
    countWhere(),
    countWhere(q => q.not("human_prediction", "is", null)),
    countWhere(q => q.is("missing_information", true)),
    countWhere(q => q.is("human_prediction", null)
                    .not("missing_information", "is", true)),
  ]);

  return { total, answered, missing, remaining };
}

// ---- 取“第一条未标注可做的样例”（带 options，字母标签） ----
export async function fetchExample(task) {
  const t = norm(task);
  const { data, error } = await supabase
    .from("examples")
    .select("example_id, json_blob, image_path")
    .ilike("task", t)
    .is("human_prediction", null)
    .not("missing_information", "is", true)
    .order("example_id", { ascending: true })
    .limit(1);

  if (error) throw error;
  if (!data?.length) return { example: null };

  const row = data[0];
  const ex = row.json_blob || {};
  const question = pick(ex, ["question", "metadata.question"]);
  const optionsRaw = pick(ex, [
    "options","choices","candidates","answers",
    "candidate_answers","answer_choices","options_list",
    "metadata.options","metadata.choices","metadata.answers"
  ]);
  const options = normalizeOptions(optionsRaw);
  const image_url = await resolveImageURL(row);

  return {
    example: {
      exampleId: row.example_id,
      question,
      options,      // [{label:'A', text:'...'}]
      image_url,
      raw: ex
    }
  };
}

// ---- 提交标注（选项=字母；自由答案=原样字符串） ----
export async function submitAnnotation({ task, exampleId, missing_information, human_prediction }) {
  const t = norm(task);

  if (!missing_information && (!human_prediction || !human_prediction.trim())) {
    return { error: "human_prediction required when not missing_information" };
  }

  const patch = {
    missing_information: !!missing_information,
    human_prediction: missing_information ? null : human_prediction.trim(),
    updated_at: new Date().toISOString(),
  };

  const { error } = await supabase
    .from("examples")
    .update(patch)
    .ilike("task", t)
    .eq("example_id", exampleId);

  if (error) return { error: error.message };
  return { ok: true };
}

// ---- 导出：全部样本（原来就有） ----
export async function exportTask(task) {
  const t = norm(task);
  const { data, error } = await supabase
    .from("examples")
    .select("example_id, json_blob, human_prediction, missing_information")
    .ilike("task", t)
    .order("example_id", { ascending: true });

  if (error) { alert(error.message); return; }

  const out = {};
  for (const row of data) {
    const obj = { ...(row.json_blob || {}) };
    obj.missing_information = !!row.missing_information;
    if (!row.missing_information && row.human_prediction != null) {
      obj.human_prediction = row.human_prediction;
    } else {
      delete obj.human_prediction;
    }
    out[row.example_id] = obj;
  }

  const blob = new Blob([JSON.stringify(out, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = `${t}.json`; a.click();
  URL.revokeObjectURL(url);
}

// ---- ✅ 新增：导出“已完成样本”（当前 task） ----
export async function exportTaskCompleted(task) {
  const t = norm(task);
  const { data, error } = await supabase
    .from("examples")
    .select("example_id, json_blob, human_prediction, missing_information")
    .ilike("task", t)
    .or("missing_information.eq.true,human_prediction.not.is.null")  // 完成条件
    .order("example_id", { ascending: true });

  if (error) { alert(error.message); return; }

  const out = {};
  for (const row of data) {
    const obj = { ...(row.json_blob || {}) };
    obj.missing_information = !!row.missing_information;
    if (!row.missing_information && row.human_prediction != null) {
      obj.human_prediction = row.human_prediction;
    } else {
      delete obj.human_prediction;
    }
    out[row.example_id] = obj;
  }

  const blob = new Blob([JSON.stringify(out, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = `${t}_completed.json`; a.click();
  URL.revokeObjectURL(url);
}

// ---- ✅ 新增：一次性导出所有 task 的“已完成样本”为 ZIP ----
export async function exportAllCompletedZip(tasks = null) {
  // 获取所有任务名
  let taskList = tasks;
  if (!taskList) {
    const { tasks: ts } = await fetchTasks();
    taskList = ts;
  }

  const zip = new JSZip();
  const folder = zip.folder("completed");

  for (const task of taskList) {
    const t = norm(task);
    const { data, error } = await supabase
      .from("examples")
      .select("example_id, json_blob, human_prediction, missing_information")
      .ilike("task", t)
      .or("missing_information.eq.true,human_prediction.not.is.null")
      .order("example_id", { ascending: true });

    if (error) continue;

    if (data && data.length) {
      const out = {};
      for (const row of data) {
        const obj = { ...(row.json_blob || {}) };
        obj.missing_information = !!row.missing_information;
        if (!row.missing_information && row.human_prediction != null) {
          obj.human_prediction = row.human_prediction;
        } else {
          delete obj.human_prediction;
        }
        out[row.example_id] = obj;
      }
      folder.file(`${t}.json`, JSON.stringify(out, null, 2));
    }
  }

  const blob = await zip.generateAsync({ type: "blob" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = `completed_${new Date().toISOString().slice(0,19).replace(/[:T]/g,'-')}.zip`;
  a.click();
  URL.revokeObjectURL(url);
}

// 调试
export async function dbgCounts(task) {
  const s = await getStats(task);
  console.log("STATS", task, s);
  return s;
}
if (typeof window !== "undefined") window.dbgCounts = dbgCounts;
