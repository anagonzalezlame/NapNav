import { initializeApp, FirebaseApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut } from 'firebase/auth';
import { getFirestore, doc, getDocFromServer } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: (import.meta as any).env?.VITE_FIREBASE_API_KEY,
  authDomain: (import.meta as any).env?.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: (import.meta as any).env?.VITE_FIREBASE_PROJECT_ID,
  storageBucket: (import.meta as any).env?.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: (import.meta as any).env?.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: (import.meta as any).env?.VITE_FIREBASE_APP_ID
};

// Validación de configuración antes de inicializar
const hasRealConfig = firebaseConfig.apiKey && firebaseConfig.apiKey !== 'tu-api-key' && firebaseConfig.projectId;

if (!hasRealConfig) {
  console.warn("⚠️ Firebase API Key no configurada o inválida. Las funciones de autenticación y base de datos no estarán disponibles.");
}

// Inicialización segura de Firebase para evitar errores fatales si faltan las claves de entorno
let app: FirebaseApp;
try {
  if (hasRealConfig) {
    app = initializeApp(firebaseConfig);
  } else {
    // Inicialización mínima para evitar que la app explote antes de configurar env vars
    app = initializeApp({ apiKey: "mock-key-12345", projectId: "mock-project-id", appId: "1:12345:web:12345" }, "FallbackApp-" + Date.now());
  }
} catch (e) {
  console.error("Error al inicializar Firebase:", e);
  app = initializeApp({ apiKey: "mock-key-12345", projectId: "mock-project-id", appId: "1:12345:web:12345" }, "FallbackAppFallback-" + Date.now());
}

export const auth = getAuth(app);
const databaseId = (import.meta as any).env?.VITE_FIREBASE_FIRESTORE_DATABASE_ID;
export const db = databaseId && typeof databaseId === 'string' ? getFirestore(app, databaseId) : getFirestore(app);

export const googleProvider = new GoogleAuthProvider();

export async function signInWithGoogle() {
  if (!hasRealConfig) {
    console.warn("Autenticación deshabilitada: Firebase no está configurado.");
    return null;
  }
  try {
    const result = await signInWithPopup(auth, googleProvider);
    return result.user;
  } catch (error) {
    console.error("Error signing in with Google:", error);
    throw error;
  }
}

export async function logout() {
  try {
    await signOut(auth);
  } catch (error) {
    console.error("Error signing out:", error);
    throw error;
  }
}

// Error handling logic as requested
export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  }
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData?.map(provider => ({
        providerId: provider.providerId,
        email: provider.email,
      })) || []
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

// CRITICAL: Connection test
async function testConnection() {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if(error instanceof Error && error.message.includes('the client is offline')) {
      console.error("Please check your Firebase configuration.");
    }
  }
}
testConnection();
