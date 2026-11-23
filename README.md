# Tresor

Safety Simplified's own side: every client portal in one place, read from each portal's Tresor feed.

Hosted on Railway (Node.js, no database). Variables: `TRESOR_KEY` (same key as the portals), `TRESOR_PASSWORD`, `TRESOR_USERS` (`email:Name;email:Name`), `SESSION_SECRET`. Clients are listed in `clients.json`.

## Policy packs

For clients who are not on a portal. From the Policy packs page, Safety Simplified enters the company and the person signing and sends them their own link (`/sign/<token>`). The client reads the supplemental policies, signs once, and the signed PDF is stored here against the pack.

The wording lives in the `pack` library (seeded from `lib/pack-seed.json`, lifted word for word from the PandaDoc pack). Each signed PDF carries the library version it was signed against.

Optional variables: `GOOGLE_RECEIVER_URL` and `GOOGLE_RECEIVER_SECRET` connect the Apps Script in `google/Code.gs`, which emails the client from Hannah's account and files each signed pack in Google Drive. Without them, Tresor gives the link and the email text to send by hand, and signed packs are still stored here. `PUBLIC_URL` sets the address used in signing links.
