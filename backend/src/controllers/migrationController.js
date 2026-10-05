const svc = require('../services/migrationService');
const analysis = require('../services/analysisService');
const approval = require('../services/approvalService');
const dryRun = require('../services/dryRunService');
const execution = require('../services/executionService');
const rollback = require('../services/rollbackService');
const views = require('../services/dataViewService');


const { getConfig } = require('../config');
const { SUPPORTED_TRANSFORMATIONS, SCHEMA_TYPES } = require('../constants');

// Migrations routes
exports.create = async (req, res) => res.status(201).json(await svc.createMigration(req.body));

exports.list = async (req, res) => res.json(await svc.listMigrations());

exports.get = async (req, res) => res.json(await svc.getMigrationDetail(req.params.id));

exports.history = async (req, res) => res.json(await svc.getHistory(req.params.id));

exports.config = (req, res) => {
  const cfg = getConfig();
  res.json({
    maxSampleRecords: cfg.maxSampleRecords,
    supportedTransformations: SUPPORTED_TRANSFORMATIONS,
    schemaTypes: SCHEMA_TYPES,
    aiProvider: cfg.ai.provider,
  });
};

// Analysis route
exports.analyze = async (req, res) => res.json(await analysis.analyzeMigration(req.params.id));

// Demo data route
exports.demoData = (req, res) => res.json(require('../seed/demoData').buildDemoDatasets());

// Approve or Rejection routes
exports.approve = async (req, res) => res.json(await approval.approvePlan(req.params.id, req.body));

exports.reject = async (req, res) => res.json(await approval.rejectPlan(req.params.id, req.body));


// dry run route
exports.dryRun = async (req, res) => res.json(await dryRun.runDryRun(req.params.id));

// execution run route
exports.execute = async (req, res) => res.json(await execution.executeMigration(req.params.id));

// rollback route
exports.rollback = async (req, res) => res.json(await rollback.rollbackMigration(req.params.id));

// failed records
exports.quarantine = async (req, res) => res.json(await views.listQuarantine(req.params.id));

// target records
exports.targetRecords = async (req, res) => res.json(await views.listTargetRecords(req.params.id));
