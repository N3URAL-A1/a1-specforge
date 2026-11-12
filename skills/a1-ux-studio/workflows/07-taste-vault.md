# Step 7 — Add to taste vault

Goal: turn one good find into one taste-vault entry with five fields
(screenshot, source URL, keywords, image prompt, copy brief), so the next
diverge board can draw on it. Optional step (P2); it runs on request, not
inside a board round.

Trigger: the user says "add to taste vault", "in den Taste-Vault",
"merk dir diesen Look" or similar, with a URL or after a run. Template:
[../templates/taste-entry.md](../templates/taste-entry.md). Family ids:
[../templates/family-catalog.md](../templates/family-catalog.md). Chat with
the user in German; every file is written in English.

Entries live only in the private vault:
`$A1_VAULT_ROOT/pattern/taste-vault/<family>/<id>.md`, the screenshot beside
it as `<id>.png`. Nothing goes into the target repo, the skill folder or a
run folder.

## 1. Check the vault

`A1_VAULT_ROOT` unset or `$A1_VAULT_ROOT/pattern/` missing: stop, tell the
user in German that `A1_VAULT_ROOT` is not set or the vault is missing, and
write nothing. Never fall back to a repo folder.

## 2. Ask the fields, one at a time

One question per turn, in this order. Offer a draft where marked; the user
confirms or corrects it.

1. **Source URL** — "Welche Seite soll in den Taste-Vault?" A public
   `https://` page only: no login page, no page that shows personal data.
2. **Family** — propose the closest of the 8 catalog ids with one line of
   reason; the user confirms or names another id. Only those 8 ids are valid.
3. **Keywords** — draft 4–8 vocabulary words that name the look (materials,
   type, rhythm, colour), comma-separated, e.g. "warm paper, hairline rules,
   mono numerals". At most 12, each up to 40 characters of letters, digits,
   space and `. _ + & ' -`.
4. **Image prompt** — draft one English prompt that would generate an image
   in this look (one line, at most 1000 characters).
5. **Copy brief** — draft the voice in one line: tone, sentence length, one
   example line in English (at most 600 characters).
6. **Id** — propose a slug (`<site>-<family-hint>`, lowercase, hyphens,
   `^[a-z0-9][a-z0-9-]{0,63}$`). It becomes the file name.

Translate into English for the file; keep the user's meaning.

**No personal data.** If any answer contains an email address or a phone
number, say so in German and ask for the field again without it. Never
write it into a field. `taste.cjs add` refuses such input as well (exit 1).

Read the entry back in German in six lines and ask for a yes before 3.

## 3. Take the screenshot into the vault

Check `playwright-cli` first, exactly as
[05-gate.md](05-gate.md) section 1 (version check, install offer). Missing
and not installed: stop; the entry needs its screenshot. Never use another
screenshot tool.

Work in the entry's family folder, never in the repo. Web URLs need no
environment variable. Run the block as one shell call:

```bash
mkdir -p "$A1_VAULT_ROOT/pattern/taste-vault/<family>"
cd "$A1_VAULT_ROOT/pattern/taste-vault/<family>"
playwright-cli -s=taste-vault open --browser=chromium "<source-url>"
playwright-cli -s=taste-vault resize 1280 800
playwright-cli -s=taste-vault screenshot --filename <id>.png
playwright-cli -s=taste-vault close
```

For a local file (`file://` URL) put
`export PLAYWRIGHT_MCP_ALLOW_UNRESTRICTED_FILE_ACCESS=true` as the first
line of the block, so it covers `open`, `resize` and `screenshot`; without
it the screenshot is blank.

Then `ls -l <id>.png`: the file must exist and be larger than 0 bytes. Look
at it: a cookie banner or an empty page is a bad capture; dismiss or wait
and take it again. Page unreachable: tell the user and stop.

## 4. Write the entry

```bash
node <skill-dir>/scripts/taste/taste.cjs add \
  --vault-root "$A1_VAULT_ROOT" \
  --id <id> --family <family> \
  --source-url "<source-url>" \
  --keywords "<keywords>" \
  --image-prompt "<image-prompt>" \
  --copy-brief "<copy-brief>" \
  --screenshot pattern/taste-vault/<family>/<id>.png
```

`--screenshot` is the vault-relative path, never an absolute one; the file
must already exist (step 3). Pass every value as one quoted argument with no
line break. Exit 0 prints the vault-relative path of the new entry file.

| Exit | Action |
|------|--------|
| 0 | Entry written. Go to 5. |
| 1 | Refused: a field holds an email address or phone number, or `<id>` already exists in that family. Read the reason line, tell the user in German, fix the field or pick a new id with them, rerun. |
| 2 | Usage or hostile input: missing field, unknown family, bad slug, bad keywords, too long, line break, non-http(s) URL, screenshot not found, path traversal, `A1_VAULT_ROOT` unset. Fix the argument, rerun. |
| 3 | Internal error. Report the reason line to the user and stop. |

If the user drops the entry, delete only the `<id>.png` you took in 3.

Never write or edit the entry file by hand.

## 5. Check the pool

```bash
node <skill-dir>/scripts/taste/taste.cjs lint --root "$A1_VAULT_ROOT/pattern/taste-vault"
node <skill-dir>/scripts/run/run.cjs families --vault-root "$A1_VAULT_ROOT" --context <brand|product>
```

`lint` exits 0 (`taste lint: ok (<n> entries, <m> families)`); exit 1 lists
one problem per line, fix it with `taste.cjs` and rerun. The new entry id
appears in the `families` output under `vault_entries.<family>` (and in that
candidate's `entry_ids` when the family is one of the 5 candidates; take a
context the family is written for, see the catalog). Tell
the user in German, one line, e.g. "`<id>` liegt im Taste-Vault unter
`<family>` und steht dem nächsten Diverge-Board zur Verfügung."

## Done when

- `$A1_VAULT_ROOT/pattern/taste-vault/<family>/<id>.md` exists with all
  five fields, `type: reference`, and no email address or phone number.
- `<id>.png` sits beside it, larger than 0 bytes, and nowhere else.
- `taste.cjs lint --root …/pattern/taste-vault` exits 0, and the entry id
  appears in the next `run.cjs families --vault-root` output.
