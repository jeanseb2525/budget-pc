# Comptes distants Budget PC

Ce fichier contient le bloc a ajouter dans ton projet Apps Script Google Sheets pour que :

- l inscription fonctionne avec email + mot de passe
- la connexion survive a une desinstallation / reinstallation
- le profil et la couleur de curseur soient recuperables sur un autre PC

## Ce que fait ce bloc

- cree une feuille cachee `_BudgetPCUsers`
- stocke :
  - `id`
  - `email`
  - `firstName`
  - `lastName`
  - `cursorColor`
  - `passwordSalt`
  - `passwordHash`
  - `createdAt`
  - `updatedAt`
- ajoute 3 actions a `doPost(e)` :
  - `signUpAccount`
  - `signInAccount`
  - `updateAccountProfile`

## Important

- le mot de passe est hashe cote Apps Script avec un salt aleatoire
- ce n est pas une auth bancaire ou enterprise
- mais pour votre usage perso desktop, c est deja beaucoup mieux qu un compte purement local

## 1. Remplace ton `doPost(e)` par cette version

```javascript
function doPost(e) {
  try {
    const rawBody = e && e.postData && e.postData.contents ? e.postData.contents : "{}";
    const data = JSON.parse(rawBody);
    const action = String(data.action || "").trim();

    if (action === "signUpAccount") {
      const account = signUpAccount_(data);
      return jsonOutput_({ success: true, account: account });
    }

    if (action === "signInAccount") {
      const account = signInAccount_(data);
      return jsonOutput_({ success: true, account: account });
    }

    if (action === "updateAccountProfile") {
      const account = updateAccountProfile_(data);
      return jsonOutput_({ success: true, account: account });
    }

    if (action === "addTicket") {
      const mois = String(data.mois || "").trim();
      const date = String(data.date || "").trim();
      const description = String(data.description || "").trim();
      const categorie = String(data.categorie || "").trim();
      const montant = String(data.montant || "").trim();

      if (!mois || !date || !description || !categorie || !montant) {
        throw new Error("Champs obligatoires manquants.");
      }

      const result = traiterTicketApi_(mois, date, montant, description, categorie);
      return jsonOutput_({ success: true, result: result });
    }

    throw new Error("Action inconnue.");
  } catch (error) {
    return jsonOutput_({
      success: false,
      error: String(error && error.message ? error.message : error)
    });
  }
}
```

## 2. Ajoute ensuite ce bloc complet sous ton script

