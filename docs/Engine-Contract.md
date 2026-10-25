# Canonical assembly engine

`shared/engine.mjs` is the single dependency-free rules engine for local solo play and the room service. The C# interface sends commands through its JS bridge; it does not reimplement geometry or ownership. Server authorization, capabilities, rate limiting, request receipts, persistence and presence leases are outside this module. This document describes the implemented engine, not native UI or deployed-service acceptance.

## Exports

```js
createState({ seed, ownerId, ownerName, now, mode, artworks })
applyCommand(state, actorId, command, serverNow)
addPlayer(state, { id, name }, serverNow)
reclaimPlayer(state, memberId, serverNow)
renderSnapshot(state, actorId)
validateState(state)
```

Constants are `ENGINE_VERSION = 'aa-v1'`, `ARTWORK_IDS`, `TRAY_LIMIT = 6`, and `BOARD = {width:14,height:10,snapDistance:0.28}`. The last value is a geometric distance in tile-width units, not a number of merges. Forty-eight initial groups require **45 actual merges** to become three complete groups.

`createState` returns a canonical JSON-compatible state. Invalid options throw an Error with `code` and `message`. `seed` is an unsigned 32-bit integer, `now` is nonnegative safe Unix milliseconds, and `mode` is initially `solo` or `team`. IDs use 1–80 ASCII letters/digits/underscores/hyphens. Display names contain 1–30 non-control characters after trimming.

`artworks` comes from the trusted root array in `content/artworks.json`; the service must not accept its dimensions from a browser. The engine retains only these exact three IDs and their actual dimensions:

| Artwork | Width | Height |
| --- | ---: | ---: |
| met-436535 | 599 | 477 |
| met-45434 | 600 | 403 |
| met-436121 | 600 | 488 |

Dimensions are supplied by that manifest rather than a second engine copy. The renderer uses the same manifest for image paths, source links and attribution. The seed changes rack ordering and initial quarter rotations; it does not fabricate artwork metadata.

## State and snapshot

All collections are **arrays**. The state has:

```text
schema: 1, engineVersion: 'aa-v1', seed, revision,
mode: 'solo' | 'team' | 'solo-takeover',
status: 'playing' | 'complete', ownerId, createdAt, updatedAt,
artworks, pieces, groups, members, offers, contributors, nextOffer,
takeover: null | {by,at}, completedAt: null | milliseconds
```

- Artwork: `{id,width,height}`.
- Piece: `{id,artworkId,col,row}`. There are sixteen distinct cells per artwork, with column/row 0–3. IDs `p0`–`p47` are stable for the content set.
- Group: `{id,artworkId,pieceIds,location,ownerId,x,y,rotation,version,contributors}`. `location` is `rack`, `tray`, or `completed`; `ownerId` is null outside a tray. `contributors` holds member IDs that have actually claimed, joined or received the group. Group IDs remain stable until that group is merged into another.
- Member: `{id,name,status:'active'|'reclaimed',joinedAt,rejoinedAt}`. Names are fixed on first entry; reconnect does not rewrite history. At most three identities are registered over a room's lifetime.
- Offer: `{id,fromId,toId,groupId,groupVersion,status,createdAt,resolvedAt}`. Status is `open`, `accepted`, `cancelled`, or `stale`; generated IDs are `o1`, `o2` and onward. At most 64 offer records are retained, removing closed records first. Removed receipts cannot be accepted again.
- Contributor: `{id,name,claims,joins,transfers,completedArtworks}`. These are aggregate accepted actions, not invented attendance or engagement. Records survive reclaim and takeover.

`renderSnapshot` returns a detached, explicitly whitelisted public projection of those fields plus `youId`, `board`, and `trayLimit`. Each group also has derived `tiles`. Unrecognized fields, including accidentally attached capabilities, are excluded at top and nested levels. No key, lease, session, address or authentication object belongs in canonical state.

Each tile is `{pieceId,artworkId,col,row,x,y,width:1,height,rotation}`. Its `x,y` are **center coordinates**. `height = artwork.height / artwork.width`. Rotation is a quarter-turn count, 0–3 clockwise. The canvas renderer can translate to that center, rotate, then draw the original 4×4 image crop into `(-0.5,-height/2,1,height)`. Apply one common pixels-per-unit scale; do not apply a second artwork-specific scaling to engine coordinates.

A group's pose maps the original painting's center to `group.x,group.y`. For a source cell, compute `(col-1.5,(row-1.5)*tileHeight)`, rotate it by the group's quarter turns, and add its pose. Rotation preserves the mean center of all group tiles. The whole rotated tile rectangles must remain inside the 14×10 work area. Different players have separate work areas with the same coordinates; overlaps are legal and do not themselves constitute a join.

## Commands and results

Every player command includes `expectedRevision`. The backend must ensure that it equals the outer request's revision and derive `actorId` and `serverNow` itself. The local bridge may preflight with the same pure engine; an online predicted result is not an authoritative receipt.

