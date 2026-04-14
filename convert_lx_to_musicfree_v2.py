"""
Convert LX Music backup (lx_list.lxmc) to MusicFree backup (backup.json).

Usage:
  python3 convert_lx_to_musicfree.py [lx_file] [output_file]

Arguments (all optional):
  lx_file     Path to lx_list.lxmc  (auto-detected if omitted — see below)
  output_file Path for backup.json   (default: "backup.json" in current directory)

Auto-detection order for lx_list.lxmc when no argument is given:
  1. lx_list.lxmc in the current working directory
  2. "lx music backup file/lx_list.lxmc" relative to the script

If "Music Free Backup Format/backup.json" exists alongside the script it will
be used as the plugins source; otherwise the built-in DEFAULT_PLUGINS list is
used so the script works from just lx_list.lxmc alone.
"""

import gzip
import json
import os
import random
import string
import sys
import time

LX_FILE_DEFAULT = "lx music backup file/lx_list.lxmc"
LX_FILE_CWD = "lx_list.lxmc"
MF_BACKUP_FILE = "Music Free Backup Format/backup.json"
OUTPUT_FILE_DEFAULT = "backup.json"

# Fallback plugins used when MF_BACKUP_FILE is not present.
DEFAULT_PLUGINS = [
    {"srcUrl": "https://gitee.com/maotoumao/MusicFreePlugins/raw/v0.1/dist/udio/index.js", "version": "0.0.0"},
    {"srcUrl": "https://gitee.com/maotoumao/MusicFreePlugins/raw/v0.1/dist/maoerfm/index.js", "version": "0.1.4"},
    {"srcUrl": "https://gitee.com/maotoumao/MusicFreePlugins/raw/v0.1/dist/suno/index.js", "version": "0.0.0"},
    {"srcUrl": "https://gitee.com/maotoumao/MusicFreePlugins/raw/v0.1/dist/geciwang/index.js", "version": "0.0.0"},
    {"srcUrl": "https://gitee.com/maotoumao/MusicFreePlugins/raw/v0.1/dist/geciqianxun/index.js", "version": "0.0.0"},
    {"srcUrl": "https://gitee.com/maotoumao/MusicFreePlugins/raw/v0.1/dist/navidrome/index.js", "version": "0.0.0"},
    {"srcUrl": "https://gitee.com/maotoumao/MusicFreePlugins/raw/v0.1/dist/yinyuetai/index.js", "version": "0.0.1"},
    {"srcUrl": "https://gitee.com/maotoumao/MusicFreePlugins/raw/v0.1/dist/youtube/index.js", "version": "0.0.1"},
    {"srcUrl": "https://gitee.com/maotoumao/MusicFreePlugins/raw/v0.1/dist/kuaishou/index.js", "version": "0.0.2"},
    {"srcUrl": "https://gitee.com/maotoumao/MusicFreePlugins/raw/v0.1/dist/webdav/index.js", "version": "0.0.2"},
    {"srcUrl": "https://gitee.com/maotoumao/MusicFreePlugins/raw/v0.1/dist/bilibili/index.js", "version": "0.3.0"},
    {"srcUrl": "https://fastly.jsdelivr.net/gh/Huibq/keep-alive/Music_Free/xiaomi.js", "version": "0.3.0"},
    {"srcUrl": "https://fastly.jsdelivr.net/gh/Huibq/keep-alive/Music_Free/xiaogou.js", "version": "0.3.0"},
    {"srcUrl": "https://raw.githubusercontent.com/ThomasBy2025/musicfree/refs/heads/main/plugins/wy.js", "version": "2025.09.14"},
    {"srcUrl": "https://raw.githubusercontent.com/ThomasBy2025/musicfree/refs/heads/main/plugins/tx.js", "version": "2025.09.13"},
    {"srcUrl": "https://raw.githubusercontent.com/ThomasBy2025/musicfree/refs/heads/main/plugins/kg.js", "version": "2025.10.01"},
    {"srcUrl": "https://raw.githubusercontent.com/ThomasBy2025/musicfree/refs/heads/main/plugins/kw.js", "version": "2025.09.16"},
]

PLATFORM_MAP = {
    "tx": "腾讯音乐",
    "wy": "网易云",
    "kw": "酷我音乐",
    "kg": "酷狗音乐",
    "mg": "小蜜音乐",
}

QUALITY_MAP = {
    "128k": "low",
    "320k": "standard",
    "flac": "high",
    "flac24bit": "super",
}

# Maps LX playlist names to MusicFree sheet titles and IDs.
# id=None means auto-generate a nanoid; id="favorite" is the built-in Loved sheet.
PLAYLIST_MAP = {
    "list__name_love": {"title": "我喜欢", "id": "favorite"},
    "list__name_default": {"title": "Default", "id": None},
    "KTV": {"title": "KTV", "id": None},
    "KTV English": {"title": "KTV English", "id": None},
    "KTV Japanese": {"title": "KTV Japanese", "id": None},
    "WarmUp": {"title": "WarmUp", "id": None},
}

