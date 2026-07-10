import { db } from "./firebase";

export async function getTotalUsers() {
  const snap = await db.collection("users").count().get();
  return snap.data().count;
}

export async function getUser(uid: string) {
  const doc = await db.collection("users").doc(uid).get();

  if (!doc.exists) return null;

  return {
    id: doc.id,
    ...doc.data(),
  };
}

export async function addWallet(uid: string, amount: number) {
  const ref = db.collection("wallets").doc(uid);

  await db.runTransaction(async (tx) => {
    const doc = await tx.get(ref);

    if (!doc.exists) throw new Error("Wallet not found");

    const balance = doc.data()?.totalBalance || 0;

    tx.update(ref, {
      totalBalance: balance + amount,
    });
  });

  return true;
}

export async function deductWallet(uid: string, amount: number) {
  const ref = db.collection("wallets").doc(uid);

  await db.runTransaction(async (tx) => {
    const doc = await tx.get(ref);

    if (!doc.exists) throw new Error("Wallet not found");

    const balance = doc.data()?.totalBalance || 0;

    if (balance < amount)
      throw new Error("Insufficient Balance");

    tx.update(ref, {
      totalBalance: balance - amount,
    });
  });

  return true;
}
