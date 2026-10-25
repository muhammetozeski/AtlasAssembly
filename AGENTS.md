# Atlas Assembly source guidance

Read README.md, docs/Product-Contract.md and the relevant entry in docs/İçindekiler.md before editing code. Product copy, code and documentation are English; conversation with the user is Turkish. This is a web application with a C# Blazor player interface. Windows EXE, desktop installation, portable filesystem and bilingual UI instructions do not apply to this delivery.

Preserve the single authoritative gameplay engine shared by the local game and room service. Renderer animation/dragging must not create server receipts or move ownership. Tests consume the production rules without modifying lower layers for test convenience. Root owns Git staging, commits, repository creation and main-host publication; agents must coordinate file ownership.

Keep the player interface concise, readable and dark by default, with a contrast guard. Explain the actual goal and first action through visible gameplay. Do not show framework, server, page-language, capacity or development notes as product benefits. Keep actual puzzle content and necessary controls/instructions. Do not copy the previous product's layout.

Keep secrets and generated output out of Git. The repository is public as requested. Record verified reusable methods in subject documents and link them from docs/İçindekiler.md; record outcomes separately in timestamped Walkthrough files using Europe/Istanbul time. Distinguish source review, controlled clients/providers, native observation and actual user behavior. Do not claim audience or revenue without observed evidence.
