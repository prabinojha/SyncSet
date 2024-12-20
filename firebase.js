const { initializeApp } = require("firebase/app");
const { getAuth } = require("firebase/auth");
const { getFirestore } = require("firebase/firestore");

const firebaseConfig = {
  apiKey: "AIzaSyDUlDGztSXrkUNmxvoHF37s_X-ruQvrXAY",
  authDomain: "syncset100.firebaseapp.com",
  projectId: "syncset100",
  storageBucket: "syncset100.firebasestorage.app",
  messagingSenderId: "519453488014",
  appId: "1:519453488014:web:579cf3305a8d7d697f6adf",
  measurementId: "G-0G1NEJ6FF3"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

module.exports = { app, auth, db };