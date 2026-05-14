const csv = require("csv-parser");
const s3 = require("../config/s3");

// ====================================
// Normalize Disposition
// ====================================
const normalizeDisposition = (
  value
) => {
  if (
    !value ||
    value.trim() === ""
  ) {
    return "Blank";
  }

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

// ====================================
// Supported Dispositions
// ====================================
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

// ====================================
// S3 Stream Helper
// ====================================
const getS3Stream = (
  key
) => {
  return s3
    .getObject({
      Bucket:
        process.env
          .S3_BUCKET_NAME,
      Key: key,
    })
    .createReadStream();
};

// ====================================
// Controller
// ====================================
module.exports = async (
  req,
  res
) => {
  try {
    // =========================
    // Validate File
    // =========================
    if (
      !req.files?.agentFile
    ) {
      return res.status(400).json({
        message:
          "Disposition file is required",
      });
    }

    const agentKey =
      req.files.agentFile[0]
        .key;

    const agentSummary =
      {};

    // =========================
    // Process File
    // =========================
    await new Promise(
      (
        resolve,
        reject
      ) => {
        getS3Stream(
          agentKey
        )
          .pipe(csv())
          .on(
            "data",
            (row) => {
              try {
                const agent =
                  row[
                    "Agent Name"
                  ]?.trim() ||
                  "Unknown Agent";

                const rawDisposition =
                  row[
                    "Disposition"
                  ];

                const callType =
                  row[
                    "Call Type"
                  ]?.trim();

                // Only outbound calls
                if (
                  callType !==
                  "OB"
                ) {
                  return;
                }

                const disposition =
                  normalizeDisposition(
                    rawDisposition
                  );

                // Initialize agent
                if (
                  !agentSummary[
                    agent
                  ]
                ) {
                  agentSummary[
                    agent
                  ] = {
                    total: 0,
                  };

                  DISPOSITIONS.forEach(
                    (d) => {
                      agentSummary[
                        agent
                      ][d] = 0;
                    }
                  );
                }

                // Update stats
                agentSummary[
                  agent
                ].total++;

                agentSummary[
                  agent
                ][
                  disposition
                ] =
                  (agentSummary[
                    agent
                  ][
                    disposition
                  ] || 0) +
                  1;
              } catch (
                err
              ) {
                console.error(
                  "Row Error:",
                  err
                );
              }
            }
          )
          .on(
            "end",
            resolve
          )
          .on(
            "error",
            reject
          );
      }
    );

    // =========================
    // Overall Summary
    // =========================
    const overallSummary =
      {
        total: 0,
      };

    DISPOSITIONS.forEach(
      (d) => {
        overallSummary[d] = 0;
      }
    );

    // =========================
    // Agent Response
    // =========================
    const agents =
      Object.keys(
        agentSummary
      ).map((agent) => {
        const data =
          agentSummary[
            agent
          ];

        // Add to overall
        overallSummary.total +=
          data.total;

        DISPOSITIONS.forEach(
          (d) => {
            overallSummary[
              d
            ] +=
              data[d] || 0;
          }
        );

        // Percentages
        const dispositionPercentages =
          {};

        DISPOSITIONS.forEach(
          (d) => {
            dispositionPercentages[
              `${d}Percentage`
            ] =
              data.total >
              0
                ? Number(
                    (
                      (data[
                        d
                      ] /
                        data.total) *
                      100
                    ).toFixed(
                      2
                    )
                  )
                : 0;
          }
        );

        return {
          agent,
          ...data,
          ...dispositionPercentages,
        };
      });

    // =========================
    // Overall Percentages
    // =========================
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

    // =========================
    // Sort Agents
    // =========================
    const sortedAgents =
      agents.sort(
        (a, b) =>
          b.total -
          a.total
      );

    // =========================
    // Final Response
    // =========================
    return res.json({
      agents:
        sortedAgents,

      overall: {
        agent:
          "Overall",

        ...overallSummary,
        ...overallPercentages,

        overallTotalCalls:
          overallSummary.total,
      },
    });
  } catch (error) {
    console.error(
      "ERROR:",
      error
    );

    return res
      .status(500)
      .json({
        message:
          "Server error",
        error:
          error.message,
      });
  }
};