const express = require('express');
const ctrl = require('../controllers/migrationController');
const asyncHandler = require('../utils/asyncHandler');

const router = express.Router();

router.post('/', asyncHandler(ctrl.create));
router.get('/', asyncHandler(ctrl.list));
router.get('/:id', asyncHandler(ctrl.get));
router.post('/:id/analyze', asyncHandler(ctrl.analyze));
router.post('/:id/approve', asyncHandler(ctrl.approve));
router.post('/:id/reject', asyncHandler(ctrl.reject));
router.post('/:id/dry-run', asyncHandler(ctrl.dryRun));
router.post('/:id/execute', asyncHandler(ctrl.execute));
router.post('/:id/rollback', asyncHandler(ctrl.rollback));
router.get('/:id/quarantine', asyncHandler(ctrl.quarantine));
router.get('/:id/target-records', asyncHandler(ctrl.targetRecords));
router.get('/:id/history', asyncHandler(ctrl.history));

module.exports = router;
