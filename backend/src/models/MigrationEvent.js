const mongoose = require('mongoose');

// Append-only audit trail. There is intentionally no update/delete code path for this collection.
const MigrationEventSchema = new mongoose.Schema(
  {
    migrationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Migration', required: true, index: true },
    type: { type: String, required: true },
    message: { type: String, default: '' },
    actor: { type: String, default: 'system' },
    planVersion: { type: Number, default: null },
    executionId: { type: String, default: null },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: { createdAt: true, updatedAt: false }, minimize: false }
);
MigrationEventSchema.index({ migrationId: 1, createdAt: 1 });

module.exports = mongoose.models.MigrationEvent || mongoose.model('MigrationEvent', MigrationEventSchema);
