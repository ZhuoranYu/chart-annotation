// server/storage.js
import fs from "fs";
import path from "path";

const tasks = new Map(); 
// 结构：taskName -> {
//   path: "/abs/.../task.json",
//   original: <原始JSON对象>,
//   working:  <可写副本（与original键结构一致）>,
//   order:    <exampleId数组，用于顺序遍历>,
//   submitted:Set<exampleId>
// }

// 尝试从对象中“推断”图片URL的字段名
function detectImageURL(obj) {
  return (
    obj.image ||
    obj.img ||
    obj.image_url ||
    obj.imageUrl ||
    (obj.metadata && (obj.metadata.image || obj.metadata.image_url || obj.metadata.imageUrl)) ||
    null
  );
}

export async function loadAllTasks(dir) {
  const files = fs.readdirSync(dir).filter(f => f.endsWith(".json"));
  for (const f of files) {
    const full = path.join(dir, f);
    const raw = JSON.parse(fs.readFileSync(full, "utf8"));

    // 假设你的 JSON 是 “对象风格”：顶层每个 key 对应一个 example
    // 例如：{ "bar-0": { question: "...", ... }, "bar-1": {...} }
    const keys = Object.keys(raw);

    // working 是 deep copy，后续在此上加字段 human_prediction / missing_information
    const working = JSON.parse(JSON.stringify(raw));

    tasks.set(path.parse(f).name, {
      path: full,
      original: raw,
      working,
      order: keys,
      submitted: new Set()
    });
  }
}

export function getTasks() {
  return Array.from(tasks.keys());
}

// after：可选，上一次 exampleId；用于拿下一条
export function getNextExample(task, after) {
  const t = tasks.get(task);
  if (!t) return null;
  const { order, working, submitted } = t;

  let idx = 0;
  if (after) {
    const i = order.indexOf(after);
    if (i >= 0) idx = i + 1;
  }
  while (idx < order.length && submitted.has(order[idx])) idx++;
  if (idx >= order.length) return null;

  const id = order[idx];
  const ex = working[id];

  // UI 需要的一些字段：exampleId, question, image_url
  return {
    exampleId: id,
    question: ex.question ?? ex.metadata?.question ?? "",
    image_url: detectImageURL(ex),
    raw: ex, // 若需在前端调试其它字段可显示/调试
  };
}

export function submitAnnotation({ task, exampleId, missing_information, human_prediction }) {
  const t = tasks.get(task);
  if (!t) return false;
  const ex = t.working[exampleId];
  if (!ex) return false;

  // 仅追加字段；不破坏其它结构
  ex.missing_information = !!missing_information;
  if (!missing_information) {
    ex.human_prediction = human_prediction;
  } else {
    // 明确没有答案时，移除 human_prediction（或置空）
    delete ex.human_prediction;
  }

  t.submitted.add(exampleId);

  // 每次提交都落盘一个“工作副本”快照（同名 .working.json），方便容灾/断点续标
  const snapPath = t.path.replace(/\.json$/, ".working.json");
  fs.writeFileSync(snapPath, JSON.stringify(t.working, null, 2));
  return true;
}

// 导出：在 current working 基础上返回（结构与原始相同，仅多了我们加的字段）
export function exportTask(task) {
  const t = tasks.get(task);
  if (!t) return null;
  // 直接返回 working（就是“原结构+新增字段”）
  return t.working;
}
