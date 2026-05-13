const csv = require("csv-parser");
const s3 = require("../config/s3");

// 🔹 Convert HH:MM:SS → seconds
const parseTimeToSeconds = (time) => {
  if (!time) return 0;

  const parts = time
    .split(":")
    .map(Number);

  if (parts.length === 3) {
    return (
      parts[0] * 3600 +
      parts[1] * 60 +
      parts[2]
    );
  }

  return Number(time) || 0;
};

// 🔹 Normalize phone number
const cleanPhone = (num) =>
  num
    ? num
        .toString()
        .replace(/\D/g, "")
        .slice(-10)
    : null;

// 🔹 Normalize disposition
const normalizeDisposition = (
  value
) => {
  if (
    !value ||
    value.trim() === ""
  )
    return "Blank";

  const v = value
    .toLowerCase()
    .trim();

  if (v.includes("ring"))
    return "Ringing";

  if (v.includes("hung"))
    return "Hungup";

  if (v.includes("answer"))
    return "Answering Machine";

  if (v.includes("less"))
    return "Less Than 10k";

  if (v.includes("qualify"))
    return "Not Qualify";

  if (v.includes("abuse"))
    return "Abuse";

  if (v.includes("foreign"))
    return "Foreign Language";

  if (v.includes("interest"))
    return "Not Interested";

  if (v.includes("auto"))
    return "Auto Dispose";

  if (v.includes("available"))
    return "Not Available";

  if (v.includes("wrong"))
    return "Wrong Number";

  return "Blank";
};

const DISPOSITIONS = [
  "Ringing",
  "Hungup",
  "Blank",
  "Less Than 10k",
  "Answering Machine",
  "Not Qualify",
  "Abuse",
  "Foreign Language",
  "Not Interested",
  "Auto Dispose",
  "Not Available",
  "Wrong Number",
];

// 🔹 S3 stream helper
const getS3Stream = (key) => {
  return s3
    .getObject({
      Bucket:
        process.env
          .S3_BUCKET_NAME,
      Key: key,
    })
    .createReadStream();
};

module.exports = async (
  req,
  res
) => {
  try {
    if (
      !req.files?.cdrFile ||
      !req.files?.agentFile
    ) {
      return res.status(400).json({
        message:
          "Both CDR and Agent files are required",
      });
    }

    const cdrKey =
      req.files.cdrFile[0].key;

    const agentKey =
      req.files.agentFile[0].key;

    const validNumbers =
      new Set();

    const agentSummary = {};

    // =========================
    // STEP 1: PROCESS CDR FILE
    // =========================
    await new Promise(
      (resolve, reject) => {
        getS3Stream(cdrKey)
          .pipe(csv())
          .on("data", (row) => {
            const disposition =
              row[
                "Dialer Disposition"
              ];

            const phone =
              cleanPhone(
                row[
                  "Dialed Number"
                ]
              );

            const callType =
              row["Call Type"];

            if (
              disposition ===
                "Answered By Agent" &&
              phone &&
              callType === "OB"
            ) {
              validNumbers.add(
                phone
              );
            }
          })
          .on("end", resolve)
          .on("error", reject);
      }
    );

    // =========================
    // STEP 2: PROCESS AGENT FILE
    // =========================
    await new Promise(
      (resolve, reject) => {
        getS3Stream(agentKey)
          .pipe(csv())
          .on("data", (row) => {
            const phone =
              cleanPhone(
                row[
                  "Phone Number"
                ]
              );

            const agent =
              row[
                "Agent Name"
              ]?.trim() ||
              "Unknown Agent";

            const rawDisposition =
              row[
                "Disposition"
              ];

            const talkTimeSec =
              parseTimeToSeconds(
                row["Talk Time"]
              );

            if (
              !phone ||
              !validNumbers.has(
                phone
              )
            )
              return;

            const disposition =
              normalizeDisposition(
                rawDisposition
              );

            // initialize agent bucket
            if (
              !agentSummary[
                agent
              ]
            ) {
              agentSummary[
                agent
              ] = {
                total: 0,
                talkTimeTotal: 0,
                callCount: 0,
              };

              DISPOSITIONS.forEach(
                (d) => {
                  agentSummary[
                    agent
                  ][d] = 0;
                }
              );
            }

            // update stats
            agentSummary[
              agent
            ].total++;

            agentSummary[
              agent
            ][disposition] =
              (agentSummary[
                agent
              ][disposition] ||
                0) + 1;

            agentSummary[
              agent
            ].talkTimeTotal +=
              talkTimeSec;

            agentSummary[
              agent
            ].callCount += 1;
          })
          .on("end", resolve)
          .on("error", reject);
      }
    );

    // =========================
    // FINAL RESPONSE
    // =========================

    // overall totals
    const overallSummary = {
      total: 0,
      talkTimeTotal: 0,
      callCount: 0,
    };

    DISPOSITIONS.forEach(
      (d) => {
        overallSummary[d] = 0;
      }
    );

    // agent response
    const agents =
      Object.keys(
        agentSummary
      ).map((agent) => {
        const data =
          agentSummary[agent];

        // add to overall
        overallSummary.total +=
          data.total;

        overallSummary.talkTimeTotal +=
          data.talkTimeTotal;

        overallSummary.callCount +=
          data.callCount;

        DISPOSITIONS.forEach(
          (d) => {
            overallSummary[d] +=
              data[d] || 0;
          }
        );

        // agent %
        const dispositionPercentages =
          {};

        DISPOSITIONS.forEach(
          (d) => {
            dispositionPercentages[
              `${d}Percentage`
            ] =
              data.total > 0
                ? Number(
                    (
                      (data[d] /
                        data.total) *
                      100
                    ).toFixed(2)
                  )
                : 0;
          }
        );

        return {
          agent,
          ...data,
          ...dispositionPercentages,

          avgTalkTime:
            data.callCount > 0
              ? Number(
                  (
                    data.talkTimeTotal /
                    data.callCount
                  ).toFixed(2)
                )
              : 0,
        };
      });

    // overall %
    const overallPercentages =
      {};

    DISPOSITIONS.forEach(
      (d) => {
        overallPercentages[
          `${d}Percentage`
        ] =
          overallSummary.total >
          0
            ? Number(
                (
                  (overallSummary[
                    d
                  ] /
                    overallSummary.total) *
                  100
                ).toFixed(2)
              )
            : 0;
      }
    );

    // sort agents
    const sortedAgents =
      agents.sort(
        (a, b) =>
          b.total - a.total
      );

    // final response
    res.json({
      agents: sortedAgents,

      overall: {
        agent: "Overall",

        ...overallSummary,
        ...overallPercentages,

        avgTalkTime:
          overallSummary.callCount >
          0
            ? Number(
                (
                  overallSummary.talkTimeTotal /
                  overallSummary.callCount
                ).toFixed(2)
              )
            : 0,

        overallTotalCalls:
          overallSummary.total,
      },
    });
  } catch (error) {
    console.error(
      "ERROR:",
      error
    );

    res.status(500).json({
      message:
        "Server error",
      error: error.message,
    });
  }
};