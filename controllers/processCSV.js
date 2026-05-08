const csv = require("csv-parser");
const { PassThrough } = require("stream");
const s3 = require("../config/s3");
const areaCodeMap = require("../utils/areaCodeMap.json");

// =====================
// FIXED OUTPUT HEADERS
// =====================

const OUTPUT_HEADERS = [
  "phone",
  "Name",
  "Last Name",
  "Company Name",
  "Address",
  "City",
  "State",
  "ZIP",
  "Email",
  "FileName",
  "Comments",
  "DOB",
  "SSN",
  "Country",
  "Zone",
];

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

// =====================
// FLEXIBLE FIELD FINDER
// =====================

const findField = (row, possibleNames) => {
  const keys = Object.keys(row);

  const foundKey = keys.find((key) => {
    const lower = key.toLowerCase().trim();

    return possibleNames.some((name) =>
      lower.includes(name)
    );
  });

  return foundKey ? row[foundKey] : "";
};

// =====================
// MAP ANY CSV FORMAT
// TO STANDARD FORMAT
// =====================

const mapRowToStandardFormat = (
  row,
  zone,
  originalFileName
) => {
  const phone = findField(row, [
    "phone",
    "mobile",
    "contact",
    "cell",
    "number",
  ]);

  return {
    phone: cleanPhone(phone) || "",

    Name: findField(row, [
      "name",
      "first",
      "fname",
    ]),

    "Last Name": findField(row, [
      "last",
      "lname",
      "surname",
    ]),

    "Company Name": findField(row, [
      "company",
      "business",
    ]),

    Address: findField(row, [
      "address",
      "street",
    ]),

    City: findField(row, ["city"]),

    State: findField(row, [
      "state",
      "province",
    ]),

    ZIP: findField(row, [
      "zip",
      "postal",
      "pincode",
    ]),

    Email: findField(row, [
      "email",
      "mail",
    ]),

    FileName: originalFileName || "",

    Comments: findField(row, [
      "comment",
      "remarks",
      "notes",
    ]),

    DOB: findField(row, [
      "dob",
      "birth",
    ]),

    SSN: findField(row, ["ssn"]),

    Country: findField(row, [
      "country",
    ]),

    Zone: zone,
  };
};

// =====================
// CONVERT ROW TO CSV
// =====================

const convertRowToCSV = (row) => {
  return OUTPUT_HEADERS.map((header) => {
    const value = row[header];

    if (
      value === undefined ||
      value === null
    ) {
      return '""';
    }

    const escaped = value
      .toString()
      .replace(/"/g, '""');

    return `"${escaped}"`;
  }).join(",");
};

// =====================
// CONTROLLER
// =====================

module.exports = async (req, res) => {
  try {
    console.log(
      "🔥 TIMEZONE SPLIT STARTED"
    );

    // support all upload formats
    const fileKey =
      req.file?.key ||
      req.files?.file?.[0]?.key ||
      req.files?.cdrFile?.[0]?.key;

    const originalFileName =
      req.file?.originalname ||
      req.files?.file?.[0]
        ?.originalname ||
      "uploaded.csv";

    if (!fileKey) {
      return res.status(400).json({
        success: false,
        message: "No file uploaded",
      });
    }

    console.log("📂 FILE:", fileKey);

    // request-scoped storage
    const writers = {};
    const counts = {};

    // =====================
    // CREATE WRITER
    // =====================

    const createWriterIfNotExists = (
      zone
    ) => {
      if (writers[zone]) {
        return;
      }

      const pass = new PassThrough();

      const fileName = `${zone}_${Date.now()}.csv`;

      // write fixed headers
      pass.write(
        OUTPUT_HEADERS.join(",") + "\n"
      );

      writers[zone] = {
        stream: pass,
        fileName,

        uploadPromise: s3
          .upload({
            Bucket:
              process.env.S3_BUCKET_NAME,
            Key: fileName,
            Body: pass,
            ContentType: "text/csv",
          })
          .promise(),
      };

      counts[zone] = 0;

      console.log(
        `✅ Writer created for ${zone}`
      );
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
          // detect phone dynamically
          const phone = findField(row, [
            "phone",
            "mobile",
            "contact",
            "cell",
            "number",
          ]);

          // skip invalid phones
          if (!isValidPhone(phone)) {
            return;
          }

          const zone = getZone(phone);

          createWriterIfNotExists(
            zone
          );

          // standardize row
          const formattedRow =
            mapRowToStandardFormat(
              row,
              zone,
              originalFileName
            );

          // write standardized row
          writers[zone].stream.write(
            convertRowToCSV(
              formattedRow
            ) + "\n"
          );

          counts[zone]++;
        } catch (err) {
          console.error(
            "❌ Row error:",
            err
          );
        }
      })

      .on("end", async () => {
        try {
          console.log(
            "✅ CSV PROCESSING FINISHED"
          );

          if (
            Object.keys(writers).length === 0
          ) {
            return res.status(400).json({
              success: false,
              message:
                "No valid phone numbers found",
            });
          }

          // close streams
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

                const signedUrl =
                  s3.getSignedUrl(
                    "getObject",
                    {
                      Bucket:
                        process.env
                          .S3_BUCKET_NAME,
                      Key: writer.fileName,
                      Expires:
                        60 * 60,
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
            totalFiles:
              files.length,
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
      message:
        "Internal server error",
      error: err.message,
    });
  }
};