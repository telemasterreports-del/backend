const mongoose = require("mongoose");
const LeadPerformance = require("../models/LeadPerformance");
const connectDB = require("../config/db");

module.exports = async (req, res) => {
  if (mongoose.connection.readyState !== 1) await connectDB();

  if (mongoose.connection.readyState !== 1) {
    return res.json({
      trackingAvailable: false,
      records: [],
      message: "Lead history requires a MongoDB connection.",
    });
  }

  try {
    const records = await LeadPerformance.find({})
      .sort({ usedAt: -1, lead: 1 })
      .limit(10000)
      .lean();

    return res.json({ trackingAvailable: true, records });
  } catch (error) {
    console.error("Lead history error:", error);
    return res.status(500).json({ message: "Unable to load lead history." });
  }
};
