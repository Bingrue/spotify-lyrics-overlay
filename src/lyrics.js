function parseTimestamp(minutes, seconds, fraction = "0") {
  const milliseconds = Number(fraction.padEnd(3, "0").slice(0, 3));
  return (Number(minutes) * 60 + Number(seconds)) * 1000 + milliseconds;
}

export function parseSyncedLyrics(lrc) {
  if (!lrc) {
    return [];
  }

  const lines = [];
  const timestampPattern = /\[(\d+):(\d{2})(?:[.:](\d{1,3}))?\]/g;

  for (const rawLine of lrc.split(/\r?\n/)) {
    const text = rawLine.replace(timestampPattern, "").trim();
    const timestamps = [...rawLine.matchAll(timestampPattern)];

    for (const match of timestamps) {
      lines.push({
        time: parseTimestamp(match[1], match[2], match[3]),
        text: text || "♪",
      });
    }
  }

  return lines.sort((a, b) => a.time - b.time);
}

export async function getLyricsForTrack(track) {
  if (!window.spotifyAPI?.getLyrics) {
    throw new Error("Lyrics Electron bridge is unavailable. Please restart the app.");
  }

  const result = await window.spotifyAPI.getLyrics({
    trackName: track.name,
    artistName: track.artists?.map((artist) => artist.name).join(", ") || "",
    albumName: track.album?.name || "",
    duration: (track.duration_ms || 0) / 1000,
  });

  if (!result) {
    return { lines: [], status: "Lyrics not found" };
  }
  if (result.instrumental) {
    return { lines: [], status: "Instrumental" };
  }

  const lines = parseSyncedLyrics(result.syncedLyrics);
  return {
    lines,
    status: lines.length ? "" : "No synchronized lyrics available",
  };
}
