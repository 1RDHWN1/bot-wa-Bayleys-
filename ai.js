import axios from "axios";

export async function askAI(text) {
  const model = process.env.AI_MODEL || "gpt-4o-mini";

  const res = await axios.post(
    "https://openrouter.ai/api/v1/chat/completions",
    {
      model,
      messages: [{ role: "user", content: text }],
      max_tokens: 512
    },
    {
      headers: {
        Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
        "Content-Type": "application/json"
      }
    }
  );

  return {
    content: res.data.choices[0].message.content,
    model
  };
}


