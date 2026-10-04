const mongoose = require('mongoose');
const { STATUS, CONFIDENCE, TRANSFORMATION_NAMES } = require('../constants');

const { Schema } = mongoose;

const MappingSchema = new Schema(
  {
    sourceField: { type: String, required: true },
    targetField: { type: String, required: true },
    transformation: { type: String, enum: TRANSFORMATION_NAMES, default: 'none' },
    confidence: { type: String, enum: CONFIDENCE, default: 'medium' },
    reason: { type: String, default: '' },
  },
  { _id: false }
);

// Every plan version is stored; versions are never overwritten (only their status changes).
const PlanSchema = new Schema(
  {
    version: { type: Number, required: true },
    createdBy: { type: String, enum: ['ai', 'user'], required: true },
    createdByLabel: { type: String, default: '' }, // e.g. "ai:openai:gpt-4o-mini" or "user:reviewer"
    basedOnVersion: { type: Number, default: null },
    createdAt: { type: Date, default: Date.now },
    mappings: { type: [MappingSchema], default: [] },
    unmappedSourceFields: { type: [String], default: [] },
    unmappedTargetFields: { type: [String], default: [] },
    risks: { type: [new Schema({ severity: String, message: String, source: String }, { _id: false })], default: [] },
    clarificationQuestions: { type: [String], default: [] },
    agentActivity: {
      type: [new Schema({ step: String, tool: String, status: String, summary: String, at: Date }, { _id: false })],
      default: [],
    },
    validation: {
      valid: { type: Boolean, default: false },
      problems: { type: [String], default: [] },
      warnings: { type: [String], default: [] },
    },
    status: { type: String, enum: ['PROPOSED', 'APPROVED', 'REJECTED', 'SUPERSEDED'], default: 'PROPOSED' },
    approvedBy: { type: String, default: null },
    approvedAt: { type: Date, default: null },
    rejectedAt: { type: Date, default: null },
    rejectionReason: { type: String, default: null },
  },
  { _id: false }
);

const MigrationSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    sourceSchema: { type: Schema.Types.Mixed, required: true },
    targetSchema: { type: Schema.Types.Mixed, required: true },
    sampleRecords: { type: [Schema.Types.Mixed], default: [] },
    sampleCount: { type: Number, default: 0 },
    plans: { type: [PlanSchema], default: [] },
    currentPlanVersion: { type: Number, default: 0 },
    approvedPlanVersion: { type: Number, default: null },
    status: { type: String, enum: Object.values(STATUS), default: STATUS.DRAFT, index: true },
    approval: {
      approvedBy: { type: String, default: null },
      approvedAt: { type: Date, default: null },
      planVersion: { type: Number, default: null },
    },
    lastError: { type: String, default: null },
  },
  { timestamps: true, minimize: false }
);

module.exports = mongoose.models.Migration || mongoose.model('Migration', MigrationSchema);
