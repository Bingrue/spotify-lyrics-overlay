const CLIENT_ID = import.meta.env.VITE_SPOTIFY_CLIENT_ID;
const REDIRECT_URI = "http://127.0.0.1:8888/callback";
const TOKEN_URL = "https://accounts.spotify.com/api/token";

function addTokenExpiry(tokens) {
  return {
    ...tokens,
    expires_at: Date.now() + Number(tokens.expires_in || 3600) * 1000,
  };
}

function generateRandomString(length) {
  const possible =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

  let text = "";

  for (let i = 0; i < length; i++) {
    text += possible.charAt(
      Math.floor(Math.random() * possible.length)
    );
  }

  return text;
}

async function sha256(plain) {
  const encoder = new TextEncoder();
  const data = encoder.encode(plain);

  return window.crypto.subtle.digest("SHA-256", data);
}

function base64urlencode(input) {
  return btoa(
    String.fromCharCode(...new Uint8Array(input))
  )
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function createAuthorizationUrl(codeChallenge) {
  const state = generateRandomString(32);
  sessionStorage.setItem("spotify_auth_state", state);

  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    response_type: "code",
    redirect_uri: REDIRECT_URI,
    scope: "user-read-playback-state user-read-currently-playing",
    code_challenge_method: "S256",
    code_challenge: codeChallenge,
    state,
  });

  return `https://accounts.spotify.com/authorize?${params.toString()}`;
}

export async function loginWithSpotify() {
  if (!CLIENT_ID) {
    throw new Error(
      "VITE_SPOTIFY_CLIENT_ID is missing. Make sure the .env file is present."
    );
  }

  const codeVerifier = generateRandomString(64);
  const hashed = await sha256(codeVerifier);
  const codeChallenge = base64urlencode(hashed);

  sessionStorage.setItem("spotify_code_verifier", codeVerifier);

  if (!window.spotifyAPI || typeof window.spotifyAPI.login !== "function") {
    throw new Error(
      "Spotify Electron bridge is unavailable. Please restart the Electron app and try again."
    );
  }

  return window.spotifyAPI.login({
    authUrl: createAuthorizationUrl(codeChallenge),
  });
}

export async function exchangeSpotifyCode(code, returnedState) {
  const codeVerifier = sessionStorage.getItem("spotify_code_verifier");
  const savedState = sessionStorage.getItem("spotify_auth_state");

  if (!codeVerifier) {
    throw new Error("Spotify PKCE code verifier is missing.");
  }

  if (!savedState || !returnedState || returnedState !== savedState) {
    throw new Error("Spotify authorization state did not match.");
  }

  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      grant_type: "authorization_code",
      code,
      redirect_uri: REDIRECT_URI,
      code_verifier: codeVerifier,
    }),
  });

  console.log("Spotify token response status:", response.status);

  if (!response.ok) {
    const errorText = await response.text();
    console.log("Spotify token exchange error body:", errorText);
    throw new Error(
      `Spotify token exchange failed (${response.status}): ${errorText}`
    );
  }

  const data = await response.json();

  if (!data.access_token) {
    throw new Error("Spotify token response did not include an access token.");
  }

  const tokens = addTokenExpiry(data);
  localStorage.setItem("spotify_tokens", JSON.stringify(tokens));
  sessionStorage.removeItem("spotify_code_verifier");
  sessionStorage.removeItem("spotify_auth_state");

  return tokens;
}

export async function refreshSpotifyToken(refreshToken) {
  if (!refreshToken) {
    throw new Error("Spotify refresh token is missing. Please reconnect Spotify.");
  }

  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Spotify token refresh failed (${response.status}): ${errorText}`
    );
  }

  const data = await response.json();
  const currentTokens = JSON.parse(
    localStorage.getItem("spotify_tokens") || "{}"
  );

  const mergedTokens = addTokenExpiry({
    ...currentTokens,
    ...data,
    refresh_token: data.refresh_token || currentTokens.refresh_token,
  });

  localStorage.setItem("spotify_tokens", JSON.stringify(mergedTokens));

  return mergedTokens;
}

export async function getCurrentPlayback(accessToken) {
  const response = await fetch(
    "https://api.spotify.com/v1/me/player",
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    }
  );

  if (response.status === 204) {
    return null;
  }

  if (!response.ok) {
    const errorText = await response.text();
    const error = new Error(
      `Spotify playback request failed (${response.status}): ${errorText}`
    );
    error.status = response.status;
    throw error;
  }

  return response.json();
}
