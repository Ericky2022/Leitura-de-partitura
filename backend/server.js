const express = require("express");
const cors = require("cors");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const zlib = require("zlib");

const app = express();
const PORT = process.env.PORT || 3001;
const DATA_FILE = path.join(__dirname, "data", "results.txt");
const PDF_LIMIT = "30mb";

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

app.post(
  "/api/score-reader/convert-pdf",
  express.raw({ type: ["application/pdf", "application/octet-stream"], limit: PDF_LIMIT }),
  async (req, res) => {
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
      return res.status(400).json({ message: "PDF nao enviado." });
    }

    const audiverisCommand = findAudiverisCommand();
    if (!audiverisCommand) {
      return res.status(501).json({
        message:
          "Audiveris nao encontrado. Instale o Audiveris ou configure AUDIVERIS_CMD com o caminho do executavel.",
      });
    }

    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "score-reader-"));
    const inputPath = path.join(workDir, "partitura.pdf");
    const outputDir = path.join(workDir, "out");

    fs.mkdirSync(outputDir, { recursive: true });
    fs.writeFileSync(inputPath, req.body);

    try {
      await runAudiveris(audiverisCommand, inputPath, outputDir);
      const musicXmlPath =
        findFirstFile(outputDir, ".xml") || findFirstFile(outputDir, ".mxl");

      if (!musicXmlPath) {
        return res.status(422).json({
          message:
            "O PDF foi processado, mas nenhum MusicXML foi gerado. Tente um PDF de partitura mais limpo ou exporte MusicXML pelo editor de partitura.",
        });
      }

      res.json({
        fileName: path.basename(musicXmlPath),
        musicXml: readMusicXmlFile(musicXmlPath),
      });
    } catch (error) {
      res.status(500).json({
        message:
          error && error.message
            ? error.message
            : "Nao foi possivel converter o PDF.",
      });
    } finally {
      fs.rmSync(workDir, { recursive: true, force: true });
    }
  },
);

app.delete("/api/results", (_req, res) => {
  ensureDataFile();
  fs.writeFileSync(DATA_FILE, "", "utf8");
  res.json({ ok: true });
});

app.listen(PORT, () => {
  ensureDataFile();
  console.log(`API rodando em http://localhost:${PORT}`);
});

function findAudiverisCommand() {
  if (process.env.AUDIVERIS_CMD) {
    return process.env.AUDIVERIS_CMD;
  }

  const candidates = [
    "audiveris",
    "Audiveris",
    "C:\\Program Files\\Audiveris\\bin\\Audiveris.exe",
    "C:\\Program Files\\Audiveris\\bin\\Audiveris.bat",
  ];

  return candidates.find((candidate) => {
    if (!candidate.includes("\\") && !candidate.includes("/")) {
      return true;
    }

    return fs.existsSync(candidate);
  });
}

function runAudiveris(command, inputPath, outputDir) {
  const args = [
    "-batch",
    "-transcribe",
    "-export",
    "-constant",
    "org.audiveris.omr.sheet.BookManager.useCompression=false",
    "-output",
    outputDir,
    "--",
    inputPath,
  ];

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      windowsHide: true,
    });
    let stderr = "";
    let stdout = "";
    const timeout = setTimeout(() => {
      child.kill();
      reject(
        new Error(
          "A conversao demorou demais e foi interrompida. Tente um PDF menor.",
        ),
      );
    }, 180000);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", () => {
      clearTimeout(timeout);
      reject(
        new Error(
          "Audiveris nao conseguiu iniciar. Verifique a instalacao ou AUDIVERIS_CMD.",
        ),
      );
    });

    child.on("close", (code) => {
      clearTimeout(timeout);

      if (code === 0) {
        resolve();
        return;
      }

      reject(
        new Error(
          `Audiveris retornou erro ${code}. ${stderr || stdout || "Sem detalhes."}`,
        ),
      );
    });
  });
}

function findFirstFile(dir, extension) {
  if (!fs.existsSync(dir)) {
    return null;
  }

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      const found = findFirstFile(fullPath, extension);
      if (found) return found;
      continue;
    }

    if (entry.isFile() && entry.name.toLowerCase().endsWith(extension)) {
      return fullPath;
    }
  }

  return null;
}

function readMusicXmlFile(filePath) {
  if (filePath.toLowerCase().endsWith(".xml")) {
    return fs.readFileSync(filePath, "utf8");
  }

  const content = fs.readFileSync(filePath);
  const xml = readFirstXmlFromZip(content);

  if (!xml) {
    throw new Error("O arquivo MXL gerado nao contem MusicXML legivel.");
  }

  return xml;
}

function readFirstXmlFromZip(buffer) {
  let offset = 0;

  while (offset < buffer.length - 30) {
    if (buffer.readUInt32LE(offset) !== 0x04034b50) {
      offset++;
      continue;
    }

    const compression = buffer.readUInt16LE(offset + 8);
    const compressedSize = buffer.readUInt32LE(offset + 18);
    const fileNameLength = buffer.readUInt16LE(offset + 26);
    const extraLength = buffer.readUInt16LE(offset + 28);
    const nameStart = offset + 30;
    const dataStart = nameStart + fileNameLength + extraLength;
    const dataEnd = dataStart + compressedSize;
    const fileName = buffer.toString("utf8", nameStart, nameStart + fileNameLength);

    if (dataEnd > buffer.length) {
      break;
    }

    if (fileName.toLowerCase().endsWith(".xml") && !fileName.includes("container.xml")) {
      const compressed = buffer.subarray(dataStart, dataEnd);

      if (compression === 0) {
        return compressed.toString("utf8");
      }

      if (compression === 8) {
        return zlib.inflateRawSync(compressed).toString("utf8");
      }
    }

    offset = dataEnd;
  }

  return null;
}
