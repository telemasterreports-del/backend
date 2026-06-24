const csv = require("csv-parser");
const fs = require("fs");

// ====================================
// Header helpers
// ====================================
const normalizeHeader = (value) =>
  String(value || "")
    .replace(/^\uFEFF/, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ");

const getValue = (row, aliases) => {
  for (const alias of aliases) {
    const value = row[normalizeHeader(alias)];

    if (value !== undefined) {
      return value;
    }
  }

  return undefined;
};

const HEADER_ALIASES = {
  agent: [
    "Agent Name",
    "Agent",
    "Agent Full Name",
    "User",
    "User Name",
  ],
  disposition: [
    "Disposition",
    "Dialer Disposition",
    "Sub Disposition",
    "Call Disposition",
    "Status",
  ],
  callType: [
    "Call Type",
    "CallType",
    "Type",
    "Direction",
  ],
};

const isOutboundCall = (value) => {
  const callType = String(value || "")
    .trim()
    .toLowerCase();

  return (
    callType === "ob" ||
    callType === "outbound" ||
    callType.startsWith("ob ")
  );
};

const hasAnyHeader = (
  headers,
  aliases
) =>
  aliases.some((alias) =>
    headers.includes(
      normalizeHeader(alias)
    )
  );

// ====================================
// Normalize Disposition
// ====================================
const normalizeDisposition = (
  value
) => {
  const text = String(
    value || ""
  ).trim();

  if (
    text === ""
  ) {
    return "Blank";
  }

  const v = text
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
// Local file stream helper
// ====================================
const getLocalStream = (filePath) => {
  return fs.createReadStream(filePath);
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

    const agentPath =
      req.files.agentFile[0]
        .path;

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
        const parser = csv({
          mapHeaders: ({
            header,
          }) =>
            normalizeHeader(
              header
            ),
        });

        const stream =
          getLocalStream(
            agentPath
          ).pipe(parser);

        stream
          .on(
            "headers",
            (headers) => {
              const missing =
                [];

              if (
                !hasAnyHeader(
                  headers,
                  HEADER_ALIASES
                    .agent
                )
              ) {
                missing.push(
                  "Agent Name"
                );
              }

              if (
                !hasAnyHeader(
                  headers,
                  HEADER_ALIASES
                    .disposition
                )
              ) {
                missing.push(
                  "Disposition"
                );
              }

              if (
                !hasAnyHeader(
                  headers,
                  HEADER_ALIASES
                    .callType
                )
              ) {
                missing.push(
                  "Call Type"
                );
              }

              if (
                missing.length
              ) {
                const error =
                  new Error(
                    `Missing required CSV header(s): ${missing.join(
                      ", "
                    )}`
                  );

                error.statusCode = 400;
                parser.destroy(
                  error
                );
              }
            }
          )
          .on(
            "data",
            (row) => {
              try {
                const agent =
                  String(
                    getValue(
                      row,
                      HEADER_ALIASES
                        .agent
                    ) || ""
                  ).trim() ||
                  "Unknown Agent";

                const rawDisposition =
                  getValue(
                    row,
                    HEADER_ALIASES
                      .disposition
                  );

                const callType =
                  getValue(
                    row,
                    HEADER_ALIASES
                      .callType
                  );

                // Only outbound calls
                if (
                  !isOutboundCall(
                    callType
                  )
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
          .on("error", reject);
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
    if (!error.statusCode) {
      console.error(
        "ERROR:",
        error
      );
    }

    return res
      .status(
        error.statusCode ||
          500
      )
      .json({
        message:
          error.statusCode
            ? error.message
            : "Server error",
        error:
          error.message,
      });
  }
};
