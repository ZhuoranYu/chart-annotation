// server/index.js
import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import { loadAllTasks, getTasks, getNextExample, submitAnnotation, exportTask } from "./storage.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json({ limit: "10mb" }));

// 启动时一次性加载 server/data 下的所有 JSON 文件
await loadAllTasks(path.join(__dirname, "data"));

// 1) 列出可选 task（文件名去后缀）
app.get("/api/tasks", (req, res) => {
  res.json({ tasks: getTasks() });
});

// 2) 取一个待标注 example（按task）；支持 ?after=<exampleId> 拉下一条
app.get("/api/examples", (req, res) => {
  const { task, after } = req.query;
  if (!task) return res.status(400).json({ error: "task is required" });
  const ex = getNextExample(task, after);
  if (!ex) return res.json({ example: null }); // 没有更多了
  res.json({ example: ex });
});

// 3) 提交标注：必须带 exampleId, task, missing_information(bool), human_prediction(可空)
app.post("/api/submit", (req, res) => {
  const { task, exampleId, missing_information, human_prediction } = req.body || {};
  if (!task || !exampleId || typeof missing_information !== "boolean") {
    return res.status(400).json({ error: "task, exampleId, missing_information are required" });
  }
  // 若未勾选 missing_information，则必须有人类答案
  if (!missing_information && (!human_prediction || String(human_prediction).trim() === "")) {
    return res.status(400).json({ error: "human_prediction required when not missing_information" });
  }
  const ok = submitAnnotation({ task, exampleId, missing_information, human_prediction });
  if (!ok) return res.status(404).json({ error: "example not found" });
  res.json({ ok: true });
});

// 4) 导出带有 human_prediction 的完整 JSON（结构与原始相同，仅多一个字段）
app.get("/api/export", (req, res) => {
  const { task } = req.query;
  if (!task) return res.status(400).json({ error: "task is required" });
  const payload = exportTask(task);
  if (!payload) return res.status(404).json({ error: "task not found" });
  res.setHeader("Content-Disposition", `attachment; filename="${task}.json"`);
  res.json(payload);
});

const PORT = process.env.PORT || 5174;
app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
