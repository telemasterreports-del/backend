const mongoose = require("mongoose");

const connectDB = async () => {
  const uri = process.env.MONGODB_URI;

  if (!uri) {
    console.log("MongoDB tracking disabled: MONGODB_URI is not set");
    return;
  }

  try {
    await mongoose.connect(uri, {
      dbName: process.env.DB_NAME || "telemaster",
    });

    console.log("MongoDB connected");
  } catch (error) {
    console.error("MongoDB connection failed:", error.message);
  }
};

module.exports = connectDB;
