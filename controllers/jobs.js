const mongoose = require("mongoose");
const ProcessingJob = require("../models/ProcessingJob");

const isMongoConnected = () => mongoose.connection.readyState === 1;

exports.listJobs = async (req, res) => {
  try {
    if (!isMongoConnected()) {
      return res.status(503).json({
        success: false,
        message: "MongoDB tracking is not connected",
      });
    }

    const jobs = await ProcessingJob.find()
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();

    return res.json({
      success: true,
      jobs,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Unable to fetch processing jobs",
      error: error.message,
    });
  }
};

exports.getJob = async (req, res) => {
  try {
    if (!isMongoConnected()) {
      return res.status(503).json({
        success: false,
        message: "MongoDB tracking is not connected",
      });
    }

    const job = await ProcessingJob.findById(req.params.id).lean();

    if (!job) {
      return res.status(404).json({
        success: false,
        message: "Processing job not found",
      });
    }

    return res.json({
      success: true,
      job,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Unable to fetch processing job",
      error: error.message,
    });
  }
};
