const csv = require("csv-parser");
const fs = require("fs");

module.exports = (req, res) => {
  // support single + multiple upload formats
  const filePath =
    req.file?.path ||
    req.files?.file?.[0]?.path ||
    req.files?.cdrFile?.[0]?.path;

  if (!filePath) {
    return res
      .status(400)
      .json({ message: "No file uploaded" });
  }

  const fileMap = {};

  // All expected dispositions
  const dispositions = [
    "Rejected By Switch",
    "Ringing - No Answer",
    "Answering Machine",
    "Agent Busy - Maximum Wait Time",
    "Customer Hangup In Queue",
    "Answered By Agent",
    "Customer Busy",
    "Network Congestion",
  ];

  const stream = fs
    .createReadStream(filePath)
    .pipe(csv())
    .on("data", (row) => {
      try {
        const leadId =
          row["Lead ID"];

        const disposition =
          row[
            "Dialer Disposition"
          ]?.trim();

        const callType =
          row["Call Type"];

        // Only OB calls
        if (callType !== "OB")
          return;

        if (!leadId) return;

        // Init lead
        if (!fileMap[leadId]) {
          fileMap[leadId] = {
            total: 0,
            connected: 0,
          };

          // initialize disposition counts
          dispositions.forEach(
            (disp) => {
              fileMap[
                leadId
              ][disp] = 0;
            }
          );
        }

        fileMap[
          leadId
        ].total++;

        // Connectivity logic remains same
        if (
          disposition ===
          "Answered By Agent"
        ) {
          fileMap[
            leadId
          ].connected++;
        }

        // Count disposition
        if (
          dispositions.includes(
            disposition
          )
        ) {
          fileMap[
            leadId
          ][disposition]++;
        }
      } catch (err) {
        console.error(
          "Row error:",
          err
        );
      }
    })

    .on("end", () => {
      try {
        const report =
          Object.entries(
            fileMap
          ).map(
            ([
              leadId,
              data,
            ]) => {
              const connectivity =
                data.total ===
                0
                  ? 0
                  : (data.connected /
                      data.total) *
                    100;

              const row = {
                leadId,
                totalCalls:
                  data.total,
                connectedCalls:
                  data.connected,
                connectivity:
                  connectivity.toFixed(
                    2
                  ) + "%",
              };

              // Add count + avg %
              dispositions.forEach(
                (disp) => {
                  const count =
                    data[
                      disp
                    ] || 0;

                  const avg =
                    data.total >
                    0
                      ? (
                          (count /
                            data.total) *
                          100
                        ).toFixed(
                          2
                        )
                      : "0.00";

                  row[disp] =
                    count;

                  row[
                    `${disp}Avg`
                  ] =
                    `${avg}%`;
                }
              );

              return row;
            }
          );

        // Sort best → worst connectivity
        report.sort(
          (a, b) =>
            parseFloat(
              b.connectivity
            ) -
            parseFloat(
              a.connectivity
            )
        );

        return res.json({
          message:
            "CDR connectivity generated",
          report,
        });
      } catch (err) {
        console.error(err);

        return res
          .status(500)
          .json({
            message:
              "Error generating report",
          });
      }
    })

    .on("error", (err) => {
      console.error(err);

      return res
        .status(500)
        .json({
          message:
            "Error reading CSV from S3",
        });
    });
};