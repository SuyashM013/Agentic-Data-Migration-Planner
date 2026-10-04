const mongoose = require('mongoose');

const { Schema } = mongoose;

// The "mock target database / staging store". Records land here only via the deterministic execution service.
const TargetRecordSchema = new Schema(
  {
    migrationId: { type: Schema.Types.ObjectId, ref: 'Migration', required: true, index: true },
    executionId: { type: String, required: true, index: true },
    planVersion: { type: Number, required: true },
    // Idempotency key: `${migrationId}:${sourceRecordId}`. The unique index makes retries safe even under races.
    idempotencyKey: { type: String, required: true, unique: true },
    sourceRecordId: { type: String, required: true },
    data: { type: Schema.Types.Mixed, required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false }, minimize: false }
);

module.exports = mongoose.models.TargetRecord || mongoose.model('TargetRecord', TargetRecordSchema);
