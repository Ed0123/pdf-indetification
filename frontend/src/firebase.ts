/**
 * Firebase configuration and initialization.
 *
 * In production, set these via VITE_FIREBASE_* env variables.
 * For development, fill in the values from your Firebase Console → Project Settings.
 */
import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const IS_DEV_MODE = import.meta.env.VITE_DEV_MODE === "1";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY ?? (IS_DEV_MODE ? "dev-api-key" : ""),
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN ?? (IS_DEV_MODE ? "dev.local" : ""),
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID ?? (IS_DEV_MODE ? "dev-project" : ""),
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET ?? (IS_DEV_MODE ? "dev.local" : ""),
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID ?? (IS_DEV_MODE ? "0000000000" : ""),
  appId: import.meta.env.VITE_FIREBASE_APP_ID ?? (IS_DEV_MODE ? "1:0000000000:web:dev" : ""),
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const googleProvider = new GoogleAuthProvider();
