const fs = require("fs");
const csv = require("csv-parser");
const { PassThrough } = require("stream");
const s3 = require("../config/s3");
const areaCodeMap = require("../utils/areaCodeMap.json");

// =====================
// HELPERS
// =====================

const cleanPhone = (phone) => {
  if (!phone) return null;
  const cleaned = phone.toString().replace(/\D/g, "");
  return cleaned.length >= 10 ? cleaned.slice(-10) : null;
};

const isValidPhone = (phone) => {
  const cleaned = cleanPhone(phone);
  return !!cleaned;
};

const getZone = (phone) => {
  const cleaned = cleanPhone(phone);
  if (!cleaned) return "UNKNOWN";

  const areaCode = cleaned.slice(0, 3);
  return areaCodeMap[areaCode] || "UNKNOWN";
};

// =====================
// WRITERS STORAGE
// =====================
const writers = {};
const counts = {};

// =====================
// CREATE WRITER PER ZONE
// =====================
const createWriterIfNotExists = (zone) => {
  if (writers[zone]) return;

  const pass = new PassThrough();

  const fileName = `${zone}_${Date.now()}.csv`;

  writers[zone] = {
    stream: pass,
    fileName,
    uploadPromise: s3
      .upload({
        Bucket: process.env.S3_BUCKET_NAME,
        Key: fileName,
        Body: pass,
        ContentType: "text/csv",
      })
      .promise(),
  };

  counts[zone] = 0;
};

// =====================
// CONTROLLER
// =====================
module.exports = (req, res) => {
  if (!req.file) {
    return res.status(400).json({ message: "No file uploaded" });
  }

  fs.createReadStream(req.file.path)
    .pipe(csv())
    .on("data", (row) => {
      try {
        const phone = row.phone || row.Phone || row["Phone Number"];

        if (!isValidPhone(phone)) return;

        const zone = getZone(phone);

        if (!cleanPhone(phone)) {
          createWriterIfNotExists("UNKNOWN");
          writers["UNKNOWN"].stream.write(Object.values(row).join(",") + "\n");
          counts["UNKNOWN"]++;
          return;
        }

        createWriterIfNotExists(zone);

        writers[zone].stream.write(Object.values(row).join(",") + "\n");

        counts[zone]++;
      } catch (err) {
        console.error("Row error:", err);
      }
    })
    .on("end", async () => {
      try {
        // close all streams
        Object.values(writers).forEach(({ stream }) => stream.end());

        // wait for uploads
        const files = await Promise.all(
          Object.entries(writers).map(async ([zone, writer]) => {
            const result = await writer.uploadPromise;

            return {
              zone,
              fileName: writer.fileName,
              url: result.Location,
              count: counts[zone] || 0,
            };
          })
        );

        res.json({
          message: "Files split successfully by timezone",
          summary: counts,
          files,
        });
      } catch (err) {
        console.error(err);
        res.status(500).json({
          message: "Error finalizing uploads",
          error: err.message,
        });
      }
    })
    .on("error", (err) => {
      console.error(err);
      res.status(500).json({
        message: "Error reading CSV file",
        error: err.message,
      });
    });
};