const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

const app = express();
const PORT = process.env.PORT || 3000;

const ROOT = __dirname;
const UPLOAD_DIR = path.join(ROOT, "uploads");
const DATA_DIR = path.join(ROOT, "data");
const CASES_FILE = path.join(DATA_DIR, "cases.json");

fs.mkdirSync(UPLOAD_DIR, { recursive: true });
fs.mkdirSync(DATA_DIR, { recursive: true });

function loadCases() {
  try {
    const raw = fs.readFileSync(CASES_FILE, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveCases(cases) {
  fs.writeFileSync(CASES_FILE, JSON.stringify(cases, null, 2), "utf8");
}

let cases = loadCases();

function normalizeId(id) {
  return String(id || "").trim().toLowerCase();
}

function normalizeName(name) {
  return String(name || "").trim().toLowerCase();
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const unique = `${Date.now()}-${crypto.randomBytes(8).toString("hex")}`;
    const safeOriginal = path.basename(file.originalname).replace(/[^\w.\-]+/g, "_");
    cb(null, `${unique}-${safeOriginal}`);
  },
});

function pdfOnly(_req, file, cb) {
  const isPdfMime = file.mimetype === "application/pdf";
  const isPdfExt = path.extname(file.originalname).toLowerCase() === ".pdf";
  if (isPdfMime && isPdfExt) {
    cb(null, true);
  } else {
    cb(new Error("Only PDF files are allowed."));
  }
}

const upload = multer({
  storage,
  fileFilter: pdfOnly,
  limits: {
    files: 10,
    fileSize: 15 * 1024 * 1024,
  },
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(ROOT, "public")));

app.post("/api/cases", (req, res) => {
  upload.array("pdfs", 10)(req, res, (err) => {
    if (err) {
      const message =
        err instanceof multer.MulterError
          ? err.code === "LIMIT_FILE_COUNT"
            ? "You can upload at most 10 PDF files."
            : err.message
          : err.message || "Upload failed.";
      return res.status(400).json({ ok: false, error: message });
    }

    const patientName = String(req.body.patientName || "").trim();
    const patientId = String(req.body.patientId || "").trim();
    const patientAge = String(req.body.patientAge || "").trim();
    const medicalInfo = String(req.body.medicalInfo || "").trim();
    const doctorName = String(req.body.doctorName || "Dr. Sarah Chen").trim();

    if (!patientName || !patientId || !patientAge) {
      return res.status(400).json({
        ok: false,
        error: "Patient name, ID, and age are required.",
      });
    }

    const ageNumber = Number(patientAge);
    if (!Number.isFinite(ageNumber) || ageNumber < 0 || ageNumber > 130) {
      return res.status(400).json({ ok: false, error: "Enter a valid patient age." });
    }

    const files = (req.files || []).map((file) => ({
      originalName: file.originalname,
      storedName: file.filename,
      size: file.size,
    }));

    const record = {
      id: crypto.randomUUID(),
      patientName,
      patientId,
      patientAge: ageNumber,
      medicalInfo,
      doctorName,
      files,
      status: "Waiting for insurance to review",
      submittedAt: new Date().toISOString(),
    };

    const existingIndex = cases.findIndex(
      (item) => normalizeId(item.patientId) === normalizeId(patientId)
    );
    if (existingIndex >= 0) {
      cases[existingIndex] = record;
    } else {
      cases.push(record);
    }
    saveCases(cases);

    return res.json({
      ok: true,
      message: "Case submitted successfully.",
      case: publicCase(record),
    });
  });
});

function publicCase(record) {
  return {
    patientName: record.patientName,
    patientId: record.patientId,
    patientAge: record.patientAge,
    medicalInfo: record.medicalInfo,
    doctorName: record.doctorName,
    files: (record.files || []).map((file) => ({
      originalName: file.originalName,
      size: file.size,
    })),
    status: record.status,
    submittedAt: record.submittedAt,
  };
}

app.post("/api/patient/status", (req, res) => {
  const patientName = normalizeName(req.body.patientName);
  const patientId = normalizeId(req.body.patientId);

  if (!patientName || !patientId) {
    return res.status(400).json({
      ok: false,
      error: "Patient name and ID are required.",
    });
  }

  const found = cases.find(
    (item) =>
      normalizeId(item.patientId) === patientId &&
      normalizeName(item.patientName) === patientName
  );

  if (!found) {
    return res.status(404).json({
      ok: false,
      error: "No case found for that patient name and ID.",
    });
  }

  return res.json({ ok: true, case: publicCase(found) });
});

app.use((err, _req, res, _next) => {
  if (err && err.type === "entity.parse.failed") {
    return res.status(400).json({ ok: false, error: "Invalid JSON body." });
  }
  console.error(err);
  res.status(500).json({ ok: false, error: "Server error." });
});

app.listen(PORT, () => {
  console.log(`Medical Case Portal running at http://localhost:${PORT}`);
});
