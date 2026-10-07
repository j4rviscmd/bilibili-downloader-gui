---
title: How to Download Bilibili Videos with Subtitles (15 Languages)
description: How to save Bilibili videos with subtitles embedded or as separate files. Explains the difference between soft and hard subtitles, supports up to 15 languages plus AI-generated subtitles, and how to display saved subtitle files in your player.
pubDate: 2026-10-07
keywords:
  [
    "bilibili subtitles download",
    "bilibili video with subtitles",
    "bilibili eng subtitles",
  ]
order: 3
---

Bilibili videos often carry subtitles in Chinese and other languages, added by uploaders or the community. Saving the subtitles together with the video keeps them available offline and lets you use your player's subtitle features. This guide explains how to save videos with subtitles using the free [Bilibili Downloader GUI](/bilibili-downloader-gui/) app.

## Soft subtitles vs hard subtitles

Subtitle saving comes in two modes; [Bilibili Downloader GUI](/bilibili-downloader-gui/) supports both.

| Mode           | How it works                                                                       | Best for                                                        |
| -------------- | ---------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Soft subtitles | Saved as a separate file (.srt etc.); players can toggle them and switch languages | People who want to switch subtitles later, or translate         |
| Hard subtitles | Burned into the video; always visible on any device                                | Watching on phones, TVs, or any player without subtitle support |

A plain download without subtitles is of course also available.

## Steps (subtitle settings in the app)

1. Launch the app and paste the Bilibili video URL
2. Alongside quality, choose a subtitle mode (soft / hard / none) and the language
3. Start the download; subtitles are processed first, then the video is saved
4. Progress for the subtitle processing is shown live

**Note**: downloading subtitles requires being logged in to Bilibili via Firefox. The app auto-detects Firefox cookies, so logging in to Bilibili in Firefox once is all it takes. For login details, see the [main how-to guide](/bilibili-downloader-gui/guides/how-to-download/).

## Supported languages (up to 15) and AI subtitles

Bilibili videos can carry community-contributed subtitles in many languages — up to 15 are supported. Popular videos tend to have richer subtitle coverage.

**AI-generated subtitles (CC)** are supported as well. Bilibili's speech-recognition subtitles in Chinese can be saved and embedded just like human-made ones.

Available languages vary per video. When you load a video, the app lists the subtitle languages actually available for it.

## Displaying saved subtitle files in your player

With soft subtitles, the subtitle file is saved next to the video file.

**VLC / mpv / MPC-HC and other major players**: if the subtitle file sits in the same folder with the same base filename, it loads automatically. To load manually, use the player's "add subtitle track" option and pick the file.

**On phones**: use a player app that can open sidecar subtitle files (e.g. VLC for mobile), or simply choose hard subtitles when downloading to guarantee display.

## FAQ

### No subtitles to select or nothing appears?

Either the video has no subtitles at all, or you're not logged in via Firefox. Log in to Bilibili in Firefox and try again.

### Can I save English subtitles?

Yes, if the video has English subtitles registered. Otherwise, AI subtitles (Chinese) may be the only option.

### Soft or hard — which should I pick?

Hard subtitles for phones and TVs, soft subtitles if you want language switching in desktop players.

## Summary

- Two modes: soft (separate file) and hard (burned in)
- [Bilibili Downloader GUI](/bilibili-downloader-gui/) handles up to 15 languages plus AI subtitles, free
- Firefox login is required for subtitle downloads

If you don't need subtitles, see the [main how-to guide](/bilibili-downloader-gui/guides/how-to-download/). For tool selection, the [downloader comparison](/bilibili-downloader-gui/guides/best-downloaders/) has you covered.
