# Player interface

## Runtime and surfaces

`src/AtlasAssembly.Portal` is the .NET 10 Blazor browser client. It uses the cached `Microsoft.AspNetCore.Components.WebAssembly` 10.0.11 package. The browser delivery does not use Windows filesystem settings, installation, signing or a second UI language. Browser persistence, safe console event summaries and one outer user-action boundary provide the applicable settings/logging/recovery behavior.

The first view is a gallery of the three bundled Met images and one **Start assembly** action. Optional shared-room entry and existing sessions appear separately. The actual routes are `/atlas-assembly/` and `/atlas-assembly/room/{roomId}`. The API's `/atlas-assembly/?room={roomId}` invitation opens the same join flow; the interface copies one path-based invitation. There is no QA route or hidden completion mode.

During play, the rack is mixed, the SVG work area contains the current player's owned clusters, and the tray displays six places. Image tiles are cropped from the real files. `AssemblyTiles.razor` consumes the engine's projected tile centres, quarter rotations and actual artwork aspect; `AssemblyPicture.razor` fits those same tiles into rack, tray and offer previews. The client does not stretch all paintings into squares or implement another rule engine.

Pointer dragging applies a temporary SVG transform. On release it submits a move; only a successful authoritative move can lead to a separate join. Join candidacy is a production-engine preflight, not a network receipt. The target cluster survives according to the canonical engine. Clicking selects without producing a no-change move. Pointer cancellation, changed group versions and changed session generations discard the gesture.

Native buttons provide select, quarter turns, large/small arrow moves, target selection and **Join aligned edges**. Cluster labels identify their painting, piece count and a source row/column, so equally sized clusters have distinct accessible labels. Offers refer to existing cluster IDs. A receiver's actual acceptance continues the original joined pieces rather than creating a fresh cluster.

## State and recovery

`wwwroot/player.mjs` imports the published `shared/engine.mjs`. Solo creation, every local command, rendering projection and drag preflight use those production exports. Online state arrives through the [room API](Room-Api.md); movement, ownership, leases, revisions, completion and receipts are not trusted to browser declarations.

`AtlasClient` keeps a private `PlayerSession` separate from gallery summaries. The browser library key is `atlas-assembly:sessions:v1`. Starting or restoring a game preserves other records. Gallery summaries omit player keys, owner keys and registration proofs. Storage is ordinary same-origin browser storage, not encryption. Private values are not put into invitations, visible labels or diagnostic logs.

Before first create/join, the browser saves a frozen operation ID, name, registration kind and 32 random bytes encoded as a 43-character base64url request proof. A missing first response retains that registration. **Resume room entry** sends the same proof and body to recover the server-issued player. No room request is sent when that recovery record cannot be confirmed in browser storage.

Known permanent entry responses are recorded separately as `knownRegistrationError` while retaining the original frozen proof. The interface stops offering an endless resume for that record. A missing/expired room is described as currently unavailable without claiming the registration was never previously accepted. Network/cancellation, rate limits, pending registrations, revision contention and unknown codes retain the original uncertain-entry recovery. Initial configuration failure also has an explicit **Check shared tables** path; it does not permanently hide or disable room entry.

A room command is saved with its operation ID, expected revision and frozen command before dispatch. New commands remain blocked while that intent is unresolved. Receipt lookup can confirm accepted/rejected; missing or pending is not proof that no request was sent. An explicit retry reuses the same body and operation ID. Authoritative room revisions protect against late older polling responses. Solo/library changes and restored sessions use context generations so late work cannot replace a new active session.

Hidden sessions stop room requests and disable moves. Returning renews/reads the room and reconciles a pending action before controls reopen. The owner-only continue-alone action supplies the separate owner capability and still depends on server lease/reclaim checks. The interface never silently changes team mode.

A current room-read failure closes the move gate and removes fresh presence claims. **Reconnect** renews/reads using the same player and reconciles any existing intent; it creates no new move identifier. Explicit missing/expired-room responses leave the last view and frozen intent intact, show unavailability, and stop automatic polling of that room. A failed older read is ignored when a newer successful synchronization or another session context already superseded it. Successful synchronization clears only the connection warning, not an unrelated rejected-move instruction.

Unreadable saved records are retained unchanged, accompanied by a warning. Local solo remains usable in memory; room registration/actions require confirmed persistence. Quota refusal keeps an actual local move in memory and does not reset the prior stored value. No UI reset deletes earlier sessions.

