import { createClient } from "@supabase/supabase-js";
import JSZip from "jszip";

// Supabase client (frontend uses the anon key)
const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);

// expose for console debugging if you want
if (typeof window !== "undefined") window.__supabase = supabase;

const BUCKET = import.meta.env.VITE_SUPABASE_BUCKET || "charts";
const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
const norm = (s) => (s || "").trim().toLowerCase();

// ---------- Helpers ----------
function pick(obj, keys) {
  for (const k of keys) {
    const v = k.split(".").reduce((o, key) => (o ? o[key] : undefined), obj);
    if (v !== undefined && v !== null) return v;
  }
  return null;
}

/** Normalize various option shapes to: [{label:'A', text:'...'}, ...] */
function normalizeOptions(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) {
    const texts = Array.from(new Set(
      raw.map(x =>
        typeof x === "string" ? x : (x?.text ?? x?.label ?? x?.value ?? x?.answer ?? "")
      ).map(String).map(s => s.trim()).filter(Boolean)
    ));
    return texts.map((t, i) => ({ label: LETTERS[i] || String(i + 1), text: t }));
  }
  if (typeof raw === "string") {
    const texts = raw.split(/[\n|;,]/g).map(s => s.trim()).filter(Boolean);
    return texts.map((t, i) => ({ label: LETTERS[i] || String(i + 1), text: t }));
  }
  if (typeof raw === "object") {
    const keys = Object.keys(raw);
    const looksLetters = keys.every(k => /^[A-Z]$/.test(k));
    const arr = looksLetters
      ? keys.sort().map(k => [k, raw[k]])
      : keys.map((k, i) => [LETTERS[i] || String(i + 1), raw[k]]);
    return arr
      .map(([L, v]) => ({ label: L, text: String(v ?? "").trim() }))
      .filter(x => x.text);
  }
  return [];
}

/** Image URL resolver: try public URL first, fallback to signed URL */
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

// ---------- Task list ----------
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
    data.forEach(r => r.task && tasks.add(r.task.trim()));
    if (data.length < page) break;
    from += page; to += page;
  }
  return { tasks: Array.from(tasks) };
}

// ---------- Stats ----------
export async function getStats(task) {
  const t = norm(task);
  const countWhere = async (fn) => {
    let q = supabase.from("examples").select("example_id", { count: "exact", head: true }).ilike("task", t);
    if (fn) q = fn(q);
    const { count, error } = await q;
    if (error) throw error;
    return count ?? 0;
  };
  const [total, answered, missing, remaining] = await Promise.all([
    countWhere(),
    countWhere(q => q.not("human_prediction", "is", null)),
    countWhere(q => q.is("missing_information", true)),
    countWhere(q => q.is("human_prediction", null).not("missing_information", "is", true)),
  ]);
  return { total, answered, missing, remaining };
}

// ---------- Fetch the first unannotated example (with context & options) ----------
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

  // prefer context_marked if present, then fall back to other names
  let context = pick(ex, [
    "context_marked", "metadata.context_marked",
    "context", "passage", "paragraph", "caption", "ocr_text",
    "metadata.context", "metadata.passage", "metadata.paragraph",
    "metadata.caption", "metadata.ocr_text"
  ]);
  if (Array.isArray(context)) context = context.join("\n");
  context = (context ?? "").toString();
  

  const optionsRaw = pick(ex, [
    "options","choices","candidates","answers","candidate_answers",
    "answer_choices","options_list","metadata.options","metadata.choices","metadata.answers"
  ]);
  const options = normalizeOptions(optionsRaw);

  const image_url = await resolveImageURL(row);

  return {
    example: {
      exampleId: row.example_id,
      question,
      context,
      options,      // [{label:'A', text:'...'}]
      image_url,
      raw: ex
    }
  };
}

// ---------- Submit annotation (options=letter; freeform=string) ----------
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

// ---------- Export: all samples for a task ----------
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
    if (!row.missing_information && row.human_prediction != null) obj.human_prediction = row.human_prediction;
    else delete obj.human_prediction;
    out[row.example_id] = obj;
  }
  const blob = new Blob([JSON.stringify(out, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = `${t}.json`; a.click();
  URL.revokeObjectURL(url);
}

// ---------- Export: only completed (answered or marked missing) ----------
export async function exportTaskCompleted(task) {
  const t = norm(task);
  const { data, error } = await supabase
    .from("examples")
    .select("example_id, json_blob, human_prediction, missing_information")
    .ilike("task", t)
    .or("missing_information.eq.true,human_prediction.not.is.null")
    .order("example_id", { ascending: true });
  if (error) { alert(error.message); return; }

  const out = {};
  for (const row of data) {
    const obj = { ...(row.json_blob || {}) };
    obj.missing_information = !!row.missing_information;
    if (!row.missing_information && row.human_prediction != null) obj.human_prediction = row.human_prediction;
    else delete obj.human_prediction;
    out[row.example_id] = obj;
  }
  const blob = new Blob([JSON.stringify(out, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = `${t}_completed.json`; a.click();
  URL.revokeObjectURL(url);
}

// ---------- Export: completed for all tasks as a ZIP ----------
export async function exportAllCompletedZip(tasks = null) {
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
        if (!row.missing_information && row.human_prediction != null) obj.human_prediction = row.human_prediction;
        else delete obj.human_prediction;
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

// Debug helper
export async function dbgCounts(task) {
  const s = await getStats(task);
  console.log("STATS", task, s);
  return s;
}
if (typeof window !== "undefined") window.dbgCounts = dbgCounts;


export async function updateQuestion({ task, exampleId, newQuestion, raw }) {
  const t = norm(task);
  const q = (newQuestion ?? "").toString().trim();
  if (!q) return { error: "Question cannot be empty." };

  // merge into existing json_blob
  const newBlob = { ...(raw || {}) };
  newBlob.question = q;
  if (newBlob.metadata && typeof newBlob.metadata === "object") {
    newBlob.metadata = { ...newBlob.metadata, question: q };
  }

  const patch = {
    question: q,
    json_blob: newBlob,
    updated_at: new Date().toISOString(),
  };

  const { error } = await (window.__supabase || supabase)
    .from("examples")
    .update(patch)
    .ilike("task", t)
    .eq("example_id", exampleId);

  if (error) return { error: error.message };
  return { ok: true, json_blob: newBlob, question: q };
}
