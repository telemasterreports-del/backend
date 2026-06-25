const csv = require("csv-parser");
const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");
const areaCodeMap = require("../utils/areaCodeMap.json");
const ProcessingJob = require("../models/ProcessingJob");

let zipToStateMapPromise;

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

const VALID_ZONES = new Set([
  "EST",
  "CST",
  "MST",
  "PST",
  "AKST",
  "HST",
]);

const STATE_TO_ZONE = {
  Alabama: "CST",
  Alaska: "AKST",
  Arizona: "MST",
  Arkansas: "CST",
  California: "PST",
  Colorado: "MST",
  Connecticut: "EST",
  Delaware: "EST",
  Florida: "EST",
  Georgia: "EST",
  Hawaii: "HST",
  Idaho: "MST",
  Illinois: "CST",
  Indiana: "EST",
  Iowa: "CST",
  Kansas: "CST",
  Kentucky: "EST",
  Louisiana: "CST",
  Maine: "EST",
  Maryland: "EST",
  Massachusetts: "EST",
  Michigan: "EST",
  Minnesota: "CST",
  Mississippi: "CST",
  Missouri: "CST",
  Montana: "MST",
  Nebraska: "CST",
  Nevada: "PST",
  "New Hampshire": "EST",
  "New Jersey": "EST",
  "New Mexico": "MST",
  "New York": "EST",
  "North Carolina": "EST",
  "North Dakota": "CST",
  Ohio: "EST",
  Oklahoma: "CST",
  Oregon: "PST",
  Pennsylvania: "EST",
  "Rhode Island": "EST",
  "South Carolina": "EST",
  "South Dakota": "CST",
  Tennessee: "CST",
  Texas: "CST",
  Utah: "MST",
  Vermont: "EST",
  Virginia: "EST",
  Washington: "PST",
  "West Virginia": "EST",
  Wisconsin: "CST",
  Wyoming: "MST",
};

const STATE_NAMES = Object.keys(STATE_TO_ZONE);

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

// detect timezone
const getZone = (phone) => {
  const cleaned = cleanPhone(phone);

  if (!cleaned) {
    return "UNKNOWN";
  }

  const areaCode = cleaned.slice(0, 3);

  return areaCodeMap[areaCode] || "UNKNOWN";
};

const normalizeZone = (zone) => {
  const value = zone
    ?.toString()
    .trim()
    .toUpperCase();

  if (!value) {
    return "";
  }

  if (VALID_ZONES.has(value)) {
    return value;
  }

  return "";
};

const getZoneFromState = (state, zipStateLookup) => {
  const stateValue = state
    ?.toString()
    .trim();

  if (!stateValue) {
    return "";
  }

  const canonicalState =
    zipStateLookup.stateAliasToNameMap.get(
      stateValue.toLowerCase()
    ) || stateValue;

  return STATE_TO_ZONE[canonicalState] || "";
};

const getBestZone = (formattedRow, sourceRow, zipStateLookup) => {
  const phoneZone = getZone(formattedRow.phone);

  if (phoneZone !== "UNKNOWN") {
    return phoneZone;
  }

  const existingZone = normalizeZone(
    findField(sourceRow, ["zone", "timezone", "time zone"])
  );

  if (existingZone) {
    return existingZone;
  }

  const stateZone = getZoneFromState(
    formattedRow.State,
    zipStateLookup
  );

  if (stateZone) {
    return stateZone;
  }

  return "UNKNOWN";
};

// Normalize US ZIP and ZIP+4 values to the five-digit key used by geoData.csv.
const normalizeZIP = (zip) => {
  if (zip === undefined || zip === null) {
    return "";
  }

  const value = zip.toString().trim();

  if (!value) {
    return "";
  }

  const numericValue = value.match(/^(\d+)(?:\.0+)?$/);

  if (numericValue) {
    return numericValue[1].padStart(5, "0").slice(0, 5);
  }

  const digits = value.replace(/\D/g, "");
  return digits.length >= 5 ? digits.slice(0, 5) : "";
};

