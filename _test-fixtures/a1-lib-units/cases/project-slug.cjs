'use strict';

// project-slug.cjs (bug project-slug-source): both helpers return a safe name or null, never a raw checkout basename.
// Real fs: temp dirs, a real linked-worktree layout (.git file -> gitdir -> commondir). Literals only.
//
// Measured red 2026-11-25 (one edit each in a scratch copy of project-slug.cjs, this file run):
//   projectSlug / repoProjectSlug return the basename without safeName()   -> PS1, PS2, PS3, PS5
//   SAFE_NAME_RE tightened to lower case only (SLUG_RE)                    -> PS4
//   safeName() returns the name without toLowerCase() (2026-11-26)          -> PS4
//   SAFE_NAME_RE not exported                                              -> PS6
//   opts.slug bypasses safeName()                                          -> PS2 (a ROADMAP bypass is unobservable: roadmapProject already checks SLUG_RE)
//   PS7 is a green control: the ROADMAP project and a valid opts.slug still win

const fs = require('fs');
const path = require('path');
const { check, eq, done } = require('../lib.cjs');

const LIB = process.argv[2];
const WORK = fs.mkdtempSync(path.join(process.argv[3], 'ps-'));
const P = require(path.join(LIB, 'project-slug.cjs'));

const mk = (name) => { const d = path.join(WORK, name); fs.mkdirSync(d, { recursive: true }); return d; };

// PS1 a basename outside the safe pattern gives null from both helpers
for (const name of ['My Repo', 'bad\nname', '.hidden', '-lead', 'a'.repeat(102)]) {
  const d = mk(name);
  eq(`PS1 repoProjectSlug(${JSON.stringify(name.slice(0, 12))}) is null`, P.repoProjectSlug(d), null);
  eq(`PS1 projectSlug(${JSON.stringify(name.slice(0, 12))}) is null`, P.projectSlug({ project: d }), null);
}

// PS2 an unsafe opts.slug is null, not passed through
eq('PS2 projectSlug with an unsafe opts.slug', P.projectSlug({ slug: 'a b', project: mk('ps2') }), null);

// PS3 a linked worktree of an unsafe main checkout: repoProjectSlug follows the main checkout, so null
{
  const main = mk('Main Repo');
  fs.mkdirSync(path.join(main, '.git', 'worktrees', 'wt'), { recursive: true });
  fs.writeFileSync(path.join(main, '.git', 'worktrees', 'wt', 'commondir'), '../..\n');
  const wt = mk('wt-safe');
  fs.writeFileSync(path.join(wt, '.git'), `gitdir: ${path.join(main, '.git', 'worktrees', 'wt')}\n`);
  eq('PS3 worktree of "Main Repo": repoProjectSlug is null', P.repoProjectSlug(wt), null);
  eq('PS3 control: projectSlug sees the worktree name', P.projectSlug({ project: wt }), 'wt-safe');
}

// PS4 mixed case is a safe name (fixture temp dirs carry mixed-case suffixes) and comes back lower-cased,
// so Foo and foo name one store file on every host (owner decision 2026-11-26)
eq('PS4 mixed-case basename is lower-cased', P.repoProjectSlug(mk('Tmp.aB3x_Q-9')), 'tmp.ab3x_q-9');
eq('PS4 projectSlug lower-cases the folder name and opts.slug', [P.projectSlug({ project: mk('Proj-C') }), P.projectSlug({ slug: 'Given-X', project: mk('ps4') })], ['proj-c', 'given-x']);

// PS5 a safe basename is returned as is
eq('PS5 safe basename', [P.repoProjectSlug(mk('proj-a')), P.projectSlug({ project: mk('proj-b') })], ['proj-a', 'proj-b']);

// PS6 SAFE_NAME_RE is the one shared pattern
check('PS6 SAFE_NAME_RE accepts Ab-1 and refuses a newline suffix, a space, empty', P.SAFE_NAME_RE instanceof RegExp && P.SAFE_NAME_RE.test('Ab-1') && !P.SAFE_NAME_RE.test('a\n') && !P.SAFE_NAME_RE.test('a b') && !P.SAFE_NAME_RE.test(''));

// PS7 the ROADMAP project and a valid opts.slug still win over the folder name
{
  const d = mk('Odd Folder');
  fs.mkdirSync(path.join(d, 'docs', 'product'), { recursive: true });
  fs.writeFileSync(path.join(d, 'docs', 'product', 'ROADMAP.md'), '---\nproject: road-proj\n---\n# R\n');
  eq('PS7 ROADMAP project beats an unsafe folder name', [P.repoProjectSlug(d), P.projectSlug({ project: d })], ['road-proj', 'road-proj']);
  eq('PS7 a valid opts.slug wins', P.projectSlug({ slug: 'given', project: d }), 'given');
}

done();
