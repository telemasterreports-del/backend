// routes/upload.js
const express = require("express");
const router = express.Router();
const upload = require("../middleware/upload");
const processCSV = require("../controllers/processCSV");

router.post("/upload", upload.single("file"), processCSV);

router.post("/analyze", upload.single("file"), analyzeCDR);

router.post("/agent-report", upload.fields([{ name: "cdrFile", maxCount: 1 }, { name: "agentFile", maxCount: 1 }]), agentRep);

module.exports = router;