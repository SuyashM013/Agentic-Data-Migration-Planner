const mongoose = require('mongoose');

const { Schema } = mongoose;

const QuarantineRecordSchema = new Schema(
  {
    migrationId: { type: Schema.Types.ObjectId, ref: 'Migration', required: true, index: true },
    executionId: { type: String, required: true },
    planVersion: { type: Number, required: true },
    rowIndex: { type: Number, required: true }, // 0-based position in the source sample
    sourceRecordId: { type: String, default: null },
    sourceRecord: { type: Schema.Types.Mixed, required: true }, // original, untouched
    fieldErrors: { type: [new Schema({ field: String, message: String, rule: String }, { _id: false })], default: [] },
  },
  { timestamps: { createdAt: true, updatedAt: false }, minimize: false }
);
QuarantineRecordSchema.index({ migrationId: 1, executionId: 1, rowIndex: 1 }, { unique: true });

module.exports = mongoose.models.QuarantineRecord || mongoose.model('QuarantineRecord', QuarantineRecordSchema);
