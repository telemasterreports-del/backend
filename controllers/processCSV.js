// controllers/processCSV.js
const fs = require("fs");
const path = require("path");
const csv = require("csv-parser");

const areaCodeMap = require("../utils/areaCodeMap.json");

module.exports = (req, res) => {
  if (!req.file) {
    return res.status(400).json({ message: "No file uploaded" });
  }

  const results = {
    EST: [],
    CST: [],
    PST: [],
    MST: [],
    HST: [],
    AKST: [],
    UNKNOWN: []
  };

  fs.createReadStream(req.file.path)
    .pipe(csv())
    .on("data", (row) => {
      try {
        if (!row.phone) {
          results.UNKNOWN.push(row);
          return;
        }

        const cleanPhone = String(row.phone).replace(/\D/g, "");

        if (cleanPhone.length < 10) {
          results.UNKNOWN.push(row);
          return;
        }

        const areaCode = cleanPhone.slice(-10, -7);
        const zone = areaCodeMap[areaCode] || "UNKNOWN";

        if (!results[zone]) results[zone] = [];

        results[zone].push(row);
      } catch (err) {
        console.error("Row error:", err);
        results.UNKNOWN.push(row);
      }
    })
    .on("end", () => {
      try {
        const outputDir = path.join(__dirname, "../outputs");

        if (!fs.existsSync(outputDir)) {
          fs.mkdirSync(outputDir);
        }

        const files = [];

        Object.entries(results).forEach(([zone, rows]) => {
          if (!rows.length) return;

          const fileName = `${zone}-${Date.now()}.csv`;
          const filePath = path.join(outputDir, fileName);

          const headers = Object.keys(rows[0]).join(",") + "\n";
          const data = rows
            .map((obj) => Object.values(obj).join(","))
            .join("\n");

          fs.writeFileSync(filePath, headers + data);

          // ✅ send file info to frontend
          files.push({
            zone,
            fileName,
            url: `/outputs/${fileName}`
          });
        });

        res.json({
          message: "Files split successfully",
          summary: Object.fromEntries(
            Object.entries(results).map(([k, v]) => [k, v.length])
          ),
          files // ✅ important
        });
      } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Error writing files" });
      }
    })
    .on("error", (err) => {
      console.error(err);
      res.status(500).json({ message: "Error reading CSV" });
    });
};

