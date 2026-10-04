const mongoose = require('mongoose');

const { Schema } = mongoose;
const ErrorSchema = new Schema({ field: String, message: String, rule: String }, { _id: false });

// One document per dry run (type DRY_RUN) or execution attempt (type EXECUTION).
const ExecutionSchema = new Schema(
  {
    migrationId: { type: Schema.Types.ObjectId, ref: 'Migration', required: true, index: true },
    executionId: { type: String, required: true, unique: true },
    type: { type: String, enum: ['DRY_RUN', 'EXECUTION'], required: true },
    isRetry: { type: Boolean, default: false },
    planVersion: { type: Number, required: true },
    status: { type: String, enum: ['RUNNING', 'COMPLETED', 'FAILED', 'ROLLED_BACK'], default: 'RUNNING' },
    inputHash: { type: String, default: null },
    sourceCount: { type: Number, default: 0 },
    transformedCount: { type: Number, default: 0 },
    acceptedCount: { type: Number, default: 0 },
    rejectedCount: { type: Number, default: 0 },
    insertedCount: { type: Number, default: 0 },
    duplicateCount: { type: Number, default: 0 },
    insertedTargetIds: { type: [Schema.Types.ObjectId], default: [] },
    acceptedRecords: { type: [Schema.Types.Mixed], default: [] }, // dry run preview only
    rejectedRecords: {
      type: [new Schema({ rowIndex: Number, sourceRecordId: String, sourceRecord: Schema.Types.Mixed, fieldErrors: [ErrorSchema] }, { _id: false })],
      default: [],
    },
    reconciliation: { type: Schema.Types.Mixed, default: null },
    error: { type: String, default: null },
    startedAt: { type: Date, default: Date.now },
    completedAt: { type: Date, default: null },
    rolledBackAt: { type: Date, default: null },
  },
  { timestamps: true, minimize: false }
);

module.exports = mongoose.models.MigrationExecution || mongoose.model('MigrationExecution', ExecutionSchema);
