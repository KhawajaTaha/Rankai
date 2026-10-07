=== Local SEO Autopilot Connector ===
Requires at least: 6.0
Requires PHP: 7.4
Stable tag: 1.0.0
License: GPLv2 or later

Secure connector for the Local SEO Autopilot platform.

== Description ==
Exposes a small, HMAC-signed REST API (namespace lsa/v1) that lets the platform:

* Read pages, posts and SEO metadata (Rank Math, Yoast, AIOSEO or built-in fallback)
* Detect theme, active plugins, Elementor and the SEO plugin
* Update meta titles/descriptions, image alt text and JSON-LD schema
* Add internal links (Elementor-aware: only text-editor widgets are modified, never layout)
* Fix broken links, create/schedule/publish blog posts with featured images
* Take snapshots before changes and restore them (rollback)

Security: every request must carry X-LSA-Timestamp and X-LSA-Signature =
HMAC-SHA256(secret, "timestamp\nMETHOD\n/wp-json/lsa/v1/route\nbody"). Requests older than
5 minutes or replayed signatures are rejected. The secret is entered under
Settings → Local SEO Autopilot and never leaves your server.

== Installation ==
1. Zip the local-seo-autopilot-connector folder and upload via Plugins → Add New → Upload.
2. Activate, then open Settings → Local SEO Autopilot and paste the shared secret from the platform.
3. In the platform, open the client → Website SEO → Connections and click "Save & verify".
