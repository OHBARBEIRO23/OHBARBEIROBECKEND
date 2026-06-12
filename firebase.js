const admin = require('firebase-admin');

const app = admin.initializeApp({
  credential: admin.credential.cert({
    projectId:   process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey:  process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
  }),
});

const db = admin.firestore(app);
const COL = 'barbearia';

// Lê um documento da collection
async function dbGet(key) {
  const snap = await db.collection(COL).doc(key).get();
  if (!snap.exists) return null;
  const data = snap.data();
  return data.__v !== undefined ? data.__v : data;
}

// Grava um documento
async function dbSet(key, value) {
  await db.collection(COL).doc(key).set({ __v: value });
}

module.exports = { db, dbGet, dbSet, COL };
