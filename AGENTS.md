# dsh-archived-sessions project notes

- This is a persistent, independent DSH Web Profile Cordis Bundle, not a Dynamic Cordis Plugin.
- Source repository path: `%DSH_HOME%\profiles\web\packages\dsh-archived-sessions`.
- Never modify the DSH Runtime checkout to implement this plugin.
- Host source: `lib/index.js`; Client source of truth: `src/client-module.js`; generated Client artifact: `lib/client.js`.
- After Client edits run `pnpm bundle`; before commit run `pnpm verify` and `pnpm pack --dry-run`.
- UI must remain additive through `settings.section`; render the archive list and restore controls directly in that page. Do not add a sidebar entry, secondary overlay, replace shell-level slots, or hard-code DSH DOM selectors.
- Restore must prefer a future official `unarchiveSession()` method and verify authoritative membership afterward. The rc.2 compatibility adapter must remain fail-closed, require unique archive IDs plus the exact audited method hashes, re-check inside the workspace operation queue, and remove only one id while preserving every other state field.
- After a DSH upgrade run `pnpm verify:runtime -- <actual-checkout>` and mandatory GUI checks; never widen fingerprints or `engines.dsh` without reviewing the new implementation.
- Do not stop or restart DSH. If installation changes need a restart, tell the user to perform it.
- Preserve independent Git history when installing, moving, or removing the plugin.