```text
{type:'claim', groupId, expectedRevision}
{type:'move', groupId, x, y, expectedRevision}
{type:'rotate', groupId, quarterTurns:1|-1, expectedRevision}
{type:'join', groupId, targetGroupId, expectedRevision}
{type:'return', groupId, expectedRevision}
{type:'offer', groupId, toId, expectedRevision}
{type:'accept', offerId, expectedRevision}
{type:'cancelOffer', offerId, expectedRevision}
{type:'takeover', expectedRevision}
```

Accepted gameplay returns `{ok:true,state,events,changed:true}` with revision incremented exactly once. Rejection returns `{ok:false,error:{code,message},revision}`. Neither path mutates the input; rejected state remains unchanged. Returned arrays share no mutable references with the source. Presentation-only snapshot fields are discarded when deriving the next canonical state.

`validateState` returns `{ok:true}` or `{ok:false,error:{code,message}}`. It verifies exact piece conservation, unique locations, connected same-art groups, tray ownership/capacity, valid rigid geometry, completed paintings, offer pins, members and contributor records. The service should validate persisted data rather than repairing it silently.

### Claim, move and join

A rack group can be claimed only if the actor holds fewer than six tray groups. Claim centers it in the next work-area position while preserving its existing assembly and rotation. A return moves that same group back to the rack. Combining two groups uses one slot instead of two; completed groups use no tray slot.

A join requires both groups on the actor's tray, the same artwork, the same rotation, at least one genuine source-grid edge connecting them, and pose distance at most `0.28`. Visual overlap or diagonal contact alone is insufficient. `targetGroupId` survives at its exact pose; `groupId` is removed after all its pieces and contributor history join the target. The final geometry must fit the work area.

When all sixteen source cells join, the surviving group moves to `completed`, has null owner and a canonical unrotated gallery pose. There is no separate completed array. All three paintings completed sets room status and completion time. Further gameplay is refused; existing participants can still reconnect for the completed state.

### Offers and races

An offer pins the whole group's current identity, version and sender. It does not reserve receiver capacity. A sender may move, rotate, return or join the offered group; those accepted changes increment its version and mark open offers stale. Offer creation itself does not change the rigid group version.

Acceptance requires the intended active recipient, an open offer, the still-owned/version-matching group, an active sender, and free recipient capacity. The accepted command transfers the complete existing group and recenters it in the recipient's work area. It never copies pieces or transfers a subset. The offer closes before group version changes; any other old offers become stale. A second acceptance is refused.

The module rejects old revisions and already-claimed groups, but it is not a database lock. The service must compare-and-swap the saved room revision, persist its actual accepted result and recover uncertain writes using its request receipt. Two independently computed results against one old state are not proof that both may commit.

## Join, leases and solo continuation

Only the trusted service calls `addPlayer` or `reclaimPlayer`. The public command endpoint must not route arbitrary browser join/reclaim commands to them. The service owns real presence leases and the grace interval, and must compare the observed expired lease during the same persistence admission as reclaim. A renewed lease must defeat a stale sweep.

New entry and reclaimed-to-active rejoin return changed state with revision +1. An already-active entry returns `{ok:true,state,events:[],changed:false}`. Reclaim returns every tray group intact to the rack, clears ownership, stales affected offers, marks the participant reclaimed and increments revision once. Reclaiming that already-reclaimed identity is unchanged; it cannot duplicate rack pieces.

`takeover` is an explicit owner command, additionally protected by the service's owner capability. The engine also refuses it while another member remains active. It changes mode to `solo-takeover` and records who/when, preserving all historical member and contributor data. Nonowners cannot rejoin or issue commands after takeover. Initial solo uses the same six-slot, geometry and completion rules, with one real local actor and no bot.

Events describe the accepted transition (`cluster-claimed`, `cluster-moved`, `cluster-rotated`, `clusters-joined`, `painting-completed`, `assembly-completed`, `cluster-returned`, `cluster-offered`, `cluster-transferred`, `offer-cancelled`, `solo-takeover`, `player-joined`, `player-rejoined`, `tray-reclaimed`). They contain bounded IDs, actor and service time; service receipts decide whether they were persisted.

## Controlled verification

The disposable consumer `C:\C\AtlasEngine\checks.mjs` loaded the actual module and the root's real artwork manifest. It passed 1,076 assertions, including input-state immutability after accepted/refused actions, 48-piece conservation through all **45 solo merges**, three complete paintings, a real four-piece A→B transfer, a repeated acceptance refusal, stale-offer rejection, the six-slot limit, recipient capacity recovery, rigid rotation/centroid/aspect, join tolerance, invalid positions, revision/claim contention, once-only reclaim, rejoin, explicit takeover, preserved contributions and whitelisted detached snapshots.

These are pure-engine consumers. They do not establish SQL persistence, actual network concurrency, leases being measured by a service, native image rendering, browser interaction, deployed APIs or human participation. Those acceptance boundaries belong to the corresponding service, UI and main-host records. No test helper was added to production exports.
