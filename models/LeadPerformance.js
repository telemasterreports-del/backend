const mongoose = require("mongoose");

const leadPerformanceSchema = new mongoose.Schema(
  {
    uploadId: {
      type: String,
      required: true,
      index: true,
    },
    lead: {
      type: String,
      required: true,
      index: true,
    },
    totalCalls: {
      type: Number,
      default: 0,
    },
    connectivity: {
      type: Number,
      default: 0,
    },
    usedAt: {
      type: Date,
      default: Date.now,
      index: true,
    },
  },
  { timestamps: true }
);

leadPerformanceSchema.index({ lead: 1, usedAt: -1 });

module.exports = mongoose.model("LeadPerformance", leadPerformanceSchema);