## Appearance and advertising

The layout and CSS are specific to this product. Default document state is `data-atlas-theme="dark"`. Asset markers are `data-atlas-appearance="style"` and `data-atlas-appearance="script"`; the public reader is `AtlasAssemblyAppearance.audit()`. The contrast guard adapts the already reviewed color/opacity algorithm with Atlas marker and storage names. Actual SVG artwork pixels are excluded from text-color repair. Theme selection is stored under `atlas-assembly:appearance:v1`.

The root-owned `ads.mjs` uses the main site's actual `/revenue-config.json` and consent/configuration gates. Mounting is limited to the gallery or completion view. An unavailable, disabled or malformed configuration shows no advertising box; active gameplay disposes the placement. Ad loading never gates a game action. No provider key, filled ad, advertising revenue or signed consent is inferred from this interface.

Completion copy is neutral even if a one-player room retained team mode. Room help states the device-local access and seven-day expiry consequences. Clipboard refusal leaves the actual invitation readable and gives a manual select/copy alternative.

## Build and mounting

From the repository root:

```powershell
./scripts/Publish-App.ps1 -NoRestore -Destination '<main-public-directory>/atlas-assembly' -BasePath '/atlas-assembly/'
```

Omit `-NoRestore` in the main workflow's clean environment. The publisher copies the real browser output, the single canonical engine, the artwork manifest and the three JPEGs. The JS engine import is materialized at `shared/engine.mjs` in that published artifact; a source-only JS consumer must not assume the publisher's copied layout already exists.

The base folder serves its normal index. Only the two room patterns proxy to that folder; there is no index.html canonicalization target, folder self-proxy or static-asset wildcard. The parent host merges the generated scoped headers and redirects. API calls intentionally use the origin-root `/api/atlas-assembly/` prefix. The site owner handles final source pinning, schema, deployment and publication records.

## Verification evidence

The Release build completed with zero warnings and errors. The publisher's PowerShell parse check and a real mounted Release publish succeeded to `C:\C\AtlasAssemblyPlayer\site`.

- **55 published browser-bridge checks:** the actual published `player.mjs` and engine completed all three paintings through 45 joins, exercised drag join preflight, restored completed geometry, retained an earlier game when starting another, recovered the same registration proof, excluded private proof from gallery summaries and preserved corrupt/quota-limited stored data.
- **7 pointer-bridge checks:** the actual published `board.mjs` was consumed with controlled SVG/pointer objects to verify temporary transforms, scoped drop data, selection without movement, cancellation, session/group version changes and listener disposal. These objects do not establish native pointer/coordinate behavior.
- **11 compiled C# controller checks:** the production `AtlasClient` DLL used controlled HTTP/JS responses and engine-produced fixture states to verify late local-result rejection, registration recovery, persistence before dispatch, unresolved receipt blocking, identical explicit retry, scoped headers, hidden-session pause, return heartbeat and rejection of an older polling result. They are not actual live-room or human-use evidence.
- **7 focused C# follow-up checks:** only the changed availability/rejection/completion paths were exercised after independent full-source review. The checks recovered configuration after an initial failure, retained a terminal registration proof while stopping repeated dispatch, rendered its actual no-resume view, retained a transient rate-limited entry and rendered neutral completion for a one-member team. Earlier unchanged bridge/controller checks were not repeated for this copy/recovery pass.
- **5 focused browser follow-up checks:** the final published module restored the known entry error together with the unchanged proof, exposed only the unavailable-entry summary, and returned correct missing/denied/successful clipboard results. Storage and clipboard were controlled objects; no actual browser clipboard was changed.
- **7 connection follow-up checks:** current read failure closed controls, a direct disconnected command created neither an operation ID nor a request, explicit reconnect reopened confirmed access, an older failed read could not undo a newer successful read, expiry retained the exact pending move, actual expired markup omitted fresh presence and an unusable reconnect control, and a late old-room failure could not affect a new solo session. Only these changed paths were executed in that final pass.

The disposable consumers are in `C:\C\AtlasAssemblyPlayer`; engine and actual SQLite/service checks are recorded by their respective owners. No native drag/touch interaction, live two-human game, audience or revenue is claimed by these client checks. Native artwork/contrast and main-host/API acceptance belong to the publication record, not to an inferred result from source compilation.
