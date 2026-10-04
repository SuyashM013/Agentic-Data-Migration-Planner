const mongoose = require('mongoose');
const logger = require('./utils/logger');

async function connectDb(uri) {
  mongoose.set('strictQuery', true);
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
  logger.info('db_connected', { host: mongoose.connection.host, name: mongoose.connection.name });
}

module.exports = { connectDb };
