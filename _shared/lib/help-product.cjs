'use strict';

// Help text of the product module feature (spec 023-module-roadmap-views, FR-015). Kept out of help.cjs (size).
const PRODUCT_MODULES_HELP = `  Product modules (spec 023-module-roadmap-views). Optional grouping of milestones into modules, with generated
                  per-module views. Without any \`module:\` key every product command behaves as before.
                  Frontmatter of docs/product/ROADMAP.md:
                    modules: [<slug>, ...]    Optional vocabulary list of kebab-case slugs, emitted directly before milestones.
                    module: <slug>            Optional key on a milestone (kebab-case), emitted directly after target.
                  Validation ('product validate'): a malformed slug is an error. When \`modules:\` is present, a milestone
                  whose module is not listed fails with "module: '<slug>' is not in modules". Without \`modules:\` the
                  tagged milestones define the modules in use. Warnings (exit unchanged): some milestones are tagged and
                  others not (the untagged ones show only under "Unassigned milestones"), or \`modules:\` is listed but no
                  milestone has a module.
                  Generated views: when at least one module is in use, every state-changing product command also writes
                  docs/product/modules/<module>/ROADMAP.md and docs/product/modules/<module>/NEXT.md, inside the same
                  lock + tmp/rename all-or-nothing transaction as index.json and NEXT.md. These files are generated, do not edit
                  them by hand; the next state-changing command (for example 'product changelog') overwrites them.
                  A module that is no longer in use has its generated directory removed.
                  Cursor: the derived per-module cursor is the first feature of the module, in roadmap order, that is not
                  done or cancelled and whose depends_on are all done. The project NEXT.md gains a "Next per module"
                  section (one cursor line per module) and an "Unassigned milestones" section; both appear only when a module
                  is in use.
                  a1-tools product add-milestone --id <slug> --title <title> --module <slug>
                  The \`--module <slug>\` flag is optional. The value is validated by the rules above before any write
                  (an invalid value exits non-zero and writes nothing) and is stored as \`module:\` on the new milestone.
                  Changing the module of an existing milestone is a hand edit of the ROADMAP.md frontmatter.
                  'product status' keeps its keys; milestone entries carry \`module\` as in the frontmatter. When a module is
                  in use, the output gains a top-level \`modules\` array identical to index.json \`modules\`.
                  Commands that rewrite ROADMAP.md frontmatter keep \`modules:\` and every \`module:\` unchanged.
                  Adopt and import never write module keys and do not require them. A project without modules gets
                  index.json, NEXT.md and ROADMAP.md that are byte-identical to the output before this feature (no
                  modules/ directory, no new sections, no new keys).`;

module.exports = { PRODUCT_MODULES_HELP };
