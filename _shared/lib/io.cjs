'use strict';

// io.cjs — the shared helper facade. The helpers live in io-roots.cjs,
// io-scalar.cjs, io-frontmatter.cjs, io-nested-frontmatter.cjs and
// fs-safe.cjs (split 2026-10-08, move-only); this file keeps the export
// list stable so none of its callers change. Submodules never require it.

const fs = require('fs');
const path = require('path');
const { vaultRoot, vaultRootInfo, peekVaultRoot, codeRoots, repoRoot, resolveVaultPath, assertSafeSegment, projectsPath } = require('./io-roots.cjs');
const { serializeScalar, parseScalarToken } = require('./io-scalar.cjs');
const { parseFrontmatter, detectKeyOrder, serializeFrontmatter, readMd, writeMdAtomic } = require('./io-frontmatter.cjs');
const { parseNestedFrontmatter, serializeNestedFrontmatter, writeNestedMdAtomic } = require('./io-nested-frontmatter.cjs');
const { tmpPathFor, nearestExistingAncestor, assertAncestorInside, writeTextAtomic } = require('./fs-safe.cjs');

function nowIso() {
  return new Date().toISOString();
}

// ---------- flag parser ----------

function parseFlags(args, knownFlags) {
  const flags = { _: [] };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    let matched = false;
    for (const [name, kind] of Object.entries(knownFlags)) {
      if (a === `--${name}`) {
        if (kind === 'bool') {
          flags[name] = true;
        } else {
          flags[name] = args[++i];
        }
        matched = true;
        break;
      }
      if (kind !== 'bool' && a.startsWith(`--${name}=`)) {
        flags[name] = a.slice(`--${name}=`.length);
        matched = true;
        break;
      }
    }
    if (!matched) flags._.push(a);
  }
  return flags;
}

function fail(msg) {
  process.stderr.write(`error: ${msg}\n`);
  process.exit(1);
}

// ---------- recursive copy ----------

// Recursively copies src into dest (creates dest, overwrites existing files).
// Used to mirror gitignored directory trees (e.g. pack staging, worktree
// learning-store mirroring) where a plain git checkout would not carry them.
function copyDirRecursive(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src)) {
    const s = path.join(src, entry);
    const d = path.join(dest, entry);
    if (fs.statSync(s).isDirectory()) copyDirRecursive(s, d);
    else fs.copyFileSync(s, d);
  }
}


module.exports = { vaultRoot, vaultRootInfo, peekVaultRoot, codeRoots, repoRoot, resolveVaultPath, parseFrontmatter, serializeScalar, detectKeyOrder, serializeFrontmatter, readMd, writeMdAtomic, nowIso, writeTextAtomic, parseScalarToken, parseNestedFrontmatter, serializeNestedFrontmatter, writeNestedMdAtomic, parseFlags, fail, assertSafeSegment, projectsPath, copyDirRecursive, tmpPathFor, nearestExistingAncestor, assertAncestorInside };
