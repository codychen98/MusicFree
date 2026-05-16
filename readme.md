# MusicFree (this fork)

Fork of [maotoumao/MusicFree](https://github.com/maotoumao/MusicFree). General app info and plugins: [musicfree.catcat.work](https://musicfree.catcat.work).

## Desktop pairing

This Android build is meant to work with the **portable desktop fork** so playlist data can stay in sync over **WebDAV**:

[codychen98/MusicFreeDesktop](https://github.com/codychen98/MusicFreeDesktop)

Install the desktop app from that repo, point both clients at the **same WebDAV target**, and use **auto-sync** on mobile where it makes sense for you.

## WebDAV auto-sync (Android)

In the sidebar: **Backup & Restore** → **Webdav Settings**. After you enter your server details, you can turn on **Auto-sync playlists with WebDAV** so changes upload in the background (optional; you can still use manual backup/restore only).

## Disclaimer

**Back up your data** (local export and/or a known-good WebDAV copy) before turning on sync or changing restore options. Sync and backup tools can misconfigure, conflict, or hit server issues. **I am not responsible for any data loss**; you use this fork at your own risk.

Upstream license remains **AGPL 3.0**.
