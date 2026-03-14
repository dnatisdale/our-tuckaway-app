import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyBHE6i8TMUtY1XuvDTMPAapd-VQH1N7SK4",
  authDomain: "tgn-pwa-gemini.firebaseapp.com",
  projectId: "tgn-pwa-gemini",
  storageBucket: "tgn-pwa-gemini.firebasestorage.app",
  messagingSenderId: "996175606482",
  appId: "1:996175606482:web:8ad13677c230b42f39730b",
  measurementId: "G-7QZ8VPRBRY",
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
