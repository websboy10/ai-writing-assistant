---
quick_id: 260925-j9r
status: complete
commit: e4fece0
---

# Landing favicon: done

Added favicon.ico (16/32/48), favicon-48.png, favicon-96.png generated from the existing logo (icon-128.png), linked on all pages; build.mjs copies .ico.

Observed live 2026-09-25: all three files return 200 with image content types; all 6 sitemap pages carry the links. Google refreshes search-result favicons on its own recrawl (days to weeks).
