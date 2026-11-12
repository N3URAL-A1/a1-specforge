<!-- a1-ux-studio taste-vault entry template (spec 024, FR-023/FR-024).
Shape of the file scripts/taste/taste.cjs add writes (formatEntry in scripts/taste/entry.cjs);
keep both in step. Entries are written only by taste.cjs add, never by hand.
Render rule: strip this leading comment (through the first "-->" line) so the frontmatter starts at line 1.
Target file: $A1_VAULT_ROOT/pattern/taste-vault/<family>/<id>.md (private vault, never the repo).
Every value is one line; the four text fields and the screenshot path are JSON strings,
keywords a JSON array of strings.
Placeholders, written below as double-brace tokens around these names:
  id            entry slug, ^[a-z0-9][a-z0-9-]{0,63}$; equals the file name and is unique in its family folder
  family        one of the 8 family ids in scripts/run/families.json; equals the folder name
  source_url    public http(s) URL the reference was taken from, no credentials
  keywords      1-12 vocabulary words that name the look, e.g. ["warm paper", "hairline rules", "mono numerals"]
  image_prompt  one prompt that would generate an image in this look (English, max 1000 chars)
  copy_brief    copy voice in one line: tone, sentence length, one example line (English, max 600 chars)
  screenshot    vault-relative path of the screenshot, e.g. "pattern/taste-vault/<family>/<id>.png"
  created       YYYY-MM-DD, set by taste.cjs
No field may contain an email address or a phone number; taste.cjs add refuses such input (exit 1).
The screenshot is an internal reference only: it never appears in a board, a result or a target repo.
-->
---
type: reference
id: {{id}}
family: {{family}}
source_url: {{source_url}}
keywords: {{keywords}}
image_prompt: {{image_prompt}}
copy_brief: {{copy_brief}}
screenshot: {{screenshot}}
created: {{created}}
---

# {{id}}
