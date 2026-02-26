/**
 * useAuth — Firebase Authentication hook.
 *
 * Provides the current user state, login/logout, and fresh ID tokens
 * that are automatically refreshed before expiry.
 *
 * Key design decisions:
 *  - `getToken()` always calls `getIdToken(false)` so Firebase SDK
 *    auto-refreshes when the cached token is within 5 min of expiry.
 *  - `getTokenFresh()` forces a refresh — used by 401-retry logic.
 *  - `onAuthStateChanged` only fires on login/logout, NOT on token refresh,
 *    so periodic API calls must always go through getToken().
 */
import { useState, useEffect, useCallback } from "react";
import {
  onAuthStateChanged,
  signInWithPopup,
  signOut as firebaseSignOut,
  type User,
} from "firebase/auth";
import { auth, googleProvider } from "../firebase";

const IS_DEV_MODE = import.meta.env.VITE_DEV_MODE === "1";

export interface AuthState {
  /** Firebase user object, null when not logged in */
  user: User | null;
  /** True while we wait for Firebase to restore the session */
  loading: boolean;
  /** ID token for backend API calls (may be stale — prefer getToken()) */
  token: string | null;
}

export function useAuth() {
  const [state, setState] = useState<AuthState>({
    user: null,
    loading: !IS_DEV_MODE,
    token: null,
  });

  useEffect(() => {
    if (IS_DEV_MODE) {
      setState({ user: null, loading: false, token: null });
      return;
    }
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (user) {
        try {
          const token = await user.getIdToken();
          setState({ user, loading: false, token });
        } catch {
          // Network error getting token — still set user so we can retry later
          setState({ user, loading: false, token: null });
        }
      } else {
        setState({ user: null, loading: false, token: null });
      }
    });
    return unsub;
  }, []);

  const signInWithGoogle = useCallback(async () => {
    if (IS_DEV_MODE) return;
    await signInWithPopup(auth, googleProvider);
    // onAuthStateChanged will fire and set state
  }, []);

  const signOut = useCallback(async () => {
    if (IS_DEV_MODE) {
      setState({ user: null, loading: false, token: null });
      return;
    }
    await firebaseSignOut(auth);
    setState({ user: null, loading: false, token: null });
  }, []);

  /**
   * Get a valid token — auto-refreshes if within 5 min of expiry.
   * This is the preferred method for every API call.
   */
  const getToken = useCallback(async (): Promise<string | null> => {
    if (IS_DEV_MODE) return null;
    if (!state.user) return null;
    try {
      return await state.user.getIdToken(false);
    } catch {
      return null;
    }
  }, [state.user]);

  /**
   * Force a fresh token — for 401 retry scenarios.
   */
  const getTokenFresh = useCallback(async (): Promise<string | null> => {
    if (IS_DEV_MODE) return null;
    if (!state.user) return null;
    try {
      return await state.user.getIdToken(true);
    } catch {
      return null;
    }
  }, [state.user]);

  return { ...state, signInWithGoogle, signOut, getToken, getTokenFresh };
}
