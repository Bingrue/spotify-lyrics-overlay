import { useEffect, useMemo, useState } from "react";
import "./App.css";
import {
  exchangeSpotifyCode,
  getCurrentPlayback,
  loginWithSpotify,
  refreshSpotifyToken,
} from "./spotifyAuth";
import { getLyricsForTrack } from "./lyrics";

function readStoredTokens() {
  try {
    const raw = localStorage.getItem("spotify_tokens");
    return raw ? JSON.parse(raw) : null;
  } catch (_error) {
    return null;
  }
}

function App() {
  const [tokens, setTokens] = useState(readStoredTokens);
  const [track, setTrack] = useState(null);
  const [progressMs, setProgressMs] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [lyrics, setLyrics] = useState([]);
  const [lyricsStatus, setLyricsStatus] = useState("Play a song on Spotify");

  useEffect(() => {
    if (!tokens?.access_token) {
      return undefined;
    }

    let cancelled = false;
    let syncing = false;
    let activeTokens = tokens;
    let refreshPromise = null;

    const refreshAccessToken = async () => {
      if (!refreshPromise) {
        refreshPromise = refreshSpotifyToken(activeTokens.refresh_token).finally(() => {
          refreshPromise = null;
        });
      }

      activeTokens = await refreshPromise;
      if (!cancelled) {
        setTokens(activeTokens);
      }
      return activeTokens;
    };

    const syncPlayback = async () => {
      if (syncing) {
        return;
      }

      syncing = true;
      try {
        if (activeTokens.expires_at && activeTokens.expires_at <= Date.now() + 60_000) {
          await refreshAccessToken();
        }

        let playback;
        try {
          playback = await getCurrentPlayback(activeTokens.access_token);
        } catch (playbackError) {
          if (playbackError.status !== 401) {
            throw playbackError;
          }

          await refreshAccessToken();
          playback = await getCurrentPlayback(activeTokens.access_token);
        }

        if (cancelled) {
          return;
        }

        if (!playback) {
          setTrack(null);
          setProgressMs(0);
          return;
        }

        setTrack((currentTrack) =>
          currentTrack?.id === playback.item?.id ? currentTrack : playback.item
        );
        setProgressMs(playback.progress_ms ?? 0);
        setError("");
      } catch (syncError) {
        if (!cancelled) {
          setError(syncError.message || "Spotify request failed.");
        }
      } finally {
        syncing = false;
      }
    };

    syncPlayback();
    const intervalId = setInterval(syncPlayback, 1500);

    return () => {
      cancelled = true;
      clearInterval(intervalId);
    };
  }, [tokens]);

  useEffect(() => {
    if (!track?.id) {
      setLyrics([]);
      setLyricsStatus("Play a song on Spotify");
      return;
    }

    let cancelled = false;
    setLyrics([]);
    setLyricsStatus("Loading lyrics...");

    getLyricsForTrack(track)
      .then((result) => {
        if (!cancelled) {
          setLyrics(result.lines);
          setLyricsStatus(result.status);
        }
      })
      .catch((lyricsError) => {
        if (!cancelled) {
          setLyrics([]);
          setLyricsStatus(lyricsError.message || "Unable to load lyrics");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [track]);

  const currentIndex = useMemo(() => {
    let index = 0;

    for (let i = 0; i < lyrics.length; i++) {
      if (progressMs >= lyrics[i].time) {
        index = i;
      } else {
        break;
      }
    }

    return index;
  }, [lyrics, progressMs]);

  const previous = lyrics[currentIndex - 1];
  const current = lyrics[currentIndex];
  const next = lyrics[currentIndex + 1];

  const handleConnectSpotify = async () => {
    setIsLoading(true);
    setError("");

    try {
      const authResult = await loginWithSpotify();
      console.log("loginWithSpotify authResult:", authResult);

      if (!authResult || !authResult.code) {
        throw new Error("Spotify authorization did not return a code.");
      }

      const nextTokens = await exchangeSpotifyCode(authResult.code, authResult.state);

      localStorage.setItem("spotify_tokens", JSON.stringify(nextTokens));
      setTokens(nextTokens);
      setError("");
    } catch (authError) {
      console.log("Spotify auth catch:", authError);
      setError(authError.message || "Unable to connect to Spotify.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="overlay">
      <div className="panel">
        <div className="lyrics">
          <div className="previous">{previous?.text || ""}</div>
          <div className="current">{current?.text || lyricsStatus}</div>
          <div className="next">{next?.text || ""}</div>
        </div>

        <button
          type="button"
          className="spotify-login"
          onClick={handleConnectSpotify}
          disabled={isLoading}
        >
          {isLoading
            ? "Connecting..."
            : tokens?.access_token
              ? "Spotify Connected"
              : "Connect Spotify"}
        </button>

        {error ? <div className="spotify-error">{error}</div> : null}
      </div>
    </div>
  );
}

export default App;
