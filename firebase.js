import { initializeApp } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-app.js";
import { getDatabase } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-database.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyBZmrTDWpjgWw0xlvSb-wW4ZW9bCi-Cum0",
  authDomain: "matkareal-782c4.firebaseapp.com",
  databaseURL: "https://matkareal-782c4-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "matkareal-782c4",
  storageBucket: "matkareal-782c4.firebasestorage.app",
  messagingSenderId: "539021276390",
  appId: "1:539021276390:web:dbe29824bfbdb3ceb03727"
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getDatabase(app);