import * as OpenCC from "opencc-js";

const simplify = OpenCC.Converter({ from: "t", to: "cn" });
const normalize = (text) => simplify(text || "").normalize("NFKC").toLowerCase().trim();

export async function findLyrics(track, request = fetch) {
  const get = async (endpoint, params) => {
    const response = await request(`https://lrclib.net/api/${endpoint}?${params}`, {
      headers: { "User-Agent": "spotify-lyrics-overlay/0.0.0" },
    });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`Lyrics request failed (${response.status}).`);
    return response.json();
  };
  const params = new URLSearchParams({ track_name: track.trackName, artist_name: track.artistName });
  if (track.albumName) params.set("album_name", track.albumName);
  if (Number.isFinite(track.duration)) params.set("duration", String(Math.round(track.duration)));
  const exact = await get("get", params);
  if (exact?.syncedLyrics || exact?.instrumental) return exact;

  const results = await get("search", new URLSearchParams({ track_name: simplify(track.trackName) }));
  const artists = (track.artistNames || [track.artistName]).map(normalize);
  const candidates = (results || []).filter((entry) =>
    entry.syncedLyrics && !entry.instrumental &&
    normalize(entry.trackName) === normalize(track.trackName) &&
    artists.includes(normalize(entry.artistName)) &&
    (!Number.isFinite(track.duration) || Math.abs(entry.duration - track.duration) <= 3)
  );
  candidates.sort((a, b) => {
    const albumScore = (entry) => Number(normalize(entry.albumName) === normalize(track.albumName));
    return albumScore(b) - albumScore(a) ||
      (Number.isFinite(track.duration) ? Math.abs(a.duration - track.duration) - Math.abs(b.duration - track.duration) : 0);
  });
  return candidates[0] || exact;
}
