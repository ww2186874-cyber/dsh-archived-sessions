# Compatibility contract

## Stable integration surface

The plugin intentionally depends on additive, published DSH extension surfaces:

- Profile Bundle metadata (`dsh.bundle`, `dsh.client`);
- Cordis lifecycle and `ctx.effect()`;
- Host services `workspaceRegistry`, `sessionQuery`, and `webServer`;
- Client slot `settings.section`;
- root standard prop `useWorkspaces` supplied by the Slot renderer.

It does not edit the DSH Runtime checkout, replace `root`, `sidebar`, `conversation`, or `details`, inspect product DOM nodes, claim the SPA fallback route, or patch browser history.

## Native restore path

When DSH adds a callable `workspaceRegistry.unarchiveSession(sessionId)`, that method is selected automatically. The compatibility adapter is not used in that case. The plugin does not trust the method name alone as proof of success: it re-reads the authoritative archive set and reports success only after the target id is absent.

## DSH 0.1.1-rc.2 adapter

DSH rc.2 persists a registry-global `archivedSessionIds` array. Its own source contract states that archived sessions retain their workspace accounting slot so a future unarchive restores the same position. The rc.2 adapter therefore performs only this transition:

```text
{ ...state, archivedSessionIds: state.archivedSessionIds without targetId }
```

Before enabling the adapter, runtime detection requires:

- a readable, duplicate-free, all-string `workspaceRegistry.archivedSessionIds`;
- a state object with boolean `initialized`, duplicate-free string-array `workspaceIds`, and duplicate-free string-array `archivedSessionIds`;
- SHA-256 `Function#toString` fingerprints for rc.2's `archiveSession`, `setState`, `enqueueOperation`, and `recoverPendingMutation` implementations to match the audited allowlist exactly.

The fingerprint is checked before queueing and again inside the queued operation. The write runs inside the same operation queue used by DSH archive/workspace mutations. Immediately before writing, it verifies the state archive array still exactly equals the service projection. Every unrelated state field is preserved with object spread.

If any check fails, the plugin reports `unsupported` and does not write.

## Upgrade policy

A DSH update can preserve plugin source while changing Service, Slot, client-module, or persistence contracts. No third-party plugin can honestly guarantee unconditional compatibility with all future versions. This package instead promises:

1. no modifications to shipped DSH files;
2. public additive surfaces for all UI integration;
3. native-method preference when the official API appears;
4. fail-closed detection around the one rc.2 compatibility seam;
5. tests and a documented post-upgrade verification procedure.

`engines.dsh` is intentionally pinned to exactly `0.1.1-rc.2`. On a later DSH version the public listing/UI surfaces may continue to work, and a published native restore method can be used, but the private fallback will remain disabled until that release is audited and a new plugin version is published. Run `pnpm verify:runtime -- <checkout>` plus the mandatory GUI checks before widening compatibility metadata.
