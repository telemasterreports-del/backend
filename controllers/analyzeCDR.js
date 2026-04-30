const fs = require("fs");
const csv = require("csv-parser");

module.exports = (req, res) => {
  if (!req.file) {
    return res.status(400).json({ message: "No file uploaded" });
  }

  const fileMap = {};

  fs.createReadStream(req.file.path)
    .pipe(csv())
    .on("data", (row) => {
      const leadId = row["Lead ID"] || "UNKNOWN";
      const disposition = row["Dialer Disposition"]?.trim();

      if (!fileMap[leadId]) {
        fileMap[leadId] = {
          total: 0,
          connected: 0,
        };
      }

      fileMap[leadId].total++;

      if (disposition === "Answered By Agent") {
        fileMap[leadId].connected++;
      }
    })
    .on("end", () => {
      const report = Object.entries(fileMap).map(([leadId, data]) => {
        const connectivity =
          data.total === 0 ? 0 : (data.connected / data.total) * 100;

        return {
          leadId,
          connectivity: connectivity.toFixed(2) + "%",
        };
      });

      // optional: sort best to worst
      report.sort(
        (a, b) =>
          parseFloat(b.connectivity) - parseFloat(a.connectivity)
      );

      res.json({
        message: "CDR connectivity generated",
        report,
      });
    });
};