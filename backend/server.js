const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3001;
const DATA_FILE = path.join(__dirname, "data", "results.txt");

app.use(cors());
app.use(express.json());

function ensureDataFile() {
  const dataDir = path.dirname(DATA_FILE);
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, "", "utf8");
  }
}

function readRecords() {
  ensureDataFile();
  const content = fs.readFileSync(DATA_FILE, "utf8");
  if (!content.trim()) {
    return [];
  }

  return content
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function isValidPayload(payload) {
  return (
    payload &&
    typeof payload.student === "string" &&
    payload.student.trim() !== "" &&
    typeof payload.level === "string" &&
    typeof payload.phase === "number" &&
    typeof payload.score === "number" &&
    typeof payload.totalQuestions === "number" &&
    typeof payload.percent === "number"
  );
}

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.get("/api/results", (_req, res) => {
  const records = readRecords();
  res.json(records);
});

app.post("/api/results", (req, res) => {
  if (!isValidPayload(req.body)) {
    return res.status(400).json({ message: "Payload invalido" });
  }

  ensureDataFile();

  const record = {
    timestamp: req.body.timestamp || new Date().toISOString(),
    student: req.body.student.trim(),
    level: req.body.level,
    phase: req.body.phase,
    score: req.body.score,
    totalQuestions: req.body.totalQuestions,
    percent: req.body.percent,
  };

  fs.appendFileSync(DATA_FILE, `${JSON.stringify(record)}\n`, "utf8");
  return res.status(201).json({ ok: true });
});

app.delete("/api/results", (_req, res) => {
  ensureDataFile();
  fs.writeFileSync(DATA_FILE, "", "utf8");
  res.json({ ok: true });
});

app.listen(PORT, () => {
  ensureDataFile();
  console.log(`API rodando em http://localhost:${PORT}`);
});
