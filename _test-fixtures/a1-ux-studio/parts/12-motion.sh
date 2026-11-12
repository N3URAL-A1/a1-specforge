# Part 12 — motion templates: house rules per template (spec 024-ux-studio, FR-029).
#
# Reads the real templates under skills/a1-ux-studio/templates/motion/. Every case header names the
# single production edit that turns it red. Playwright evidence (reduced-motion emulation) is a
# manual gate recorded in STATUS, not part of this suite.

unset A1_VAULT_ROOT A1_VAULT_WRITER_HOST A1_HOST_ID

MO_DIR="${MO_DIR_OVERRIDE:-$REPO_ROOT/skills/a1-ux-studio/templates/motion}"

# mo_check <file> <rule> — exit 0 when the template satisfies the rule, prints the reason otherwise.
#   reduced : a prefers-reduced-motion: reduce block whose body sets `animation: none` and `transition: none`
#   mobile  : an @media (max-width: ...) block that displays .a1-motion-still (display: block)
#   props   : @keyframes properties and transition properties are only transform and opacity
#   remote  : no http(s):// resource
mo_check() {
  node -e '
    const fs = require("fs");
    const [file, rule] = process.argv.slice(1);
    const css = fs.readFileSync(file, "utf8");
    // balanced-brace body of the first @media/@keyframes whose header matches re
    const blocks = (re) => {
      const out = []; let m; const g = new RegExp(re.source, "g");
      while ((m = g.exec(css))) {
        let i = css.indexOf("{", m.index), depth = 0, j = i;
        for (; j < css.length; j += 1) { if (css[j] === "{") depth += 1; if (css[j] === "}") { depth -= 1; if (depth === 0) break; } }
        out.push(css.slice(i + 1, j));
      }
      return out;
    };
    const fail = (why) => { console.log(why); process.exit(1); };
    if (rule === "reduced") {
      const b = blocks(/@media\s*\(\s*prefers-reduced-motion\s*:\s*reduce\s*\)/).join("\n");
      if (!b) fail("no reduced-motion block");
      if (!/animation\s*:\s*none/.test(b) || !/transition\s*:\s*none/.test(b)) fail("reduced-motion block does not stop animation and transition");
    } else if (rule === "mobile") {
      const b = blocks(/@media\s*\(\s*max-width\s*:\s*\d+px\s*\)/).join("\n");
      if (!/\.a1-motion-still[^{}]*\{[^}]*display\s*:\s*block/.test(b)) fail("no mobile rule that shows .a1-motion-still");
      if (!/<img[^>]*class="a1-motion-still"/.test(fs.readFileSync(file, "utf8"))) fail("no still image element");
    } else if (rule === "props") {
      const kf = blocks(/@keyframes\s+[\w-]+/);
      if (kf.length === 0) { if (!/transition\s*:/.test(css)) fail("no keyframes and no transition"); }
      for (const body of kf) for (const d of body.matchAll(/([\w-]+)\s*:/g)) {
        if (!["transform", "opacity"].includes(d[1])) fail("keyframes animate " + d[1]);
      }
      for (const t of css.matchAll(/(?:^|[;{\s])transition\s*:\s*([^;}]+)/g)) {
        for (const part of t[1].split(",")) { const p = part.trim().split(/\s+/)[0]; if (p !== "none" && !["transform", "opacity"].includes(p)) fail("transition on " + p); }
      }
      const tp = css.match(/transition-property\s*:\s*([^;}]+)/g) || [];
      for (const x of tp) for (const p of x.split(":")[1].split(",")) if (!["transform", "opacity"].includes(p.trim())) fail("transition-property " + p.trim());
    } else if (rule === "remote") {
      if (/https?:\/\//i.test(css.replace(/<!--[\s\S]*?-->/g, ""))) fail("remote resource");
    }
  ' "$1" "$2"
}

mo_files=("$MO_DIR"/*.html)
if [[ ! -e "${mo_files[0]}" ]] || ! command -v node >/dev/null 2>&1; then
  bad "MO0 [FR-029] motion templates present under templates/motion/"
else
  # MO1 RED: delete one template file from templates/motion/ (count drops to 2).
  if [[ ${#mo_files[@]} -ge 3 ]]; then ok "MO1 [FR-029] at least 3 motion templates (${#mo_files[@]})"; else bad "MO1 [FR-029] only ${#mo_files[@]} templates"; fi

  for rule in reduced mobile props remote; do
    case "$rule" in
      reduced) id=MO2; what="a prefers-reduced-motion block stopping animation and transition";;
      mobile)  id=MO3; what="a mobile rule that swaps in a still image";;
      props)   id=MO4; what="only transform and opacity animated (no top/left/width/height or other property)";;
      remote)  id=MO5; what="no remote resource";;
    esac
    # MO2 RED: delete the @media (prefers-reduced-motion: reduce) block from one template.
    # MO3 RED: delete the @media (max-width: 640px) block or the .a1-motion-still img from one template.
    # MO4 RED: add `left` to a @keyframes block or `transition: width .3s` to one template.
    # MO5 RED: add an http(s):// url() or src to one template.
    miss=""; for f in "${mo_files[@]}"; do why="$(mo_check "$f" "$rule" 2>&1)" || miss="$miss $(basename "$f"):$why"; done
    if [[ -z "$miss" ]]; then ok "$id [FR-029] every template has $what"; else bad "$id [FR-029] $what —$miss"; fi
  done

  # MO6 RED: weaken the mo_check "reduced" rule's animation test (the checker would accept a block that stops nothing).
  mk_workdir MO_BAD ux-mo-bad
  sed 's/animation: none !important; transition: none !important;/color: inherit;/' "${mo_files[0]}" > "$MO_BAD/x.html"
  sed 's/@keyframes \([a-z0-9-]*\) {/@keyframes \1 { 0% { left: 0; }/' "${mo_files[0]}" > "$MO_BAD/y.html"
  grep -v 'prefers-reduced-motion' "${mo_files[0]}" > "$MO_BAD/z.html"
  mo_check "$MO_BAD/x.html" reduced >/dev/null 2>&1; r1=$?
  mo_check "$MO_BAD/y.html" props >/dev/null 2>&1; r2=$?
  mo_check "$MO_BAD/z.html" reduced >/dev/null 2>&1; r3=$?
  if [[ $r1 -ne 0 && $r2 -ne 0 && $r3 -ne 0 ]]; then ok "MO6 [FR-029] the checker itself rejects a template with a neutered reduced-motion block, an animated left, and no block"
  else bad "MO6 [FR-029] checker accepts a bad template (reduced=$r1 props=$r2 noblock=$r3)"; fi
fi
