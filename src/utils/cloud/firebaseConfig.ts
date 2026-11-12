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

/**
 * Google Analytics stream of the Firebase project, for the optional usage
 * statistics (src/utils/usageStats.ts). While either value is empty the
 * statistics are switched off and the setting is hidden.
 *
 * `measurementId` is the "G-..." id of the web app. `apiSecret` is a
 * Measurement Protocol secret of that stream; despite its name it only
 * allows sending events, not reading anything, and every app that reports
 * to Analytics ships it. See firebase/SETUP.md.
 */
export const analyticsConfig = {
    measurementId: "",
    apiSecret: "",
};

/** Region of Firestore and all Cloud Functions. */
export const FIREBASE_REGION = "europe-west3";
