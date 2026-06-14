const admin = require('firebase-admin');

function getPrivateKey() {
  let key;
  if (process.env.FIREBASE_PRIVATE_KEY_B64) {
    key = Buffer.from(process.env.FIREBASE_PRIVATE_KEY_B64, 'base64').toString('utf8');
  } else {
    key = process.env.FIREBASE_PRIVATE_KEY;
  }
  // Corrige \n literais (escapados) que vieram como texto "\\n"
  return key?.replace(/\\n/g, '\n');
}

const app = admin.initializeApp({
  credential: admin.credential.cert({
    projectId:   process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey:  getPrivateKey(),
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
