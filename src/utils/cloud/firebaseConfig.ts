/**
 * Public client configuration of the JBLBase Firebase project.
 *
 * These values only identify the project; they are not secrets. Access is
 * controlled by the security rules in firebase/firestore.rules. Service
 * account keys and other secrets never go into the repository.
 */
export const firebaseConfig = {
    apiKey: "AIzaSyDv0hIAw1J7w3ZYyTD8VWIT7O6UU4_Hiao",
    authDomain: "jblbase.firebaseapp.com",
    projectId: "jblbase",
    storageBucket: "jblbase.firebasestorage.app",
    messagingSenderId: "1007986885209",
    appId: "1:1007986885209:web:76471668e65df1e64f6748",
} as const;

/** Region of Firestore and all Cloud Functions. */
export const FIREBASE_REGION = "europe-west3";