// Load the ZIP-to-state reference once and reuse it for every uploaded row.
const getZipToStateMap = () => {
  if (!zipToStateMapPromise) {
    const geoDataPath = path.join(
      __dirname,
      "..",
      "utils",
      "geoData.csv"
    );

    zipToStateMapPromise = new Promise((resolve, reject) => {
      const zipToStateMap = new Map();
      const zipPrefixStates = new Map();
      const stateAliasToNameMap = new Map();

      fs.createReadStream(geoDataPath)
        .pipe(csv())
        .on("data", (row) => {
          const zip = normalizeZIP(row.zipcode);
          const state = row.state?.toString().trim();
          const stateAbbr = row.state_abbr?.toString().trim();

          if (zip && state && !zipToStateMap.has(zip)) {
            zipToStateMap.set(zip, state);
          }

          if (zip && state) {
            const prefix = zip.slice(0, 3);
            if (!zipPrefixStates.has(prefix)) {
              zipPrefixStates.set(prefix, new Set());
            }
            zipPrefixStates.get(prefix).add(state);
          }

          if (state) {
            stateAliasToNameMap.set(state.toLowerCase(), state);
          }

          if (state && stateAbbr) {
            stateAliasToNameMap.set(stateAbbr.toLowerCase(), state);
          }
        })
        .on("end", () => {
          const zipPrefixToStateMap = new Map();

          for (const [prefix, states] of zipPrefixStates) {
            if (states.size === 1) {
              zipPrefixToStateMap.set(prefix, states.values().next().value);
            }
          }

          resolve({
            zipToStateMap,
            zipPrefixToStateMap,
            stateAliasToNameMap,
          });
        })
        .on("error", reject);
    });
  }

  return zipToStateMapPromise;
};

// =====================
// FLEXIBLE FIELD FINDER
// =====================

