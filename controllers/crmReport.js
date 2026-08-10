const fs = require("fs");
const path = require("path");
const csv = require("csv-parser");
const XLSX = require("xlsx");
const mongoose = require("mongoose");
const crypto = require("crypto");
const LeadPerformance = require("../models/LeadPerformance");
const connectDB = require("../config/db");

const CONNECTED_DISPOSITIONS = new Set([
  "answered by agent",
  "answered",
  "connected",
]);

const clean = (value) => String(value ?? "").trim();

const buildReport = (rows) => {
  const groups = new Map();
  const leads = new Set();
  const agents = new Set();
  const dispositionTotals = new Map();

  rows.forEach((row) => {
    const lead = clean(row.Lead || row["Lead ID"]);
    if (!lead) return;

    const agent = clean(row["Agent Name"] || row.Agent) || "Unassigned";
    const disposition =
      clean(row["Dialer Disposition"] || row.Disposition) || "No Disposition";
    const key = `${lead}\u0000${agent}`;

    if (!groups.has(key)) {
      groups.set(key, {
        lead,
        agent,
        totalCalls: 0,
        connectedCalls: 0,
        dispositions: {},
      });
    }

    const group = groups.get(key);
    group.totalCalls += 1;
    group.dispositions[disposition] =
      (group.dispositions[disposition] || 0) + 1;

    if (CONNECTED_DISPOSITIONS.has(disposition.toLowerCase())) {
      group.connectedCalls += 1;
    }

    leads.add(lead);
    agents.add(agent);
    dispositionTotals.set(
      disposition,
      (dispositionTotals.get(disposition) || 0) + 1
    );
  });

  const dispositions = [...dispositionTotals.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([name]) => name);

  return {
    leads: [...leads].sort((a, b) => a.localeCompare(b)),
    agents: [...agents].sort((a, b) => a.localeCompare(b)),
    dispositions,
    records: [...groups.values()].sort(
      (a, b) =>
        b.totalCalls - a.totalCalls ||
        a.lead.localeCompare(b.lead) ||
        a.agent.localeCompare(b.agent)
    ),
  };
};

const readCsv = (filePath) =>
  new Promise((resolve, reject) => {
    const rows = [];
    fs.createReadStream(filePath)
      .pipe(csv())
      .on("data", (row) => rows.push(row))
      .on("end", () => resolve(rows))
      .on("error", reject);
  });

module.exports = async (req, res) => {
  const filePath = req.file?.path;

  if (!filePath) {
    return res.status(400).json({ message: "No CRM file uploaded" });
  }

  try {
    const extension = path.extname(req.file.originalname).toLowerCase();
    let rows;

    if (extension === ".xlsx" || extension === ".xls") {
      const workbook = XLSX.readFile(filePath, {
        cellDates: false,
        dense: true,
      });
      const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
      rows = XLSX.utils.sheet_to_json(firstSheet, {
        defval: "",
        raw: false,
      });
    } else if (extension === ".csv") {
      rows = await readCsv(filePath);
    } else {
      return res.status(400).json({
        message: "Unsupported file type. Upload a CSV, XLSX, or XLS file.",
      });
    }

    const report = buildReport(rows);

    if (!report.records.length) {
      return res.status(400).json({
        message:
          "No CRM rows were found. Expected Lead (or Lead ID) and Dialer Disposition headers.",
      });
    }

    let historySaved = false;
    if (mongoose.connection.readyState !== 1) await connectDB();
    if (mongoose.connection.readyState === 1) {
      const uploadId = crypto.randomUUID();
      const requestedDate = clean(req.body?.usedAt);
      const usedAt = /^\d{4}-\d{2}-\d{2}$/.test(requestedDate)
        ? new Date(`${requestedDate}T12:00:00.000Z`)
        : new Date();
      const leadTotals = new Map();

      report.records.forEach((row) => {
        if (!leadTotals.has(row.lead)) {
          leadTotals.set(row.lead, {
            totalCalls: 0,
            connectedCalls: 0,
            dispositions: {},
          });
        }
        const total = leadTotals.get(row.lead);
        total.totalCalls += row.totalCalls;
        total.connectedCalls += row.connectedCalls;
        Object.entries(row.dispositions).forEach(([name, count]) => {
          total.dispositions[name] = (total.dispositions[name] || 0) + count;
        });
      });

      await LeadPerformance.insertMany(
        [...leadTotals.entries()].map(([lead, total]) => ({
          uploadId,
          lead,
          totalCalls: total.totalCalls,
          connectivity: total.totalCalls
            ? Number(
                ((total.connectedCalls / total.totalCalls) * 100).toFixed(2)
              )
            : 0,
          usedAt,
        }))
      );
      historySaved = true;
    }

    return res.json({
      message: "CRM report generated",
      sourceRows: rows.length,
      historySaved,
      ...report,
    });
  } catch (error) {
    console.error("CRM report error:", error);
    return res.status(500).json({ message: "Error generating CRM report" });
  } finally {
    fs.promises.unlink(filePath).catch(() => {});
  }
};
