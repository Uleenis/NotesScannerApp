export const PROMPT_VERSION = "v0";

export const PROMPT_V0 = [
  "Transcribe the handwritten text in this image exactly as written. Rules:",
  "",
  "- Reproduce the text verbatim, including spelling and grammar mistakes. Do not correct anything.",
  "- Preserve line breaks as they appear on the page.",
  "- Ignore crossed-out text.",
  "- If a word is illegible, write [?] in its place.",
  "- Do not add titles, comments, or explanations.",
  "- Output only the transcription.",
].join("\n");