const findField = (row, possibleNames) => {
  const keys = Object.keys(row);

  const normalizeHeader = (value) =>
    value.toLowerCase().replace(/[^a-z0-9]/g, "");

  const normalizedNames = possibleNames.map(normalizeHeader);

  const exactKey = keys.find((key) =>
    normalizedNames.includes(normalizeHeader(key))
  );

  if (exactKey) {
    return row[exactKey];
  }

  const foundKey = keys.find((key) => {
    const normalizedKey = normalizeHeader(key);

    return normalizedNames.some((name) =>
      normalizedKey.includes(name)
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
  originalFileName,
  zipStateLookup
) => {
  const phone = findField(row, [
    "phone",
    "mobile",
    "contact",
    "cell",
    "number",
  ]);

  const state = findField(row, [
    "state",
    "province",
  ]);
  const zip = findField(row, [
    "zip",
    "postal",
    "pincode",
  ]);
  const normalizedZIP = normalizeZIP(zip);
  const stateFromZIP =
    zipStateLookup.zipToStateMap.get(normalizedZIP) ||
    zipStateLookup.zipPrefixToStateMap.get(normalizedZIP.slice(0, 3)) ||
    "";
  const normalizedState = state?.toString().trim();
  const canonicalState = normalizedState
    ? zipStateLookup.stateAliasToNameMap.get(normalizedState.toLowerCase()) ||
      normalizedState
    : stateFromZIP;

  const cleanText = (value) =>
    value === undefined || value === null
      ? ""
      : value.toString().trim();

  return {
    phone: cleanPhone(phone) || "",

    Name: cleanText(findField(row, [
      "name",
      "first",
      "fname",
    ])),

    "Last Name": cleanText(findField(row, [
      "last",
      "lname",
      "surname",
    ])),

    "Company Name": cleanText(findField(row, [
      "company",
      "business",
    ])),

    Address: cleanText(findField(row, [
      "address",
      "street",
    ])),

    City: cleanText(findField(row, ["city"])),

    State: canonicalState,

    ZIP: normalizedZIP,

    Email: cleanText(findField(row, [
      "email",
      "mail",
    ])),

    FileName: originalFileName || "",

    Comments: cleanText(findField(row, [
      "comment",
      "remarks",
      "notes",
    ])),

    DOB: cleanText(findField(row, [
      "dob",
      "birth",
    ])),

    SSN: cleanText(findField(row, ["ssn"])),

    Country: cleanText(findField(row, [
      "country",
    ])),

    Zone: "UNKNOWN",
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

const isMongoConnected = () => mongoose.connection.readyState === 1;

const createTrackingJob = async ({
  originalFileName,
  uploadedFilePath,
  selectedZone,
  selectedStates = [],
}) => {
  if (!isMongoConnected()) {
    return null;
  }

  try {
    return await ProcessingJob.create({
      originalFileName,
      uploadedFilePath,
      selectedTimezone: selectedZone,
      selectedStates,
      status: "processing",
    });
  } catch (error) {
    console.error("Tracking job create failed:", error.message);
    return null;
  }
};

const updateTrackingJob = async (job, update) => {
  if (!job || !isMongoConnected()) {
    return;
  }

  try {
    await ProcessingJob.findByIdAndUpdate(job._id, update);
  } catch (error) {
    console.error("Tracking job update failed:", error.message);
  }
};

const parseSelectedStates = (value, zipStateLookup) => {
  if (!value) {
    return [];
  }

  let rawStates = value;

  if (typeof value === "string") {
    try {
      rawStates = JSON.parse(value);
    } catch (error) {
      rawStates = value.split(",");
    }
  }

  if (!Array.isArray(rawStates)) {
    rawStates = [rawStates];
  }

  const selected = rawStates
    .map((state) => state?.toString().trim())
    .filter(Boolean)
    .map(
      (state) =>
        zipStateLookup.stateAliasToNameMap.get(state.toLowerCase()) ||
        state
    )
    .filter((state) => STATE_NAMES.includes(state));

  return [...new Set(selected)];
};

const createCsvWriter = (fileKey) => {
  const safeKey = fileKey.replace(/[^a-z0-9]+/gi, "_");
  const fileName = `${safeKey}_${Date.now()}.csv`;
  const filePath = path.join(
    __dirname,
    "..",
    "outputs",
    fileName
  );

  fs.mkdirSync(path.dirname(filePath), {
    recursive: true,
  });

  const stream = fs.createWriteStream(filePath);
  stream.write(OUTPUT_HEADERS.join(",") + "\n");

  return {
    stream,
    fileName,
    filePath,
  };
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
    const uploadedFilePath =
      req.file?.path ||
      req.files?.file?.[0]?.path ||
      req.files?.cdrFile?.[0]?.path;

    const originalFileName =
      req.file?.originalname ||
      req.files?.file?.[0]?.originalname ||
      "uploaded.csv";

    const selectedZone = (
      req.body?.timezone || "ALL"
    )
      .toString()
      .trim()
      .toUpperCase();

    if (!uploadedFilePath) {
      return res.status(400).json({
        success: false,
        message: "No file uploaded",
      });
    }

    const zipStateLookup = await getZipToStateMap();
    const selectedStates = parseSelectedStates(
      req.body?.states,
      zipStateLookup
    );
    const trackingJob = await createTrackingJob({
      originalFileName,
      uploadedFilePath,
      selectedZone,
      selectedStates,
    });

    console.log("📂 FILE:", uploadedFilePath);
    console.log("🎯 Selected timezone:", selectedZone);

    // request-scoped storage
    const writers = {};
    const counts = {};
    const stateWriters = {};
    const stateCounts = {};
    let totalInputRows = 0;
    let totalOutputRows = 0;

    const allowedZones = new Set([
      "ALL",
      "EST",
      "CST",
      "MST",
      "PST",
      "AKST",
      "HST",
      "UNKNOWN",
    ]);

    if (!allowedZones.has(selectedZone)) {
      return res.status(400).json({
        success: false,
        message:
          "Invalid timezone selected",
      });
    }

    // =====================
    // CREATE WRITER
    // =====================

    const createWriterIfNotExists = (
      zone
    ) => {
      if (writers[zone]) {
        return;
      }

      writers[zone] = createCsvWriter(zone);

      counts[zone] = 0;

      console.log(
        `✅ Writer created for ${zone}`
      );
    };

    const createStateWriterIfNotExists = (state) => {
      if (stateWriters[state]) {
        return;
      }

      stateWriters[state] = createCsvWriter(`STATE_${state}`);
      stateCounts[state] = 0;

      console.log(`Writer created for ${state}`);
    };

    // =====================
    // READ CSV FROM LOCAL FILE
    // =====================

    const stream = fs
      .createReadStream(uploadedFilePath)
      .pipe(csv())
      .on("data", (row) => {
        try {
          totalInputRows++;

          // Step 1: standardize and enrich the complete row first.
          const formattedRow = mapRowToStandardFormat(
            row,
            originalFileName,
            zipStateLookup
          );

          // Step 2: assign timezone only after standardization.
          const zone = getBestZone(
            formattedRow,
            row,
            zipStateLookup
          );
          formattedRow.Zone = zone;

          if (
            selectedZone !== "ALL" &&
            zone !== selectedZone
          ) {
            return;
          }

          if (
            selectedStates.length > 0 &&
            !selectedStates.includes(formattedRow.State)
          ) {
            return;
          }

          createWriterIfNotExists(
            zone
          );

          // write standardized row
          writers[zone].stream.write(
            convertRowToCSV(
              formattedRow
            ) + "\n"
          );

          counts[zone]++;
          totalOutputRows++;

          if (selectedStates.includes(formattedRow.State)) {
            createStateWriterIfNotExists(formattedRow.State);

            stateWriters[formattedRow.State].stream.write(
              convertRowToCSV(formattedRow) + "\n"
            );

            stateCounts[formattedRow.State]++;
          }
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
              await updateTrackingJob(trackingJob, {
                status: "failed",
                totalInputRows,
                totalOutputRows,
                error: "No rows matched the selected timezone",
                completedAt: new Date(),
              });

              return res.status(400).json({
                success: false,
                message:
                "No rows matched the selected timezone",
              });
          }

          // Close every writer and wait until all output is fully flushed.
          await Promise.all(
            [
              ...Object.values(writers),
              ...Object.values(stateWriters),
            ].map(
              ({ stream }) =>
                new Promise((resolve, reject) => {
                  stream.once("finish", resolve);
                  stream.once("error", reject);
                  stream.end();
                })
            )
          );

          const files = Object.entries(writers).map(
            ([zone, writer]) => {
              return {
                zone,
                fileName: writer.fileName,
                url: `${req.protocol}://${req.get("host")}/outputs/${writer.fileName}`,
                count: counts[zone] || 0,
              };
            }
          );

          const stateFiles = Object.entries(stateWriters).map(
            ([state, writer]) => {
              return {
                state,
                fileName: writer.fileName,
                url: `${req.protocol}://${req.get("host")}/outputs/${writer.fileName}`,
                count: stateCounts[state] || 0,
              };
            }
          );

          await updateTrackingJob(trackingJob, {
            status: "completed",
            totalInputRows,
            totalOutputRows,
            selectedStates,
            timezoneOutputs: files.map((file) => ({
              label: "timezone_split",
              zone: file.zone,
              fileName: file.fileName,
              url: file.url,
              rowCount: file.count,
            })),
            stateExtracts: stateFiles.map((file) => ({
              label: "state_extract",
              state: file.state,
              fileName: file.fileName,
              url: file.url,
              rowCount: file.count,
            })),
            completedAt: new Date(),
          });

          return res.json({
            success: true,
            message:
              "Files split successfully by timezone",
            summary: counts,
            totalFiles:
              files.length + stateFiles.length,
            files,
            stateSummary: stateCounts,
            stateFiles,
          });
        } catch (err) {
          console.error(
            "❌ Finalization error:",
            err
          );

          await updateTrackingJob(trackingJob, {
            status: "failed",
            totalInputRows,
            totalOutputRows,
            error: err.message,
            completedAt: new Date(),
          });

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

        updateTrackingJob(trackingJob, {
          status: "failed",
          totalInputRows,
          totalOutputRows,
          error: err.message,
          completedAt: new Date(),
        });

        return res.status(500).json({
          success: false,
          message:
            "Error reading CSV from file",
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

