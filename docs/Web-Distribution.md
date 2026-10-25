# Atlas Assembly web bundle

The primary hosted game is https://muhammetozeski-binsite.pages.dev/atlas-assembly/ . This archive contains the compiled web application, actual artwork files, the canonical engine, room-service source and additive schema. It contains no player data, deployment credentials, publisher keys or Windows executable. Serve the application over HTTP/HTTPS; opening index.html from the filesystem is not the web deployment.

## Included layout

`public/atlas-assembly/` contains the independent application and museum images. Root public routing/header files preserve the explicit room paths. `functions/api/atlas-assembly/[[path]].js` supplies the D1 binding and your canonical origin to `server/handler.mjs`. `shared/engine.mjs` is the same rules engine used by local play. `content/artworks.json` is the curated server metadata, and `schema/atlas-assembly.sql` contains the new room tables. `release.json` identifies the exact source revision.

## Hosting requirements

The existing primary site already supplies shared storage and scheduled cleanup. For a separate deployment, copy and fill `wrangler.example.toml` with your own project, HTTPS origin and D1 database; apply the additive schema, deploy the Functions and public assets, and schedule `cleanupExpiredAtlasData(db, now)` from `server/maintenance.mjs` hourly. A scheduled Worker can call that function and return HTTP 404 for unrelated requests. Disabling public workers.dev/preview URLs does not itself remove the account namespace prerequisite for cron registration. See the [verified main-host method](https://github.com/muhammetozeski/BinSite/blob/main/docs/Atlas-Assembly-Hosting.md).

The room service refuses an absent/mismatched canonical origin or database, and it enforces seven-day expiry independently of physical cleanup. Without a configured room service, the bundled local solo game remains available. Local browser storage may be blocked or cleared; keep the original source and follow the player help for recovery boundaries.

The archive's public advertising configuration is disabled. Enable advertising only with your approved publisher/unit and actual consent setup; this bundle does not create an AdSense account or fabricate approval. Its privacy navigation expects the host's policy at `/privacy/`; publish an accurate policy for your own deployment. No income or audience result is established by this release.

## Source and rebuild

Source: https://github.com/muhammetozeski/AtlasAssembly . Rebuilding requires .NET 10 and the declared WebAssembly packages, plus PowerShell 7 for the publisher. From the source root, `./scripts/Publish-App.ps1 -BasePath /atlas-assembly/ -Destination ./publish/site` produces the web files. Node.js is used by the room service's local consumers and hosting tools; production Functions run in the configured hosting runtime. The compiled browser assets do not require a Windows or desktop .NET installation on the player's device.

Artwork credits and CC0 source links are included in artworks.json and the game's gallery. Content preparation uses the verified Met object records; see the source [artwork documentation](https://github.com/muhammetozeski/AtlasAssembly/blob/main/docs/Artwork-Content.md). No alternate hosting, live ad fill, human participation or customer revenue is implied by the presence of this bundle.
