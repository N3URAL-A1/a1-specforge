#!/usr/bin/env bash
# cases/12-plist.sh — spec 011 Wave 11: the LaunchAgent template
# _shared/templates/ai.n3ural.a1-intent-tick.plist. Rendered with dummy
# values and read by an independent plist parser (python3 plistlib, on macOS
# and Linux alike; plutil -lint as well where it exists). Nothing is
# installed: no launchctl call, no file under the real ~/Library.

P12_TEMPLATE="$REPO_ROOT/_shared/templates/ai.n3ural.a1-intent-tick.plist"
new_sandbox p12
p12_out="$SB/ai.n3ural.a1-intent-tick.plist"
sed -e '/<!--A1_HOST_ID-->/,/<!--\/A1_HOST_ID-->/d' -e 's#{{NODE}}#/usr/local/bin/node#; s#{{A1_TOOLS}}#/opt/a1/_shared/a1-tools.cjs#; s#{{HOME}}#/Users/fixture#g; s#{{PATH}}#/usr/local/bin:/usr/bin:/bin#; s#{{A1_VAULT_ROOT}}#/Users/fixture/vault#' \
  "$P12_TEMPLATE" >"$p12_out"
p12_json="$(python3 -c 'import json, plistlib, sys; print(json.dumps(plistlib.load(open(sys.argv[1], "rb"))))' "$p12_out" 2>&1)"
p12="$(node -e 'let o; try { o = JSON.parse(process.argv[1]); } catch (e) { console.log("<not a plist> " + process.argv[1].slice(0, 200)); process.exit(0); }
  const env = o.EnvironmentVariables || {};
  console.log([o.Label, o.StartInterval, o.RunAtLoad, o.ProcessType, o.ProgramArguments.join(" "), o.StandardOutPath, o.StandardErrorPath,
    Object.keys(env).sort().join(","), Object.keys(env).some((k) => k.startsWith("A1_INTENT_"))].join("|"));' "$p12_json")"
p12_want="ai.n3ural.a1-intent-tick|30|true|Background|/usr/local/bin/node /opt/a1/_shared/a1-tools.cjs intent tick|/Users/fixture/.a1-intents/agent.log|/Users/fixture/.a1-intents/agent.log|A1_VAULT_ROOT,PATH|false"
if [[ "$p12" == "$p12_want" ]]; then
  ok "P1 the rendered LaunchAgent template parses (plistlib): label, StartInterval 30, RunAtLoad, Background, ProgramArguments ending 'intent tick', log outside the vault, env exactly PATH and A1_VAULT_ROOT, no A1_INTENT_* key [FR-032, FR-046]"
else bad "P1 the rendered LaunchAgent template parses (plistlib): label, StartInterval 30, RunAtLoad, Background, ProgramArguments ending 'intent tick', log outside the vault, env exactly PATH and A1_VAULT_ROOT, no A1_INTENT_* key [FR-032, FR-046]" "got:  $p12" "want: $p12_want"; fi
p12_left="$(grep -c '{{' "$p12_out")"
p12_lint="skipped"
if command -v plutil >/dev/null 2>&1; then p12_lint="$(plutil -lint "$p12_out" >/dev/null 2>&1 && echo ok || echo fail)"; fi
if [[ "$p12_left" == 0 && "$p12_lint" != fail ]]; then ok "P2 every placeholder of the template is filled by the five values (NODE, A1_TOOLS, HOME, PATH, A1_VAULT_ROOT) once the optional A1_HOST_ID block is dropped; plutil -lint $p12_lint [FR-032]"
else bad "P2 every placeholder of the template is filled by the five values (NODE, A1_TOOLS, HOME, PATH, A1_VAULT_ROOT) once the optional A1_HOST_ID block is dropped; plutil -lint $p12_lint [FR-032]" "placeholders left: $p12_left"; fi

# P3 (Reinhard W11 minor): the optional A1_HOST_ID block. launchd reads no ~/.zshenv, so the installer
# renders the host id into the plist when it is set; spec 010's writer gate would otherwise fall back to the
# OS hostname. Rendered with a value the block survives and carries it; without one (P1) it is gone.
p12_host="$SB/with-host.plist"
sed -e 's#{{A1_HOST_ID}}#mac-fixture#' -e 's#{{NODE}}#/usr/local/bin/node#; s#{{A1_TOOLS}}#/opt/a1/_shared/a1-tools.cjs#; s#{{HOME}}#/Users/fixture#g; s#{{PATH}}#/usr/local/bin:/usr/bin:/bin#; s#{{A1_VAULT_ROOT}}#/Users/fixture/vault#' \
  "$P12_TEMPLATE" >"$p12_host"
p12h="$(python3 -c 'import json, plistlib, sys; e = plistlib.load(open(sys.argv[1], "rb"))["EnvironmentVariables"]; print(",".join(sorted(e)) + "|" + e.get("A1_HOST_ID", ""))' "$p12_host" 2>&1)"
p12h_left="$(grep -c '{{' "$p12_host")"
p12h_lint="skipped"
if command -v plutil >/dev/null 2>&1; then p12h_lint="$(plutil -lint "$p12_host" >/dev/null 2>&1 && echo ok || echo fail)"; fi
if [[ "$p12h" == "A1_HOST_ID,A1_VAULT_ROOT,PATH|mac-fixture" && "$p12h_left" == 0 && "$p12h_lint" != fail ]]; then
  ok "P3 rendered with a host id the template carries A1_HOST_ID (env exactly A1_HOST_ID, A1_VAULT_ROOT, PATH), no placeholder left; plutil -lint $p12h_lint [FR-032, spec 010 FR-034]"
else bad "P3 rendered with a host id the template carries A1_HOST_ID (env exactly A1_HOST_ID, A1_VAULT_ROOT, PATH), no placeholder left; plutil -lint $p12h_lint [FR-032, spec 010 FR-034]" "got: $p12h" "placeholders left: $p12h_left"; fi
