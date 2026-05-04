const csv = require("csv-parser");
const s3 = require("../config/s3");

module.exports = (req, res) => {
  console.log("🔥 ANALYZE STREAM STARTED");

  // 🔥 support all upload formats (single + multiple)
  const fileKey =
    req.file?.key ||
    req.files?.file?.[0]?.key ||
    req.files?.cdrFile?.[0]?.key;

  if (!fileKey) {
    return res.status(400).json({ message: "No file uploaded" });
  }

  const fileMap = {};

  // 🔥 S3 stream (same as your other controllers)
  const stream = s3
    .getObject({
      Bucket: process.env.S3_BUCKET_NAME,
      Key: fileKey,
    })
    .createReadStream();

  stream
    .pipe(csv())
    .on("data", (row) => {
      try {
        const leadId = row["Lead ID"];
        const disposition = row["Dialer Disposition"]?.trim();
        const callType = row["Call Type"];

        // ✅ only OB calls
        if (callType !== "OB") return;
        if (!leadId) return;

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

      } catch (err) {
        console.error("Row error:", err);
      }
    })
    .on("end", () => {
      try {
        const report = Object.entries(fileMap).map(([leadId, data]) => {
          const connectivity =
            data.total === 0
              ? 0
              : (data.connected / data.total) * 100;

          return {
            leadId,
            totalCalls: data.total,
            connectedCalls: data.connected,
            connectivity: connectivity.toFixed(2) + "%",
          };
        });

        // 🔹 Sort best → worst
        report.sort(
          (a, b) =>
            parseFloat(b.connectivity) - parseFloat(a.connectivity)
        );

        res.json({
          message: "CDR connectivity generated",
          report,
        });

      } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Error generating report" });
      }
    })
    .on("error", (err) => {
      console.error(err);
      res.status(500).json({ message: "Error reading CSV from S3" });
    });
};
