import { initializeApp, getApps } from 'firebase/app';
import type { FirebaseApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import type { Auth } from 'firebase/auth';
import { getDatabase } from 'firebase/database';
import type { Database } from 'firebase/database';

export interface FirebaseConfig {
  apiKey: string;
  authDomain: string;
  databaseURL: string;
  projectId: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
}

const DEFAULT_CONFIG_KEY = 'firebase-bell-config';

// User's Firebase configuration loaded from environment variables
const HARDCODED_CONFIG: FirebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || "",
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || "",
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || "",
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || "",
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || "",
  appId: import.meta.env.VITE_FIREBASE_APP_ID || "",
  databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL || ""
};

export function getSavedFirebaseConfig(): FirebaseConfig | null {
  const saved = localStorage.getItem(DEFAULT_CONFIG_KEY);
  if (saved) {
    try {
      return JSON.parse(saved) as FirebaseConfig;
    } catch (e) {
      console.error('Hiba a tárolt Firebase konfiguráció beolvasásakor:', e);
    }
  }
  // Fallback to hardcoded configuration
  return HARDCODED_CONFIG;
}

export function saveFirebaseConfig(config: FirebaseConfig) {
  localStorage.setItem(DEFAULT_CONFIG_KEY, JSON.stringify(config));
}

export function clearFirebaseConfig() {
  localStorage.removeItem(DEFAULT_CONFIG_KEY);
}

let firebaseApp: FirebaseApp | null = null;
let firebaseAuth: Auth | null = null;
let firebaseDb: Database | null = null;

const savedConfig = getSavedFirebaseConfig();

if (savedConfig) {
  try {
    firebaseApp = initializeApp(savedConfig);
    firebaseAuth = getAuth(firebaseApp);
    firebaseDb = getDatabase(firebaseApp);
  } catch (e) {
    console.error('Firebase inicializálási hiba a konfigurációval:', e);
  }
}

export function initFirebase(config: FirebaseConfig): boolean {
  try {
    if (getApps().length > 0) {
      saveFirebaseConfig(config);
      return true;
    }
    firebaseApp = initializeApp(config);
    firebaseAuth = getAuth(firebaseApp);
    firebaseDb = getDatabase(firebaseApp);
    saveFirebaseConfig(config);
    return true;
  } catch (e) {
    console.error('Firebase kézi inicializálási hiba:', e);
    return false;
  }
}

export { firebaseApp as app, firebaseAuth as auth, firebaseDb as db };
export const isFirebaseConfigured = () => !!firebaseApp && !!firebaseAuth && !!firebaseDb;
export { HARDCODED_CONFIG };
