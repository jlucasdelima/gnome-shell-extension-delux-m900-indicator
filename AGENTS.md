## Agent skills

### Issue tracker

Issues are tracked in this repo's GitHub Issues, via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Default vocabulary: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `GLOSSARY.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.

### Extension review

`pack.sh` builds the zip uploaded to extensions.gnome.org, so every change to `extension/` must pass its review guidelines: https://gjs.guide/extensions/review-guidelines/review-guidelines.html (undo in `disable()` everything `enable()` did, no helper scripts or binaries, nothing in the zip the extension does not use).
