# Curated artwork preparation

Use this when refreshing the bundled paintings or adding a different curated collection. The player consumes the bundled metadata and JPEGs; gameplay does not depend on a live museum response or an API key.

## Verified source and license admission

The [Met object endpoint](https://metmuseum.github.io/#object) supplies individual object records, including `isPublicDomain`, image URLs and credits. Its [image policy](https://www.metmuseum.org/policies/image-resources) distinguishes public-domain imagery released under CC0 from records whose metadata is public but whose images are unavailable or restricted. An existing object record alone does not admit its image.

`content/curation.json` holds the three selected IDs and short display titles. `scripts/Prepare-Artworks.ps1` first fetches every record and requires the returned object ID, `isPublicDomain: true` and a nonempty HTTPS image URL at images.metmuseum.org. It then downloads the lower-resolution JPEGs, checks the response type, decodes their dimensions with installed ImageMagick, and records the exact image hash, original title, artist, date, museum credit, object URL, source image URL, CC0 link and retrieval time in `content/artworks.json`.

The preparation command, from the project root, is:

```powershell
./scripts/Prepare-Artworks.ps1
```

It prepared these real assets on 25 October 2026: Van Gogh object 436535 (599×477, 221383 bytes), Hokusai object 45434 (600×403, 166452 bytes) and Degas object 436121 (600×488, 140074 bytes). All three downloaded images were decoded and visually inspected. The Hokusai record's long original title remains in `sourceTitle`; the player can use the short curated title without replacing the source attribution.

`-ValidateOnly` checks current source admission without downloading or writing content. A future refresh writes the curated images and then the manifest; inspect and commit that coherent content update before publishing. The publisher copies the files to application-relative `artworks/` paths and the metadata to `artworks.json`, preserving their hashes and proportions. It does not re-query the museum in CI or generate a fake feed.

## Observed selection corrections

Object 57805 actually identified a Hokusai sketchbook, not The Great Wave, so the curated Wave uses the verified object 45434. Two candidate Monet records returned `isPublicDomain: false` and no image URL in this observation; neither was downloaded or included. The record's actual fields decide admission, not assumptions about the artist or age of the painting. These observations do not establish why the museum returned those fields.

The current [official API documentation](https://metmuseum.github.io/) says search now uses the paginated `/public/collection/v1.1/search` endpoint; the old search endpoint was scheduled for retirement. This preparation uses the documented individual `/public/collection/v1/objects/{id}` endpoint, not the retired search route. Search pagination was researched here but is not an executed part of this preparation method.
