process.on("uncaughtException", (err) => {
  console.error("Uncaught Exception:", err);
});

process.on("unhandledRejection", (err) => {
  console.error("Unhandled Rejection:", err);
});

require("dotenv").config();

const express = require("express");
const cors = require("cors");
const path = require("path");
const connectDB = require("./config/db");

const app = express();

const upload = require("./middleware/upload");
const processCSV = require("./controllers/processCSV");
const analyzeCDR = require("./controllers/analyzeCDR");
const jobsController = require("./controllers/jobs");

connectDB();

// ✅ Middlewares
app.use(cors());
app.use(express.json());

// ✅ Serve output files (VERY IMPORTANT)
app.use("/outputs", express.static(path.join(__dirname, "outputs")));

// ✅ Routes
app.get("/", (req, res) => {
  res.json({ message: "API working 🚀" });
});

app.post("/api/upload", upload.single("file"), processCSV);
app.post(
  "/api/analyze",
  upload.single("file"),   // 🔥 THIS WAS MISSING
  (req, res, next) => {
    console.log("🔥 ANALYZE ROUTE HIT");
    next();
  },
  require("./controllers/analyzeCDR")
);
app.post("/api/agent-report", upload.fields([{ name: "cdrFile", maxCount: 1 }, { name: "agentFile", maxCount: 1 }]), require("./controllers/agentRep"));
app.get("/api/jobs", jobsController.listJobs);
app.get("/api/jobs/:id", jobsController.getJob);

// ✅ Server start
const PORT = process.env.PORT || 3001;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

