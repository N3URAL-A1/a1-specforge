# Rendering the demo GIF (for Robert)

The demo GIF is **not committed yet** — `vhs` was not installed in the build
environment, so `docs/demo.tape` was committed as the reproducible source only.

To render `docs/assets/demo.gif` on your machine:

```bash
brew install vhs ttyd ffmpeg    # vhs pulls ttyd + ffmpeg as deps
cd /path/to/a1-specforge
vhs docs/demo.tape              # writes docs/assets/demo.gif
du -h docs/assets/demo.gif     # keep under ~5 MB; reduce Width/Height or Sleeps if larger
git add docs/assets/demo.gif && git commit -m "docs(launch): render demo GIF"
```

Then uncomment the GIF line in `README.md` (there is a `TODO(Robert)` marker
directly under the title pointing here).

The tape runs three real commands against the repo's own test fixtures — no
faked output. If the CLI output format changes, re-run `vhs docs/demo.tape` to
regenerate the GIF from the same source.
