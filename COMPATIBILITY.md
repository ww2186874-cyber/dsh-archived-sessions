# Compatibility contract

## Stable integration surface

The plugin intentionally depends on additive, published DSH extension surfaces:

- Profile Bundle metadata (`dsh.bundle`, `dsh.client`);
- Cordis lifecycle and `ctx.effect()`;
- Host services `workspaceRegistry`, `sessionQuery`, and `webServer`;
- Client slot `settings.section`;
- root standard prop `useWorkspaces` declared by `@deepseek-ai/dsh-client-ui-workspace` and supplied by the Slot renderer.

It does not edit the DSH Runtime checkout, replace `root`, `sidebar`, `conversation`, or `details`, inspect product DOM nodes, claim the SPA fallback route, or patch browser history.

## Native restore path

When an audited DSH release adds a callable `workspaceRegistry.unarchiveSession(sessionId)`, that method is selected automatically. The compatibility adapter is not used in that case. The plugin does not trust the method name alone as proof of success: it re-reads the authoritative archive set and reports success only after the target id is absent.

## DSH 0.1.2-alpha.2 adapter

DSH `0.1.2-alpha.2` persists a registry-global `archivedSessionIds` array. Its own source contract states that archived sessions retain their workspace accounting slot so a future unarchive restores the same position. The alpha.2 adapter therefore performs only this transition:

```text
{ ...state, archivedSessionIds: state.archivedSessionIds without targetId }
```

Before enabling the adapter at runtime, detection requires:

- a readable, duplicate-free, all-string `workspaceRegistry.archivedSessionIds`;
- a state object with boolean `initialized`, duplicate-free string-array `workspaceIds`, and duplicate-free string-array `archivedSessionIds`;
- any `pendingMutation` shape to match alpha.2 exactly; a still-present marker inside the queued callback fails closed;
- `archivedSessionIds` to be an own getter without a setter on the live registry prototype, with its SHA-256 `Function#toString` fingerprint matching the audited getter exactly;
- `archiveSession`, `setState`, `enqueueOperation`, and `recoverPendingMutation` to be own data methods on that same prototype;
- SHA-256 `Function#toString` fingerprints for all four method implementations to match the audited allowlist exactly.

The fingerprint is checked before queueing and again inside the queued operation. The write runs inside the same operation queue used by DSH archive/workspace mutations. Immediately before writing, it verifies the state archive array still exactly equals the service projection and that no pending workspace mutation remains. Every unrelated state field is preserved with object spread.

The release-time/runtime-contract check adds two independent identity gates before this package declares support:

- the Runtime and every discovered `@deepseek-ai/dsh-workspace` package must report exactly `0.1.2-alpha.2`;
- the raw bytes of each workspace package's `lib/index.js` must have SHA-256 `eea81b03fd61039725adff9255f8a86055c449075ce8a62c8a3f3fd0b041b4a5`.

If any check fails, the plugin reports `unsupported` or a state conflict and does not write.

## Upgrade policy

A DSH update can preserve plugin source while changing Service, Slot, client-module, or persistence contracts. No third-party plugin can honestly guarantee unconditional compatibility with all future versions. This package instead promises:

1. no modifications to shipped DSH files;
2. public additive surfaces for all UI integration;
3. native-method preference when an audited official API appears;
4. fail-closed detection around the one alpha.2 compatibility seam;
5. exact release, package-byte, live-method, state, and queue checks;
6. tests and a documented post-upgrade verification procedure.

`engines.dsh` is intentionally pinned to exactly `0.1.2-alpha.2`. On another DSH version the public listing/UI surfaces may continue to work, but the private fallback must not be declared supported until that release is audited and a new plugin version is published. Run `pnpm verify:runtime -- <runtime-root>` plus the mandatory GUI checks before widening compatibility metadata.
