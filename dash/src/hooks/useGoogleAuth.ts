import { useCallback, useEffect, useState } from "react";
import type { GoogleUser } from "../types";

const CLIENT_ID =
  "753871561934-ruse0p8a2k763umnkuj9slq9tlemim9o.apps.googleusercontent.com";

// Decode the JWT payload — we only need the public profile claims, no verification
// needed here (the server verifies against Google's tokeninfo endpoint).
function decodeJwtPayload(token: string): Record<string, string> {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return {};
    const decoded = atob(parts[1].replace(/-/g, "+").replace(/_/g, "/"));
    return JSON.parse(decoded) as Record<string, string>;
  } catch {
    return {};
  }
}

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (cfg: {
            client_id: string;
            callback: (r: { credential: string }) => void;
            auto_select?: boolean;
          }) => void;
          renderButton: (
            el: HTMLElement,
            opts: {
              theme?: string;
              size?: string;
              shape?: string;
              width?: number;
              text?: string;
            },
          ) => void;
          prompt: () => void;
          disableAutoSelect: () => void;
          revoke: (hint: string, done: () => void) => void;
        };
      };
    };
  }
}

const STORAGE_KEY = "gsi_credential";

export function useGoogleAuth() {
  const [user, setUser] = useState<GoogleUser | null>(() => {
    // Restore from sessionStorage on first load so refresh doesn't log out.
    const stored = sessionStorage.getItem(STORAGE_KEY);
    if (!stored) return null;
    const payload = decodeJwtPayload(stored);
    if (!payload.sub) return null;
    // Reject expired tokens — Google ID tokens expire after ~1 hour.
    const expSec = parseInt(payload.exp ?? "0", 10);
    if (expSec && Date.now() / 1000 > expSec) {
      sessionStorage.removeItem(STORAGE_KEY);
      return null;
    }
    return {
      sub: payload.sub,
      email: payload.email ?? "",
      name: payload.name ?? "",
      picture: payload.picture ?? "",
      idToken: stored,
    };
  });

  const handleCredential = useCallback((credential: string) => {
    sessionStorage.setItem(STORAGE_KEY, credential);
    const payload = decodeJwtPayload(credential);
    setUser({
      sub: payload.sub ?? "",
      email: payload.email ?? "",
      name: payload.name ?? "",
      picture: payload.picture ?? "",
      idToken: credential,
    });
  }, []);

  // Initialise GIS once the script has loaded.
  useEffect(() => {
    function init() {
      window.google?.accounts.id.initialize({
        client_id: CLIENT_ID,
        callback: (r) => handleCredential(r.credential),
        auto_select: true,
      });
      // If we already have a stored credential don't show the One Tap prompt —
      // just restore silently (already done above in useState).
      if (!sessionStorage.getItem(STORAGE_KEY)) {
        window.google?.accounts.id.prompt();
      }
    }

    if (window.google) {
      init();
    } else {
      // Script not loaded yet — poll until it is.
      const id = window.setInterval(() => {
        if (window.google) {
          clearInterval(id);
          init();
        }
      }, 200);
      return () => clearInterval(id);
    }
  }, [handleCredential]);

  const signOut = useCallback(() => {
    sessionStorage.removeItem(STORAGE_KEY);
    if (user?.email) {
      window.google?.accounts.id.revoke(user.email, () => {});
    }
    window.google?.accounts.id.disableAutoSelect();
    setUser(null);
  }, [user]);

  return { user, signOut, handleCredential };
}
