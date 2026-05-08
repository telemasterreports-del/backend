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

  if (cleaned.length < 10) {
    return null;
  }

  return cleaned.slice(-10);
};

// validate phone
const isValidPhone = (phone) => {
  return !!cleanPhone(phone);
};

// detect timezone
const getZone = (phone) => {
  const cleaned = cleanPhone(phone);

  if (!cleaned) {
    return "UNKNOWN";
  }

  const areaCode = cleaned.slice(0, 3);

  return areaCodeMap[areaCode] || "UNKNOWN";
};

// convert row to CSV line safely
const convertRowToCSV = (row, headers) => {
  return headers
    .map((header) => {
      const value = row[header];

      if (value === undefined || value === null) {
        return '""';
      }

      const escaped = value
        .toString()
        .replace(/"/g, '""');

      return `"${escaped}"`;
    })
    .join(",");
};

// dynamic phone field detection
const getPhoneFromRow = (row) => {
  const phoneKey = Object.keys(row).find((key) => {
    const lower = key.toLowerCase();

    return (
      lower.includes("phone") ||
      lower.includes("mobile") ||
      lower.includes("contact") ||
      lower.includes("number") ||
      lower.includes("cell")
    );
  });

  return phoneKey ? row[phoneKey] : null;
};

// =====================
// CONTROLLER
// =====================

module.exports = async (req, res) => {
  try {
    console.log("🔥 TIMEZONE SPLIT STARTED");

    // support multiple upload formats
    const fileKey =
      req.file?.key ||
      req.files?.file?.[0]?.key ||
      req.files?.cdrFile?.[0]?.key;

    if (!fileKey) {
      return res.status(400).json({
        success: false,
        message: "No file uploaded",
      });
    }

    console.log("📂 FILE KEY:", fileKey);

    // request-scoped storage
    const writers = {};
    const counts = {};

    // =====================
    // CREATE WRITER
    // =====================

    const createWriterIfNotExists = (
      zone,
      headers
    ) => {
      if (writers[zone]) {
        return;
      }

      const pass = new PassThrough();

      const fileName = `${zone}_${Date.now()}.csv`;

      // write header
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

      console.log(`✅ Writer created for ${zone}`);
    };

    // =====================
    // READ CSV FROM S3
    // =====================

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
          // auto detect phone column
          const phone = getPhoneFromRow(row);

          // skip invalid rows
          if (!isValidPhone(phone)) {
            return;
          }

          const zone = getZone(phone);

          const headers = Object.keys(row);

          createWriterIfNotExists(
            zone,
            headers
          );

          // write row
          writers[zone].stream.write(
            convertRowToCSV(
              row,
              headers
            ) + "\n"
          );

          counts[zone]++;
        } catch (err) {
          console.error(
            "❌ Row processing error:",
            err
          );
        }
      })

      .on("end", async () => {
        try {
          console.log(
            "✅ CSV PROCESSING FINISHED"
          );

          // no valid data
          if (
            Object.keys(writers).length === 0
          ) {
            return res.status(400).json({
              success: false,
              message:
                "No valid phone numbers found",
            });
          }

          // close all streams
          Object.values(writers).forEach(
            ({ stream }) => {
              stream.end();
            }
          );

          // wait for uploads
          const files = await Promise.all(
            Object.entries(writers).map(
              async ([zone, writer]) => {
                await writer.uploadPromise;

                // generate signed download URL
                const signedUrl =
                  s3.getSignedUrl(
                    "getObject",
                    {
                      Bucket:
                        process.env
                          .S3_BUCKET_NAME,
                      Key: writer.fileName,
                      Expires: 60 * 60, // 1 hour
                    }
                  );

                return {
                  zone,
                  fileName:
                    writer.fileName,
                  url: signedUrl,
                  count:
                    counts[zone] || 0,
                };
              }
            )
          );

          return res.json({
            success: true,
            message:
              "Files split successfully by timezone",
            summary: counts,
            totalFiles: files.length,
            files,
          });
        } catch (err) {
          console.error(
            "❌ Finalization error:",
            err
          );

          return res.status(500).json({
            success: false,
            message:
              "Error finalizing uploads",
            error: err.message,
          });
        }
      })

      .on("error", (err) => {
        console.error(
          "❌ CSV stream error:",
          err
        );

        return res.status(500).json({
          success: false,
          message:
            "Error reading CSV from S3",
          error: err.message,
        });
      });
  } catch (err) {
    console.error(
      "❌ Controller Error:",
      err
    );

    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: err.message,
    });
  }
};