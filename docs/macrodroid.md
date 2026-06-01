# MacroDroid driving controls (MusicFree)

Use **broadcast intents** to start car playback, skip tracks, and show desktop lyrics **without opening the MusicFree app window**. These macros are meant for driving (for example while Maps is in the foreground).

Package name (always use this in macros): `fun.upup.musicfree`

---

## Prerequisites

1. **Favorites** — Car mode plays your **Favorites** playlist (`我喜欢` / local sheet id `favorite`). Add songs there before using the car macro.

2. **Overlay permission (car macro only)** — Desktop lyrics need the system “display over other apps” permission.
   - In MusicFree: **Settings → Basic → Lyrics → Enable desktop lyrics** (grant overlay when prompted).
   - Car mode **still plays music** if overlay is denied; you only get a toast and no floating lyrics.

3. **MacroDroid shell / ADB (optional)** — The `am broadcast` examples below need one of:
   - MacroDroid **ADB Helper** (helper app installed and authorized), or
   - Root / Shizuku / similar, so the macro can run shell commands.

4. **Process / first launch** — Controls need the MusicFree process and player to be ready.
   - If the app was **force-stopped** or the device just **rebooted**, the first macro may do nothing until the JS runtime finishes starting (no UI is shown).
   - **Workaround (v1):** Open MusicFree once after reboot, then use macros normally. Backgrounding Maps does **not** reset desktop lyrics unless you enabled “reset on cold start” (see below).

---

## Important: no app window

**Car, Next, and Prev do not launch MainActivity.** MusicFree should not pop to the foreground. If you see the app open, check that the macro uses **Send Intent** as a **broadcast** (not `ACTION_VIEW` / deep link).

Do **not** use `musicfree://app/...` for these three actions.

---

## Broadcast actions

| Button / macro | Intent action |
|----------------|---------------|
| Car (favorites + desktop lyrics) | `fun.upup.musicfree.action.CAR` |
| Next track | `fun.upup.musicfree.action.NEXT` |
| Previous track | `fun.upup.musicfree.action.PREV` |

**Car mode behavior**

- Plays the favorites list (first track, or **random** if repeat mode is **Shuffle** — same rule as “Play all” on a playlist).
- Empty favorites → toast only, no playback.
- Overlay allowed → turns on desktop lyrics for the session.
- Overlay denied → toast, music still plays.

**Next / Prev**

- Skips in the current queue. Empty queue → no crash, no-op.

---

## MacroDroid setup (Send Intent)

For each macro, add an action: **Applications → Send Intent**.

Use these fields (names may vary slightly by MacroDroid version):

| Field | Car | Next | Prev |
|-------|-----|------|------|
| **Intent action** | `fun.upup.musicfree.action.CAR` | `fun.upup.musicfree.action.NEXT` | `fun.upup.musicfree.action.PREV` |
| **Package** | `fun.upup.musicfree` | `fun.upup.musicfree` | `fun.upup.musicfree` |
| **Target** | **Broadcast** | **Broadcast** | **Broadcast** |

Leave data URI / class name empty unless your MacroDroid build requires extra fields; action + package + broadcast is enough.

**Security note:** The receiver is exported. Any app on the device *could* send the same actions. Macros should set **package** to `fun.upup.musicfree` so only this app receives the intent. Do not share custom shortcuts with untrusted apps.

---

## Shell one-liners (ADB Helper / root)

```bash
am broadcast -a fun.upup.musicfree.action.CAR -p fun.upup.musicfree
am broadcast -a fun.upup.musicfree.action.NEXT -p fun.upup.musicfree
am broadcast -a fun.upup.musicfree.action.PREV -p fun.upup.musicfree
```

In MacroDroid: **Actions → Device Actions → ADB Shell Command** (or “Execute Shell Script”), paste one line per macro.

---

## Related in-app settings

Open **Settings → Basic → Lyrics** (歌词):

| Setting | Purpose |
|---------|---------|
| **Enable desktop lyrics** | Master switch for the floating overlay |
| **Desktop lyric lines** (1 / 2 / 3) | How many synced lines show on the overlay (current, or current + next lines) |
| **Reset desktop lyrics on cold start** | When ON, each **process** cold start turns overlay off (backgrounding alone does not reset) |

Car mode turns desktop lyrics **on** for the session when overlay permission is granted. If “reset on cold start” is ON, a full process restart after that will hide the overlay until you run car mode again or enable it manually.

---

## Troubleshooting

| Problem | What to check |
|---------|----------------|
| **Car does nothing** | Favorites empty? Force-stop cleared state? Open MusicFree once, try again. Wait a few seconds after reboot before first macro. |
| **Car plays but no lyrics** | Overlay permission not granted; enable desktop lyrics in settings and allow “display over other apps”. |
| **“Empty favorites” toast** | Add songs to Favorites in MusicFree. |
| **Next/Prev no effect** | Nothing in the play queue; start playback (e.g. run car macro) first. |
| **MusicFree UI opens** | Macro must be **broadcast**, not VIEW/deep link; action and package must match the table above. |
| **Works once, then stops after reboot** | Cold-start bootstrap (v1): launch MusicFree once after reboot, or retry car macro after ~10 s. |
| **Overlay gone after restarting phone** | Expected if **Reset desktop lyrics on cold start** is enabled. Run car macro again or re-enable desktop lyrics. |

---

## Quick test checklist

1. Add at least one song to Favorites and grant overlay permission.
2. Open Maps (or stay on home screen).
3. Run **CAR** macro → music plays, overlay visible, MusicFree UI does **not** open.
4. Run **NEXT** / **PREV** → track changes, still no UI.
5. Deny overlay (or revoke permission), run **CAR** → music plays, toast about overlay, no floating window.

---

## Technical reference

- Android receiver: `MusicFreeControlReceiver` (`exported="true"`).
- JS event: `MusicFreeControl` with payload `{ action: "car" | "next" | "prev" }`.
- Implementation roadmap: `roadmap/car_mode_desktop_lyrics_implementation.md`.
