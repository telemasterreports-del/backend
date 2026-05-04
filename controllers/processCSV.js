const csv = require("csv-parser");
const { PassThrough } = require("stream");
const s3 = require("../config/s3");
const areaCodeMap = require("../utils/areaCodeMap.json");

module.exports = (req, res) => {
  if (!req.file) {
    return res.status(400).json({ message: "No file uploaded" });
  }

  const writers = {};
  const counts = {};

  // 🔹 Clean + validate phone
  const cleanPhone = (num) =>
    num ? num.toString().replace(/\D/g, "") : null;

  const isValidPhone = (num) => {
    const cleaned = cleanPhone(num);
    return cleaned && cleaned.length >= 10;
  };

  // 🔹 Get zone (NO UNKNOWN now)
  const getZone = (phone) => {
    const cleaned = cleanPhone(phone);
    const areaCode = cleaned.slice(0, 3);
    return areaCodeMap[areaCode]; // if not found → skip row
  };

  const createWriterIfNotExists = (zone, row) => {
    if (!writers[zone]) {
      const pass = new PassThrough();

      const fileName = `outputs/${zone}-${Date.now()}.csv`;

      const upload = s3.upload({
        Bucket: process.env.S3_BUCKET_NAME,
        Key: fileName,
        Body: pass,
        ContentType: "text/csv"
      });

      writers[zone] = {
        stream: pass,
        uploadPromise: upload.promise(),
        fileName
      };

      counts[zone] = 0;

      // write header
      pass.write(Object.keys(row).join(",") + "\n");
    }
  };

  // 🔥 Read from S3
  const stream = s3.getObject({
    Bucket: process.env.S3_BUCKET_NAME,
    Key: req.file.key
  }).createReadStream();

  stream
    .pipe(csv())
    .on("data", (row) => {
      try {
        const phone = row.phone;
        // const callType = row["Call Type"];

        // ✅ FILTER CONDITIONS
        if (!isValidPhone(phone)) return;
        // if (callType !== "OB") return;

        const zone = getZone(phone);

        // ❌ Skip if no valid zone mapping
        if (!zone) return;

        createWriterIfNotExists(zone, row);

        writers[zone].stream.write(
          Object.values(row).join(",") + "\n"
        );

        counts[zone]++;
      } catch (err) {
        console.error("Row error:", err);
      }
    })
    .on("end", async () => {
      try {
        // close streams
        Object.values(writers).forEach(({ stream }) => stream.end());

        const files = await Promise.all(
          Object.entries(writers).map(async ([zone, writer]) => {
            const result = await writer.uploadPromise;

            return {
              zone,
              fileName: writer.fileName,
              url: result.Location
            };
          })
        );

        res.json({
          message: "Files split successfully",
          summary: counts,
          files
        });

      } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Error finalizing uploads" });
      }
    })
    .on("error", (err) => {
      console.error(err);
      res.status(500).json({ message: "Error reading CSV from S3" });
    });
};
