process.env.NODE_ENV = 'test';
process.env.AI_PROVIDER = 'mock';

const mongoose = require('mongoose');
const models = require('../../src/models');
const { ensureIndexes } = require('../../src/models/ensureIndexes');

let mongod;

/** Uses MONGODB_TEST_URI if provided (any Mongo-compatible server), otherwise an in-memory MongoDB. */
async function connect() {
  let uri;
  if (process.env.MONGODB_TEST_URI) {
    uri = `${process.env.MONGODB_TEST_URI.replace(/\/$/, '')}/wb_test_${process.pid}_${Date.now()}`;
  } else {
    const { MongoMemoryServer } = require('mongodb-memory-server');
    mongod = await MongoMemoryServer.create();
    uri = mongod.getUri('wb_test');
  }
  await mongoose.connect(uri);
  await ensureIndexes();
}

async function reset() {
  await Promise.all(Object.values(models).map((m) => m.deleteMany({})));
}

async function disconnect() {
  if (process.env.MONGODB_TEST_URI) await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  if (mongod) await mongod.stop();
}

module.exports = { connect, reset, disconnect };
