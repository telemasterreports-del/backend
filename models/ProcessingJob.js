const mongoose = require("mongoose");

const fileSchema = new mongoose.Schema(
  {
    label: String,
    zone: String,
    state: String,
    fileName: String,
    url: String,
    rowCount: {
      type: Number,
      default: 0,
    },
  },
  { _id: false }
);

const processingJobSchema = new mongoose.Schema(
  {
    originalFileName: {
      type: String,
      required: true,
    },
    uploadedFilePath: String,
    processType: {
      type: String,
      default: "timezone_split",
    },
    selectedTimezone: {
      type: String,
      default: "ALL",
    },
    selectedStates: {
      type: [String],
      default: [],
    },
    selectedStateCounts: {
      type: Map,
      of: Number,
      default: {},
    },
    totalInputRows: {
      type: Number,
      default: 0,
    },
    totalOutputRows: {
      type: Number,
      default: 0,
    },
    stateExtracts: {
      type: [fileSchema],
      default: [],
    },
    timezoneOutputs: {
      type: [fileSchema],
      default: [],
    },
    status: {
      type: String,
      enum: ["processing", "completed", "failed"],
      default: "processing",
    },
    error: String,
    startedAt: {
      type: Date,
      default: Date.now,
    },
    completedAt: Date,
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model("ProcessingJob", processingJobSchema);
