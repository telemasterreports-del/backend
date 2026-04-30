const express = require("express");
const cors = require("cors");
const path = require("path");

const app = express();

const upload = require("./middleware/upload");
const processCSV = require("./controllers/processCSV");
const analyzeCDR = require("./controllers/analyzeCDR");

// ✅ Middlewares
app.use(cors());
app.use(express.json());

// ✅ Serve output files (VERY IMPORTANT)
app.use("/outputs", express.static(path.join(__dirname, "outputs")));

// ✅ Routes
app.get("/", (req, res) => {
  res.json({ message: "API working 🚀" });
});

app.post("/upload", upload.single("file"), processCSV);
app.post("/analyze", upload.single("file"), analyzeCDR);
app.post("/agent-report", upload.fields([{ name: "cdrFile", maxCount: 1 }, { name: "agentFile", maxCount: 1 }]), require("./controllers/agentRep"));

// ✅ Server start
const PORT = 5000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});