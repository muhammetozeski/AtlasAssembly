# Persistent room API

The host calls `handleAtlasAssembly({request,env})` from `server/handler.mjs` at `/api/atlas-assembly/`. It supplies the existing main D1 binding as `DB` and the canonical `SITE_ORIGIN`. No provider or deployment secret is required. Runtime dependencies are `server/*.mjs`, `shared/engine.mjs`, and `content/artworks.json`; the additive schema is `schema/atlas-assembly.sql`.

## Identity and recovery

Create/join use `{opId,requestKey,name,...}`. `opId` is a UUID; `requestKey` is 32 cryptographically random bytes encoded as 43 base64url characters. Display names use 1–30 characters, matching the canonical engine. The browser saves the frozen registration privately before sending it. The service mints participant/room IDs, derives separate player/owner capabilities from that proof and issued IDs, and stores only credential hashes and the request signature. Repeating the identical registration recovers the same credentials after a lost first response. Changing its intent/proof returns 409. Credentials and registration proofs never belong in URLs, shared snapshots, receipts or logs.

Authenticated requests send `Authorization: Bearer <playerKey>`. Owner takeover additionally sends `X-Atlas-Owner-Key`. These identify possession of a credential, never a browser-supplied participant ID. Invite URLs contain only the room ID. Anyone receiving that invitation may request one of the room's three participant places. Participants remain in history after reclamation; a room admits at most three distinct participant identities.

## Routes

| Method and path after the prefix | Body / result |
| --- | --- |
| GET `config` | `{configured,rulesVersion,artworkIds,retentionSeconds,leaseSeconds,heartbeatSeconds,pollSeconds,maxPlayers,trayLimit}` |
| POST `rooms` | `{opId,requestKey,name,seed?}` → room envelope plus `{playerId,playerKey,ownerKey,inviteUrl}` |
| POST `rooms/:id/join` | `{opId,requestKey,name}` → room envelope plus `{playerId,playerKey,inviteUrl}` |
| GET `rooms/:id` | authenticated current room envelope |
| POST `rooms/:id/heartbeat` | `{}` → room envelope; renews a server-time lease, or rejoins a reclaimed member through the engine |
| POST `rooms/:id/commands` | `{opId,revision,command}` → room envelope plus own receipt |
| GET `rooms/:id/receipts/:opId` | room envelope plus `{found,receipt:null|receipt}`; only this participant's receipt |

Room envelope: `{room:{id,revision,state,createdAt,updatedAt,expiresAt,presence:[{playerId,leaseUntil,reclaimedAt}]},me:{playerId,isOwner},serverTime,receipt?}`. `state` is the canonical engine's `renderSnapshot(state,playerId)`. `room.revision` equals its state revision. Timestamps are Unix milliseconds. No credential hashes appear in that envelope.

Receipt: `{opId,status:'pending'|'accepted'|'rejected',revision:null|number,error:null|{code,error}}`. Receipt status is authoritative for that operation, while its envelope contains the latest room state, which may include later moves. Engine commands are `claim`, `move`, `rotate`, `join`, `return`, `offer`, `accept`, `cancelOffer`, `takeover`. An optional `command.expectedRevision` must equal the envelope revision; the service supplies the canonical engine field. Unknown fields, participant IDs, submitted state and client timestamps are refused.

## Admission and uncertainty

After basic shape/auth validation, a command gets a signature-bound pending receipt before evaluation. Engine, revision and owner-permission refusals then become rejected receipts; successful state and receipt updates commit in one D1 batch with a room revision condition. Only the production engine changes gameplay state. A changed command/revision with the same operation ID is refused. Pending receipts can be completed by an explicit identical retry; the service never substitutes another intent.

