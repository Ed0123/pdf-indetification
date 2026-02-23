/**
 * useAuth — Firebase Authentication hook.
 *
 * Provides the current user state, login/logout, and the ID token
 * that must be sent to the backend in Authorization headers.
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
  /** ID token for backend API calls */
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
        const token = await user.getIdToken();
        setState({ user, loading: false, token });
      } else {
        setState({ user: null, loading: false, token: null });
      }
    });
    return unsub;
  }, []);

  const signInWithGoogle = useCallback(async () => {
    if (IS_DEV_MODE) return;
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err) {
      console.error("Google sign-in failed:", err);
      throw err;
    }
  }, []);

  const signOut = useCallback(async () => {
    if (IS_DEV_MODE) {
      setState({ user: null, loading: false, token: null });
      return;
    }
    await firebaseSignOut(auth);
    setState({ user: null, loading: false, token: null });
  }, []);

  /** Convenience: get a fresh token (auto-refreshes if expired). */
  const getToken = useCallback(async () => {
    if (IS_DEV_MODE) return null;
    if (!state.user) return null;
    return state.user.getIdToken();
  }, [state.user]);

  return { ...state, signInWithGoogle, signOut, getToken };
}
