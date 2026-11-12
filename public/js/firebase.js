import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

const configValues = ["apiKey", "authDomain", "projectId", "appId"];
const hasFirebaseConfig = configValues.every((key) => {
  const value = firebaseConfig[key];
  return typeof value === "string" && value.length > 0 && !value.startsWith("YOUR_");
});

export const firebaseReady = hasFirebaseConfig;
const app = firebaseReady ? initializeApp(firebaseConfig) : null;

export const auth = app ? getAuth(app) : null;
export const db = app ? getFirestore(app) : null;