```javascript
const USERS_SHEET_NAME = "_BudgetPCUsers";

function jsonOutput_(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}

function normalizeAccountEmail_(value) {
  return String(value || "").trim().toLowerCase();
}

function digestHex_(value) {
  const bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    String(value || ""),
    Utilities.Charset.UTF_8
  );

  return bytes.map(b => {
    const v = (b + 256) % 256;
    return v.toString(16).padStart(2, "0");
  }).join("");
}

function createPasswordSalt_() {
  return Utilities.getUuid().replace(/-/g, "");
}

function buildPasswordHash_(password, salt) {
  return digestHex_(String(salt || "") + "::" + String(password || ""));
}

function ensureUsersSheet_() {
  const ss = getBudgetSpreadsheet_();
  let sh = ss.getSheetByName(USERS_SHEET_NAME);

  if (!sh) {
    sh = ss.insertSheet(USERS_SHEET_NAME);
    sh.getRange(1, 1, 1, 9).setValues([[
      "id",
      "email",
      "firstName",
      "lastName",
      "cursorColor",
      "passwordSalt",
      "passwordHash",
      "createdAt",
      "updatedAt"
    ]]);
    sh.hideSheet();
  }

  return sh;
}

function getAllUserRows_() {
  const sh = ensureUsersSheet_();
  const lastRow = sh.getLastRow();

  if (lastRow < 2) {
    return [];
  }

  return sh.getRange(2, 1, lastRow - 1, 9).getValues().map((row, index) => ({
    rowNumber: index + 2,
    id: String(row[0] || ""),
    email: normalizeAccountEmail_(row[1]),
    firstName: String(row[2] || ""),
    lastName: String(row[3] || ""),
    cursorColor: String(row[4] || "#f58d68"),
    passwordSalt: String(row[5] || ""),
    passwordHash: String(row[6] || ""),
    createdAt: String(row[7] || ""),
    updatedAt: String(row[8] || "")
  }));
}

function findUserByEmail_(email) {
  const wanted = normalizeAccountEmail_(email);
  return getAllUserRows_().find(item => item.email === wanted) || null;
}

function toPublicAccount_(user) {
  return {
    id: String(user.id || ""),
    email: normalizeAccountEmail_(user.email),
    firstName: String(user.firstName || ""),
    lastName: String(user.lastName || ""),
    cursorColor: String(user.cursorColor || "#f58d68"),
    createdAt: String(user.createdAt || "")
  };
}

function signUpAccount_(data) {
  const email = normalizeAccountEmail_(data.email);
  const firstName = String(data.firstName || "").trim();
  const lastName = String(data.lastName || "").trim();
  const password = String(data.password || "");
  const cursorColor = String(data.cursorColor || "#f58d68").trim() || "#f58d68";

  if (!firstName || !lastName || !email || !password) {
    throw new Error("Prenom, nom, email et mot de passe sont obligatoires.");
  }

  if (password.length < 6) {
    throw new Error("Le mot de passe doit faire au moins 6 caracteres.");
  }

  if (findUserByEmail_(email)) {
    throw new Error("Un compte existe deja avec cet email.");
  }

  const sh = ensureUsersSheet_();
  const id = Utilities.getUuid();
  const now = new Date().toISOString();
  const salt = createPasswordSalt_();
  const hash = buildPasswordHash_(password, salt);

  sh.appendRow([
    id,
    email,
    firstName,
    lastName,
    cursorColor,
    salt,
    hash,
    now,
    now
  ]);

  return {
    id: id,
    email: email,
    firstName: firstName,
    lastName: lastName,
    cursorColor: cursorColor,
    createdAt: now
  };
}

function signInAccount_(data) {
  const email = normalizeAccountEmail_(data.email);
  const password = String(data.password || "");

  if (!email || !password) {
    throw new Error("Email et mot de passe obligatoires.");
  }

  const user = findUserByEmail_(email);
  if (!user) {
    throw new Error("Identifiants invalides.");
  }

  const candidateHash = buildPasswordHash_(password, user.passwordSalt);
  if (candidateHash !== user.passwordHash) {
    throw new Error("Identifiants invalides.");
  }

  return toPublicAccount_(user);
}

function updateAccountProfile_(data) {
  const currentEmail = normalizeAccountEmail_(data.currentEmail);
  const nextEmail = normalizeAccountEmail_(data.nextEmail);
  const currentPassword = String(data.currentPassword || "");
  const newPassword = String(data.newPassword || "");
  const firstName = String(data.firstName || "").trim();
  const lastName = String(data.lastName || "").trim();
  const cursorColor = String(data.cursorColor || "#f58d68").trim() || "#f58d68";

  if (!currentEmail || !nextEmail || !currentPassword || !firstName || !lastName) {
    throw new Error("Champs profil manquants.");
  }

  const user = findUserByEmail_(currentEmail);
  if (!user) {
    throw new Error("Compte introuvable.");
  }

  const candidateHash = buildPasswordHash_(currentPassword, user.passwordSalt);
  if (candidateHash !== user.passwordHash) {
    throw new Error("Mot de passe actuel invalide.");
  }

  if (newPassword && newPassword.length < 6) {
    throw new Error("Le nouveau mot de passe doit faire au moins 6 caracteres.");
  }

  const nextUserWithEmail = findUserByEmail_(nextEmail);
  if (nextUserWithEmail && nextUserWithEmail.rowNumber !== user.rowNumber) {
    throw new Error("Cet email est deja utilise par un autre compte.");
  }

  const sh = ensureUsersSheet_();
  const now = new Date().toISOString();
  const nextSalt = newPassword ? createPasswordSalt_() : user.passwordSalt;
  const nextHash = newPassword ? buildPasswordHash_(newPassword, nextSalt) : user.passwordHash;

  sh.getRange(user.rowNumber, 1, 1, 9).setValues([[
    user.id,
    nextEmail,
    firstName,
    lastName,
    cursorColor,
    nextSalt,
    nextHash,
    user.createdAt,
    now
  ]]);

  return {
    id: user.id,
    email: nextEmail,
    firstName: firstName,
    lastName: lastName,
    cursorColor: cursorColor,
    createdAt: user.createdAt
  };
}
```

## 3. Redepois ton Apps Script

Une fois le code colle :

1. Enregistre
2. `Deploy > Manage deployments`
3. Mets a jour le deployment web app
4. Garde la meme URL `/exec`

## 4. Test rapide

Avec l app desktop :

1. Cree un compte
2. Deconnecte-toi
3. Reconnecte-toi avec email + mot de passe
4. Desinstalle / reinstalle l app
5. Reconnecte-toi avec le meme email + mot de passe

Si tout est bon, ton compte n est plus perdu avec l installation locale.
