/**
 * Firebase User Deletion Script
 * Deletes a user by email from Firebase Auth AND removes all their
 * Realtime Database data under users/{uid}
 *
 * Usage:
 *   node scripts/delete-user.js <email>
 *
 * Requirements:
 *   - Place your Firebase service account JSON at: scripts/serviceAccountKey.json
 *   - npm install firebase-admin  (run once)
 */

const admin = require('firebase-admin');
const path = require('path');
const fs = require('fs');

// --- Config ---
const SERVICE_ACCOUNT_PATH = path.join(__dirname, 'serviceAccountKey.json');
const DATABASE_URL = 'https://csengo-ab784-default-rtdb.europe-west1.firebasedatabase.app';

// --- Validate args ---
const email = process.argv[2];
if (!email) {
  console.error('❌  Használat: node scripts/delete-user.js <email>');
  console.error('   Pl.: node scripts/delete-user.js Pista1125@gmail.com');
  process.exit(1);
}

// --- Validate service account file ---
if (!fs.existsSync(SERVICE_ACCOUNT_PATH)) {
  console.error('❌  Nem található a service account kulcs!');
  console.error('');
  console.error('   Lépések a letöltéséhez:');
  console.error('   1. Nyisd meg: https://console.firebase.google.com/project/csengo-ab784/settings/serviceaccounts/adminsdk');
  console.error('   2. Kattints: "Generate new private key"');
  console.error('   3. Mentsd el a letöltött JSON fájlt ide: scripts/serviceAccountKey.json');
  console.error('');
  process.exit(1);
}

// --- Initialize Firebase Admin ---
const serviceAccount = require(SERVICE_ACCOUNT_PATH);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: DATABASE_URL,
});

const auth = admin.auth();
const db = admin.database();

async function deleteUser(email) {
  console.log(`\n🔍  Felhasználó keresése: ${email} ...`);

  // 1. Look up user by email
  let userRecord;
  try {
    userRecord = await auth.getUserByEmail(email);
  } catch (err) {
    if (err.code === 'auth/user-not-found') {
      console.error(`❌  Nem található felhasználó ezzel az email-lel: ${email}`);
    } else {
      console.error('❌  Hiba a felhasználó keresésekor:', err.message);
    }
    process.exit(1);
  }

  const uid = userRecord.uid;
  console.log(`✅  Megtalálva!`);
  console.log(`   Email : ${userRecord.email}`);
  console.log(`   UID   : ${uid}`);
  console.log(`   Létrehozva: ${new Date(userRecord.metadata.creationTime).toLocaleString('hu-HU')}`);

  // 2. Delete all database data for this user
  console.log(`\n🗑️   Adatbázis adatok törlése (users/${uid}) ...`);
  try {
    const userRef = db.ref(`users/${uid}`);
    const snapshot = await userRef.once('value');

    if (snapshot.exists()) {
      const data = snapshot.val();
      const keys = Object.keys(data);
      console.log(`   Talált adatok: ${keys.join(', ')}`);
      await userRef.remove();
      console.log(`✅  Adatbázis adatok törölve.`);
    } else {
      console.log(`ℹ️   Nem volt adatbázis adat ehhez a felhasználóhoz.`);
    }
  } catch (err) {
    console.error('❌  Hiba az adatbázis adatok törlésekor:', err.message);
    process.exit(1);
  }

  // 3. Delete the auth user
  console.log(`\n🗑️   Firebase Auth fiók törlése ...`);
  try {
    await auth.deleteUser(uid);
    console.log(`✅  Auth fiók törölve.`);
  } catch (err) {
    console.error('❌  Hiba az auth fiók törlésekor:', err.message);
    process.exit(1);
  }

  console.log(`\n🎉  Kész! A ${email} fiók és összes adata sikeresen törölve.`);
  console.log(`   Most újra regisztrálhatsz ezzel az email-lel az alkalmazásban.\n`);
  process.exit(0);
}

deleteUser(email);
