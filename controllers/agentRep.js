const fs = require('fs');
const csv = require('csv-parser');

module.exports = async (req, res) => {
  try {
    if (!req.files || !req.files.cdrFile || !req.files.agentFile) {
      return res.status(400).json({ message: "Both CDR and Agent files are required" });
    }

    const cdrPath = req.files.cdrFile[0].path;
    const agentPath = req.files.agentFile[0].path;

    const validNumbers = new Set();
    const agentSummary = {};

    // 🔹 Normalize phone
    const cleanPhone = (num) =>
      num ? num.toString().replace(/\D/g, '').slice(-10) : null;

    // 🔹 Normalize disposition
    const normalizeDisposition = (value) => {
      if (!value || value.trim() === "") return "Blank";

      const v = value.toLowerCase().trim();

      if (v.includes("ring")) return "Ringing";
      if (v.includes("hung")) return "Hungup";
      if (v.includes("answer")) return "Answering Machine";
      if (v.includes("less")) return "Less Than 10k";
      if (v.includes("qualify")) return "Not Qualify";
      if (v.includes("abuse")) return "Abuse";
      if (v.includes("foreign")) return "Foreign Language";
      if (v.includes("interest")) return "Not Interested";
      if (v.includes("auto")) return "Auto Dispose";
      if (v.includes("available")) return "Not Available";
      if (v.includes("wrong")) return "Wrong Number";

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
      "Wrong Number"
    ];

    // ✅ Step 1: Read CDR
    await new Promise((resolve, reject) => {
      fs.createReadStream(cdrPath)
        .pipe(csv())
        .on('data', (row) => {
          const disposition = row["Dialer Disposition"];
          const phone = cleanPhone(row["Dialed Number"]); 
          const CallType = row["Call Type"];

          if (disposition === "Answered By Agent" && phone && CallType === "OB") {
            validNumbers.add(phone);
          }
        })
        .on('end', resolve)
        .on('error', reject);
    });

    // ✅ Step 2: Read Agent File
    await new Promise((resolve, reject) => {
      fs.createReadStream(agentPath)
        .pipe(csv())
        .on('data', (row) => {
          const phone = cleanPhone(row["Phone Number"]);
          const agent = row["Agent Name"]?.trim() || "Unknown Agent";
          const rawDisposition = row["Disposition"];

          if (phone && validNumbers.has(phone)) {
            const disposition = normalizeDisposition(rawDisposition);

            if (!agentSummary[agent]) {
              agentSummary[agent] = { total: 0 };

              DISPOSITIONS.forEach(d => {
                agentSummary[agent][d] = 0;
              });
            }

            agentSummary[agent].total++;
            agentSummary[agent][disposition]++;
          }
        })
        .on('end', resolve)
        .on('error', reject);
    });

    // ✅ Final Response Format (your required format)
    const response = Object.keys(agentSummary).map(agent => ({
      agent,
      ...agentSummary[agent]
    }));

    res.json(response);

  } catch (error) {
    console.error("ERROR:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};