Malformed JSON/top-level fields, wrong origin, missing authentication, expired rooms and rate limits can fail before reservation. Such a response proves this request did not write gameplay state, but does not disprove a previously ambiguous dispatch. A missing receipt alone is not proof of non-delivery. Clients retain ambiguous pending intent until a receipt resolves it or they explicitly retry the identical operation. Errors use plain `{code,error}`; post-reservation refusals also include their receipt.

## Leases, persistence and bounds

Room lifetime is seven days from creation. Heartbeats are recommended every20seconds, polling every3seconds. A90second server-time lease includes the grace interval. Expired trays return through `reclaimPlayer`; the compare-and-swap also checks the exact old lease, so a concurrent heartbeat cannot be reclaimed from an obsolete snapshot. Successful first reclamation increments the engine revision; repeated reclamation does not. Reclaimed rejoin calls `addPlayer` and increments the revision. Owner takeover is explicit, owner-capability protected, and requires all other members to be reclaimed; their contributions and membership history remain.

Reads, pending-state processing, request sizes, state sizes, receipt count and per-room/request rates are bounded: 4 KiB requests, 180,000-byte canonical state, 2,500 receipts per room and five compare-and-swap attempts for lifecycle changes. Registration rate is 90/minute across the product; per-participant room rates are 150 new commands, 12 heartbeats and 240 authenticated requests/minute. Rate rows contain bounded scope IDs and time buckets, not IP addresses. Heartbeats update presence without changing an unchanged gameplay state. Every accepted gameplay/join/rejoin/reclaim command changes the canonical revision. `cleanupExpiredAtlasData(db,now)` removes expired rooms and dependent private records; signature-only registration tombstones last one extra day to reject stale registration retries. Reads independently refuse expiry. Physical scheduled cleanup is a host deployment concern, not a read-time TTL claim.

## Evidence

The disposable consumer `C:\C\AtlasRoomChecks\service-checks.mjs` loaded the actual migration, all five service modules and the production engine. Its D1-compatible consumer serializes real SQLite statements/batches; deterministic pause points exist only in that consumer. The initial implementation passed 106 assertions, including intermediate canonical-state conservation checks. Five service modules also passed Node syntax checking.

The controlled requests covered registration with no plaintext credential storage, lost-first-response create/join recovery, changed-intent refusal, private room admission, the three-identity limit, a real four-piece assembly transferred A→B, same-operation replay, independent rejected/accepted receipts, participant receipt isolation, stale offers, simultaneous claims with one persisted winner, supplied-actor refusal, lease reclamation/rejoin, owner-capability protected takeover, preserved contributor history and actual expiry/FK cleanup.

The lease race paused B's active heartbeat immediately before its lease update. At a later service time, A computed expiry and paused immediately before its reclaim batch. B's already-admitted heartbeat then renewed the lease without changing the room revision. A's old-lease predicate refused the stale reclaim; its subsequent read kept B active and its four-piece assembly owned by B. This tests the separate-row input, not just a room-revision conflict. A later genuine expiry reclaimed each tray once; repeated reads made no further revision change.

An independent complete service/schema review then found one registration race. With two participants present, a duplicate third-player join was paused before its member count. The identical request accepted the third place; the paused request then incorrectly returned `409 room_full` even though its own registration was already accepted. The service now conditionally records rejection and then rereads registration status: an accepted identical registration continues to its existing successful response. The dedicated actual-SQL consumer `C:\C\AtlasRoomAudit\registration-race.mjs` reproduced the original 200/409 result and passed after the fix with 200/200, the same recovered participant, the same capability, the same room revision, one accepted registration and exactly three participants. Registration rate admission also covers replays. The updated module passed syntax checking. The broad 106-check baseline was not repeated after this narrow correction; this regression and the completed current-source review are the final follow-up evidence.

These are actual production-SQL/service/engine consumers with controlled in-process requests. They are not live HTTPS, native browser rendering, human cooperation, adoption or revenue evidence. Root publication, physical scheduled cleanup and native observations remain separate acceptance steps. No test helper or test-only export was added to the production engine or service.
