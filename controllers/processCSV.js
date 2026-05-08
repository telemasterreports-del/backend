const fs = require("fs");
const csv = require("csv-parser");
const { PassThrough } = require("stream");
const s3 = require("../config/s3");
const areaCodeMap = require("../utils/areaCodeMap.json");

// =====================
// HELPERS
// =====================

// clean + normalize phone
const cleanPhone = (phone) => {
  if (!phone) return null;

  const cleaned = phone.toString().replace(/\D/g, "");

  if (cleaned.length < 10) return null;

  return cleaned.slice(-10);
};

// validate phone
const isValidPhone = (phone) => {
  return !!cleanPhone(phone);
};

// detect timezone zone
const getZone = (phone) => {
  const cleaned = cleanPhone(phone);

  if (!cleaned) return "UNKNOWN";

  const areaCode = cleaned.slice(0, 3);

  return areaCodeMap[areaCode] || "UNKNOWN";
};

// convert object row → csv line
const convertRowToCSV = (row) => {
  return Object.values(row)
    .map((value) => {
      if (value === null || value === undefined) return "";

      // escape quotes
      const escaped = value.toString().replace(/"/g, '""');

      // wrap in quotes
      return `"${escaped}"`;
    })
    .join(",");
};

// =====================
// CONTROLLER
// =====================

module.exports = (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        message: "No file uploaded",
      });
    }

    // request-scoped storage
    const writers = {};
    const counts = {};

    // =====================
    // CREATE WRITER
    // =====================

    const createWriterIfNotExists = (zone, headers) => {
      if (writers[zone]) return;

      const pass = new PassThrough();

      const fileName = `${zone}_${Date.now()}.csv`;

      // write csv header
      pass.write(headers.join(",") + "\n");

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
    // READ CSV
    // =====================

    fs.createReadStream(req.file.path)
      .pipe(csv())

      .on("data", (row) => {
        try {
          // flexible phone mapping
          const phone =
            row.phone ||
            row.Phone ||
            row["Phone Number"] ||
            row.mobile ||
            row.Mobile ||
            row.number ||
            row.Number ||
            row.contact ||
            row.Contact;

          // skip invalid
          if (!isValidPhone(phone)) return;

          const zone = getZone(phone);

          const headers = Object.keys(row);

          createWriterIfNotExists(zone, headers);

          // write row
          writers[zone].stream.write(
            convertRowToCSV(row) + "\n"
          );

          counts[zone]++;
        } catch (err) {
          console.error("Row processing error:", err);
        }
      })

      .on("end", async () => {
        try {
          // close streams
          Object.values(writers).forEach(({ stream }) => {
            stream.end();
          });

          // wait uploads
          const files = await Promise.all(
            Object.entries(writers).map(
              async ([zone, writer]) => {
                const result =
                  await writer.uploadPromise;

                return {
                  zone,
                  fileName: writer.fileName,
                  url: result.Location,
                  count: counts[zone] || 0,
                };
              }
            )
          );

          // cleanup uploaded temp file
          if (fs.existsSync(req.file.path)) {
            fs.unlinkSync(req.file.path);
          }

          return res.json({
            success: true,
            message:
              "Files split successfully by timezone",
            summary: counts,
            totalFiles: files.length,
            files,
          });
        } catch (err) {
          console.error("Finalization error:", err);

          return res.status(500).json({
            success: false,
            message: "Error finalizing uploads",
            error: err.message,
          });
        }
      })

      .on("error", (err) => {
        console.error("CSV Read Error:", err);

        return res.status(500).json({
          success: false,
          message: "Error reading CSV file",
          error: err.message,
        });
      });
  } catch (err) {
    console.error("Controller Error:", err);

    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: err.message,
    });
  }
};