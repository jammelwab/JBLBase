// Sets or removes the admin role of a Firebase account.
//
//   npm run set-role -- <email> admin     grant admin
//   npm run set-role -- <email> user      back to normal user
//   npm run set-role -- <email>           show the current role
//
// Needs a service account key of the project:
//   GOOGLE_APPLICATION_CREDENTIALS=/path/to/key.json
// The key never goes into the repository. The account has to sign out and
// in again (or wait up to an hour) before the new role takes effect.
import { applicationDefault, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";

const [email, role] = process.argv.slice(2);
if (!email || (role && role !== "admin" && role !== "user")) {
  console.error("Usage: npm run set-role -- <email> [admin|user]");
  process.exit(1);
}

initializeApp({ credential: applicationDefault() });
const auth = getAuth();
const account = await auth.getUserByEmail(email);
const claims = account.customClaims ?? {};

if (!role) {
  console.log(`${email}: ${claims.admin === true ? "admin" : "user"}`);
  process.exit(0);
}

const { admin: _previous, ...rest } = claims;
await auth.setCustomUserClaims(account.uid, role === "admin" ? { ...rest, admin: true } : rest);
console.log(`${email}: role set to ${role}`);
