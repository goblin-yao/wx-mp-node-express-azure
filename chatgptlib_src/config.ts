// Official model (costs money and is not fine-tuned for chat)
// gpt-3.5-turbo text-davinci-003 text-curie-001 text-babbage-001 text-ada-001
// export const CHATGPT_MODEL = "text-davinci-003";

export const CHATGPT_MODEL = process.env.CHATGPT_MODEL || "text-ada-001"; // 是gpt-3.5-turbo 就用另外一个
export const CHATGPT_MODEL_GPT =
  process.env.CHATGPT_MODEL_GPT || "gpt-3.5-turbo";
export const USER_LABEL_DEFAULT = "User";
export const ASSISTANT_LABEL_DEFAULT = "ChatGPT";
