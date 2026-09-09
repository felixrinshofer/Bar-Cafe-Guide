import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js";
import {
  getFirestore,
  collection,
  doc,
  setDoc,
  deleteDoc,
  onSnapshot,
  enableIndexedDbPersistence
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";
import {
  getAuth,
  onAuthStateChanged,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  updateProfile
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyDpfGOkOqs_3HpyNCyl-74oucPlWf77FpI",
  authDomain: "bar-cafe-guide.firebaseapp.com",
  projectId: "bar-cafe-guide",
  storageBucket: "bar-cafe-guide.firebasestorage.app",
  messagingSenderId: "398891342345",
  appId: "1:398891342345:web:3c61bc650e32584e9436d8"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);
const venuesCol = collection(db, "venues");
const usersCol = collection(db, "users");
const drinksCol = collection(db, "drinks");

enableIndexedDbPersistence(db).catch(() => {
  /* mehrere Tabs offen oder Browser unterstützt es nicht - Offline-Cache bleibt dann leer, App funktioniert trotzdem */
});

export function subscribeVenues(onChange, onError) {
  return onSnapshot(
    venuesCol,
    snapshot => onChange(snapshot.docs.map(d => ({ id: d.id, ...d.data() }))),
    err => {
      console.error("Firestore-Verbindung fehlgeschlagen", err);
      if (onError) onError(err);
    }
  );
}

export async function putVenue(venue) {
  const { id, ...data } = venue;
  await setDoc(doc(venuesCol, id), data);
}

export async function deleteVenue(id) {
  await deleteDoc(doc(venuesCol, id));
}

export function createId() {
  return doc(venuesCol).id;
}

export function onAuthChange(callback) {
  return onAuthStateChanged(auth, callback);
}

export async function registerUser(email, password, displayName) {
  const cred = await createUserWithEmailAndPassword(auth, email, password);
  await updateProfile(cred.user, { displayName });
  await setDoc(doc(usersCol, cred.user.uid), {
    displayName,
    email,
    createdAt: Date.now()
  });
  return cred.user;
}

export async function loginUser(email, password) {
  const cred = await signInWithEmailAndPassword(auth, email, password);
  return cred.user;
}

export async function logoutUser() {
  await signOut(auth);
}

export function subscribeDrinks(onChange, onError) {
  return onSnapshot(
    drinksCol,
    snapshot => onChange(snapshot.docs.map(d => ({ id: d.id, ...d.data() }))),
    err => {
      console.error("Firestore-Verbindung (drinks) fehlgeschlagen", err);
      if (onError) onError(err);
    }
  );
}

export async function addDrink(drink) {
  const id = doc(drinksCol).id;
  await setDoc(doc(drinksCol, id), { ...drink, createdAt: Date.now() });
  return id;
}
