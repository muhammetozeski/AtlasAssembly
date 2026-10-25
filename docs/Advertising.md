# Optional publisher advertising

The player uses the main site's existing approved publisher configuration at `/revenue-config.json`. The current observed configuration has advertising disabled and no publisher/unit IDs. No live ad fill, impression or revenue has been verified.

`src/AtlasAssembly.Portal/wwwroot/ads.mjs` consumes `adSense.enabled`, `client` and `slot`. It admits only a true enabled flag and valid publisher/unit formats, then loads Google's tag. The main publication derives that enabled flag from the configured identifiers and `ADSENSE_CONSENT_READY`. This flag is an operator gate; it does not implement a consent-management platform. The actual approved consent setup must be completed before enabling it, as described by [Google's publisher requirements](https://support.google.com/adsense/answer/13554116?hl=en).

`mount(element)` asynchronously returns whether a unit was requested on the supplied non-game surface. Disabled, malformed, failed or unavailable configuration leaves the element empty. Gameplay must not wait for this promise. `dispose(element)` removes the visible unit and cancels pending rendering when starting a game. Disposal does not unload already executed third-party JavaScript; this is a placement/lifecycle boundary, not a separate-origin security sandbox.

The module creates at most one unit request per document. Repeated component renders, another result surface or a returned lobby do not refresh impressions automatically. A disposed element cannot be populated after a delayed configuration/tag response. Script errors and an unfilled unit leave no visible placeholder. The module does not inject navigation or alter the game's layout.

The standard responsive tag is documented in [Google's code examples](https://developers.google.com/adsense/platforms/transparent/ad-tags). This app uses its ordinary publisher client and unit; it does not enroll in platform revenue sharing or invent a host account. The deployed content policy must permit the actual Google ad/consent resources if advertising is enabled. That policy's compatibility with filled live ads still needs observation after approved publisher configuration.

The production module parsed and passed 46 controlled DOM/lifecycle assertions covering disabled/malformed settings, configuration failure, delayed disposal, tag failure, concurrent/repeated surfaces, empty fill and one-request behavior. Those checks used controlled objects and emitted no external script, impression or paid transaction. The game itself and its native rendering are verified separately.
