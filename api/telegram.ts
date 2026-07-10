import type { VercelRequest, VercelResponse } from "@vercel/node";
import axios from "axios";

const TOKEN = process.env.TELEGRAM_BOT_TOKEN!;
const ADMIN_ID = process.env.ADMIN_TELEGRAM_ID!;
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY!;

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
) {
  if (req.method !== "POST") {
    return res.status(200).send("Telegram Bot Running");
  }

  try {
    const update = req.body;

    if (!update.message) {
      return res.status(200).end();
    }

    const chatId = update.message.chat.id;
    const userId = String(update.message.from.id);
    const text = update.message.text || "";

    if (userId !== ADMIN_ID) {
      await sendMessage(chatId, "❌ Unauthorized");
      return res.status(200).end();
    }

    if (text === "/start") {
      return await sendMessage(
        chatId,
`👋 Welcome Admin

Commands

/help
/users
/stats
/server

AI Chat Enabled`
      );
    }

    if (text === "/help") {
      return await sendMessage(
        chatId,
`Available Commands

/users
/stats
/server
/help`
      );
    }

    if (text === "/server") {
      return await sendMessage(chatId, "✅ Server Online");
    }

    const aiReply = await askAI(text);

    await sendMessage(chatId, aiReply);

    return res.status(200).end();

  } catch (err) {
    console.error(err);
    return res.status(500).end();
  }
}

async function sendMessage(chatId: number, text: string) {
  return axios.post(
    `https://api.telegram.org/bot${TOKEN}/sendMessage`,
    {
      chat_id: chatId,
      text
    }
  );
}

async function askAI(prompt: string) {

  const response = await axios.post(
    "https://openrouter.ai/api/v1/chat/completions",
    {
      model: "deepseek/deepseek-chat-v3-0324:free",
      messages: [
        {
          role: "system",
          content: "You are Shariq's personal AI assistant."
        },
        {
          role: "user",
          content: prompt
        }
      ]
    },
    {
      headers: {
        Authorization: `Bearer ${OPENROUTER_API_KEY}`,
        "Content-Type": "application/json"
      }
    }
  );

  return response.data.choices[0].message.content;
}
