# Product contract

## Playable outcome

Three real paintings have sixteen pieces each, mixed in one shared rack. A player's tray admits six loose pieces or connected clusters; a joined cluster occupies one place. A correct join frees capacity. Each cluster has one rigid geometric pose. A player can offer a cluster to another player; acceptance transfers that same existing assembly exactly once. Finishing all three paintings completes the room. Solo play uses the same rules and immediate controls over all required work.

The first screen must show actual artwork and an immediately usable start action. The main view is graphical gameplay, not a text dashboard. Provide a mouse/touch action and an accessible select/move/join alternative. A visitor should understand that pieces must be joined and useful groups can be passed to teammates. Keep detailed help optional.

## Shared state and invariants

The canonical engine owns legal commands, geometry, ownership, tray capacity, group versions and room revisions. It is shared between the local game and server. Each piece is in exactly one rack cluster, one member's tray cluster or a completed painting. Every accepted gameplay command changes the room revision. A stale offer cannot be accepted after its cluster changed. Rejected commands leave state unchanged.

Rooms support up to three real clients with explicit display names and private player capabilities. No fake bots or fabricated presence. The service persists state with compare-and-swap revision admission and safely handles competing claims. Presence has a server-time lease and grace interval. An abandoned tray returns to the rack exactly once; reconnection reads current state. The owner may explicitly continue solo, preserving all contributor history and labeling the outcome accordingly. Never silently change team mode to solo or delete other players' work.

The API must not trust a browser-supplied participant identity, timestamp, ownership, resulting state or completion claim. Bound requests and room retention. Do not expose a room's private player capabilities in public snapshots, share URLs or logs. An uncertain network write must reconcile state; never replay it automatically as if it had failed.

## Content and commercial boundary

Bundle three verified CC0 Met images with their object metadata and attribution. Local play must remain useful without an API key or external request; retain source links for inspecting the original artworks. The live Met API supplies the actual curated artwork metadata during content preparation. Document that workflow and license evidence rather than pretending bundled images are a live user feed.

The initial commercial hypothesis is optional publisher-network advertising outside active gameplay, following the main site's existing configuration and consent gates. No sponsor solicitation or invented paid features. Persistent private-room capacity can be evaluated later from actual use; it is not a current entitlement. Do not describe configured ads, sales or millions of users unless evidence exists.

## Acceptance

Prove a solo completion with the production engine; prove a two-client transfer of a four-piece assembly, stale-offer rejection, competing claims, revision conflicts and lease/rejoin behavior with actual persisted room state. Distinguish controlled clients from human engagement. Check the actual browser interface, artwork decoding, dark defaults and contrast, direct page routes and API delivery. Catalog inclusion can ship with the implemented application; delivery-ledger and site-registry entries require verified publication. The project is one product, not one count per painting, puzzle seed, route or room.
