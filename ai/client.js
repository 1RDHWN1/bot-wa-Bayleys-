import axios from "axios";
import { OPENROUTER_URL } from "./config.js";

export async function postChatCompletion(payload, timeout = 15000) {
  return axios.post(OPENROUTER_URL, payload, {
    headers: {
      Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
      "Content-Type": "application/json"
    },
    timeout
  });
}