EXPECTED_TOTAL = 646
EXPECTED_COUNTS = {
    "list__name_love": 315,
    "list__name_default": 232,
    "KTV": 62,
    "KTV English": 31,
    "KTV Japanese": 2,
    "WarmUp": 4,
}


def _nanoid(size: int = 21) -> str:
    alphabet = string.ascii_letters + string.digits + "_-"
    return "".join(random.choices(alphabet, k=size))


def _parse_duration(interval: str) -> int:
    """Convert 'mm:ss' string to total seconds integer."""
    try:
        mm, ss = interval.split(":")
        return int(mm) * 60 + int(ss)
    except (ValueError, AttributeError):
        return 0


def _convert_qualities(source: str, qualitys: list) -> dict:
    """Map LX quality list to MusicFree qualities object."""
    result = {}
    for q in qualitys:
        mf_key = QUALITY_MAP.get(q.get("type", ""))
        if not mf_key:
            continue
        entry = {}
        if "size" in q:
            entry["size"] = q["size"]
        if source == "kg" and "hash" in q:
            entry["hash"] = q["hash"].upper()
        result[mf_key] = entry
    return result


def _common_fields(lx_song: dict, source: str) -> dict:
    meta = lx_song.get("meta", {})
    artist = lx_song.get("singer", "")

    # Determine dynamic platform
    if source == "youtube":
        platform_name = "youtube"
    elif source == "tx":
        platform_name = "Q音"
    elif source == "wy":
        platform_name = "网易云"
    elif source == "bilibili":
        platform_name = "bilibili"
    else:
        # Fallback for kw, kg, mg using the artist history tally
        tally = globals().get("ARTIST_TALLY", {})
        artist_counts = tally.get(artist, {})
        wy_count = artist_counts.get("wy", 0)
        tx_count = artist_counts.get("tx", 0)
        
        # Give them the best matching platform from 'test' list
        if wy_count > tx_count:
            platform_name = "网易云"
        else:
            # Player said Q音 works better, make it the primary fallback
            platform_name = "Q音"
        

    return {
        "type": "0",
        "title": lx_song.get("name", ""),
        "artist": artist,
        "album": meta.get("albumName", ""),
        "artwork": meta.get("picUrl", ""),
        "duration": _parse_duration(lx_song.get("interval", "")),
        "qualities": _convert_qualities(source, meta.get("qualitys", [])),
        "platform": platform_name,
    }


def _convert_tx(lx_song: dict) -> dict:
    meta = lx_song.get("meta", {})
    song = _common_fields(lx_song, "tx")
    song_mid = meta.get("songId", "")
    song.update({
        "id": str(meta.get("id", "")),
        "mid": song_mid,
        "songmid": song_mid,
        "strMediaMid": meta.get("strMediaMid", song_mid),
        "albumid": meta.get("albumId", ""),
        "albummid": meta.get("albumMid", ""),
        "vid": "",
    })
    return song


def _convert_wy(lx_song: dict) -> dict:
    meta = lx_song.get("meta", {})
    song = _common_fields(lx_song, "wy")
    song.update({
        "id": str(meta.get("songId", "")),
        "albumId": meta.get("albumId", ""),
    })
    return song


def _convert_kw(lx_song: dict) -> dict:
    meta = lx_song.get("meta", {})
    song = _common_fields(lx_song, "kw")
    song.update({
        "id": str(meta.get("songId", "")),
        "albumId": meta.get("albumId", ""),
    })
    return song


def _convert_kg(lx_song: dict) -> dict:
    meta = lx_song.get("meta", {})
    song = _common_fields(lx_song, "kg")
    song.update({
        "id": str(meta.get("songId", "")),
        "mid": meta.get("hash", "").upper(),
        "albumId": meta.get("albumId", ""),
    })
    return song


def _convert_mg(lx_song: dict) -> dict:
    meta = lx_song.get("meta", {})
    song = _common_fields(lx_song, "mg")
    song.update({
        "id": str(meta.get("songId", "")),
        "copyrightId": meta.get("copyrightId", ""),
    })
    if "lrcUrl" in meta:
        song["lrcUrl"] = meta["lrcUrl"]
    return song


_CONVERTERS = {
    "tx": _convert_tx,
    "wy": _convert_wy,
    "kw": _convert_kw,
    "kg": _convert_kg,
    "mg": _convert_mg,
}


