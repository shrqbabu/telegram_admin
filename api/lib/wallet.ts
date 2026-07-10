import axios from "axios";

const BASE_URL = process.env.APP_URL!;

export async function getWallet(uid: string) {
  const { data } = await axios.post(
    `${BASE_URL}/api/wallet/balance`,
    { uid }
  );

  return data;
}

export async function addWallet(uid: string, amount: number) {
  const { data } = await axios.post(
    `${BASE_URL}/api/wallet/add`,
    {
      uid,
      amount,
      reason: "Telegram Admin",
    }
  );

  return data;
}

export async function deductWallet(uid: string, amount: number) {
  const { data } = await axios.post(
    `${BASE_URL}/api/wallet/deduct`,
    {
      uid,
      amount,
      reason: "Telegram Admin",
    }
  );

  return data;
}
