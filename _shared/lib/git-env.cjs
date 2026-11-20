'use strict';

/**
 * Environment variables that can redirect git to other objects, refs, config, attributes, helper programs or a hidden
 * diff. One list for every caller that spawns git on a repository it must read as it is on disk: the xprov
 * primary-checkout reads (xprov-common.cjs, xprov-allowlist.cjs) and the gate-log evidence check (gate-log.cjs).
 */
const GIT_ENV_DROP = Object.freeze([
  'GIT_DIR', 'GIT_WORK_TREE', 'GIT_COMMON_DIR', 'GIT_NAMESPACE', 'GIT_INDEX_FILE', 'GIT_OBJECT_DIRECTORY', 'GIT_ALTERNATE_OBJECT_DIRECTORIES',
  'GIT_REPLACE_REF_BASE', 'GIT_SHALLOW_FILE', 'GIT_CONFIG', 'GIT_CONFIG_GLOBAL', 'GIT_CONFIG_SYSTEM',
  'GIT_CONFIG_COUNT', 'GIT_CONFIG_PARAMETERS', 'GIT_DIFF_OPTS', 'GIT_EXTERNAL_DIFF',
  'GIT_ATTR_SOURCE', 'GIT_TEMPLATE_DIR', 'GIT_EXEC_PATH', 'GIT_GRAFT_FILE', 'GIT_NO_REPLACE_OBJECTS',
  'GIT_DEFAULT_HASH', 'GIT_DEFAULT_REF_FORMAT', 'GIT_QUARANTINE_PATH', 'GIT_CEILING_DIRECTORIES', 'GIT_DISCOVERY_ACROSS_FILESYSTEM',
  'GIT_LITERAL_PATHSPECS', 'GIT_GLOB_PATHSPECS', 'GIT_NOGLOB_PATHSPECS', 'GIT_ICASE_PATHSPECS'
]);

/** `source` (default process.env) as a NEW env without the GIT_ENV_DROP variables. */
function envWithoutGitRedirects(source) {
  const env = { ...(source || process.env) };
  for (const k of GIT_ENV_DROP) delete env[k];
  return env;
}

module.exports = { GIT_ENV_DROP, envWithoutGitRedirects };