def _convert_song(lx_song: dict, sort_index: int, base_ts: int) -> dict:
    source = lx_song.get("source", "")
    if source == "youtube":
        return None
        
    converter = _CONVERTERS.get(source)
    if not converter:
        print(f"  WARNING: Unknown source '{source}', treating it as wy")
        converter = _CONVERTERS["wy"]
        
    song = converter(lx_song)
    # Give the first item the largest timestamp, slightly decreasing as we go down
    song["$timestamp"] = base_ts - sort_index
    song["$sortIndex"] = sort_index + 1
    return song


def _resolve_lx_file(arg: str | None) -> str:
    if arg:
        return arg
    if os.path.exists(LX_FILE_CWD):
        return LX_FILE_CWD
    return LX_FILE_DEFAULT


def main() -> None:
    lx_file = _resolve_lx_file(sys.argv[1] if len(sys.argv) > 1 else None)
    output_file = sys.argv[2] if len(sys.argv) > 2 else OUTPUT_FILE_DEFAULT

    with open(lx_file, "rb") as f:
        lx_data = json.loads(gzip.decompress(f.read()))

    if os.path.exists(MF_BACKUP_FILE):
        with open(MF_BACKUP_FILE, "r", encoding="utf-8") as f:
            plugins = json.load(f).get("plugins", [])
        print(f"Plugins: loaded {len(plugins)} from {MF_BACKUP_FILE}")
        plugins = DEFAULT_PLUGINS
        print(f"Plugins: {MF_BACKUP_FILE} not found — using {len(plugins)} built-in defaults")
    lx_lists = lx_data.get("data", [])
    base_ts = int(time.time() * 1000)

    # First pass: Tally artists to tx vs wy
    artist_tally = {}
    for lx_list in lx_lists:
        for song in lx_list.get("list", []):
            src = song.get("source", "")
            artist = song.get("singer", "")
            if src in ("tx", "wy"):
                if artist not in artist_tally:
                    artist_tally[artist] = {"tx": 0, "wy": 0}
                artist_tally[artist][src] += 1
    
    # Store globally or pass it down. Since it's quick, we can just attach it to an existing module-level var or just pass it to `_convert_song`.
    global ARTIST_TALLY
    ARTIST_TALLY = artist_tally

    music_sheets = []
    total_songs = 0
    platform_counts: dict[str, int] = {}
    errors = 0

    for lx_list in lx_lists:
        list_name = lx_list["name"]
        sheet_info = PLAYLIST_MAP.get(list_name)
        if not sheet_info:
            print(f"WARNING: Unknown playlist '{list_name}' — skipping")
            continue

        sheet_id = sheet_info["id"] or _nanoid()
        sheet_title = sheet_info["title"]
        lx_songs = lx_list.get("list", [])

        music_list = []
        for idx, lx_song in enumerate(lx_songs):
            try:
                mf_song = _convert_song(lx_song, idx, base_ts)
                if mf_song is None:
                    continue  # skipped
                music_list.append(mf_song)
                
                # Retrieve exactly what platform we mapped this to (e.g. Q音)
                mapped_platform = mf_song.get("platform", "unknown")
                platform_counts[mapped_platform] = platform_counts.get(mapped_platform, 0) + 1
            except Exception as exc:
                errors += 1
                print(f"  ERROR: '{lx_song.get('name', '?')}' [{lx_song.get('source')}]: {exc}")

        expected = EXPECTED_COUNTS.get(list_name, "?")
        status = "OK" if len(music_list) == expected else f"MISMATCH (expected {expected})"
        print(f"  {sheet_title!r}: {len(music_list)} songs  [{status}]")

        music_sheets.append({
            "id": sheet_id,
            "title": sheet_title,
            "platform": "本地",
            "musicList": music_list,
        })
        total_songs += len(music_list)

    print(f"\nTotal songs: {total_songs}  ({'OK' if total_songs == EXPECTED_TOTAL else f'MISMATCH — expected {EXPECTED_TOTAL}'})")
    print("By mapped platform:")
    for platform_name, count in sorted(platform_counts.items()):
        print(f"  {platform_name}: {count}")

    if errors:
        print(f"\nConversion errors: {errors}")

    # Validation: no song should have an empty id or platform
    empty_id = sum(
        1 for sheet in music_sheets for song in sheet["musicList"] if not song.get("id")
    )
    empty_platform = sum(
        1 for sheet in music_sheets for song in sheet["musicList"] if not song.get("platform")
    )
    if empty_id or empty_platform:
        print(f"\nWARNING: {empty_id} song(s) with empty id, {empty_platform} song(s) with empty platform")
        print("\nValidation passed: all songs have id and platform")

    output = {"musicSheets": music_sheets, "plugins": plugins}
    with open(output_file, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, separators=(",", ":"))

    print(f"\nOutput written to: {output_file}")


if __name__ == "__main__":
    main()
