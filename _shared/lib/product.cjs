'use strict';

// `a1-tools product ...` entry point. The commands live in product-*.cjs
// (split 2026-10-08, move-only); this file keeps the export list stable so
// a1-tools.cjs and every other caller stay unchanged.

const { PRODUCT_SLUG_RE } = require('./product-schema.cjs');
const { cmdProductValidate } = require('./product-validate.cjs');
const { cmdProductStatus, cmdProductStage, cmdProductMarkers, cmdProductChangelog } = require('./product-cmd-progress.cjs');
const { cmdProductInit, cmdProductAddMilestone, cmdProductAddFeature, cmdProductFeatureInit } = require('./product-cmd-scaffold.cjs');
const { cmdProductVisionInit, cmdProductVisionTouch } = require('./product-vision.cjs');
const { cmdProductAuditPublish, cmdProductAuditSet } = require('./product-audit.cjs');
const { cmdProductAuditMirror } = require('./product-audit-mirror.cjs');
const { cmdProductImport } = require('./product-import.cjs');

module.exports = {
  PRODUCT_SLUG_RE, // vault-sync.cjs validates CLI slugs with the same shape
  cmdProductStatus,
  cmdProductStage,
  cmdProductMarkers,
  cmdProductChangelog,
  cmdProductInit,
  cmdProductAddMilestone,
  cmdProductAddFeature,
  cmdProductFeatureInit,
  cmdProductImport,
  cmdProductValidate,
  cmdProductVisionInit,
  cmdProductVisionTouch,
  cmdProductAuditPublish,
  cmdProductAuditSet,
  cmdProductAuditMirror,
};
