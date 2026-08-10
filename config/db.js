const mongoose = require("mongoose");

let connectionPromise = null;

const connectDB = async () => {
  if (mongoose.connection.readyState === 1) return true;
  if (connectionPromise) return connectionPromise;

  const uri = process.env.MONGODB_URI;

  if (!uri) {
    console.log("MongoDB tracking disabled: MONGODB_URI is not set");
    return false;
  }

  connectionPromise = mongoose
    .connect(uri, {
      dbName: process.env.DB_NAME || "telemaster",
      family: 4,
      serverSelectionTimeoutMS: 10000,
    })
    .then(() => {
      console.log("MongoDB connected");
      return true;
    })
    .catch((error) => {
      console.error("MongoDB connection failed:", error.message);
      return false;
    })
    .finally(() => {
      connectionPromise = null;
    });

  return connectionPromise;
};

module.exports = connectDB;
