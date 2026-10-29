import type { Mail, Mailer } from "./ports.ts";

export const MAX_EMAIL_LENGTH = 254;
export const PARENT_EMAIL = /^(?=[^@]{1,64}@)[A-Za-z0-9_+-]+(\.[A-Za-z0-9_+-]+)*@([A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,63}$/;
export const PARENT_CODE = /^[0-9]{6}$/;

const RESEND_URL = "https://api.resend.com/emails";
const SENDER = "Notes Scanner <onboarding@resend.dev>";
const SEND_TIMEOUT_MS = 10_000;

export function isParentEmail(value: string): boolean {
  return value.length <= MAX_EMAIL_LENGTH && PARENT_EMAIL.test(value);
}

export function parentEmail(code: string): { subject: string; text: string } {
  return {
    subject: "Accord parental pour Notes Scanner · Parental consent for Notes Scanner",
    text: [
      "Bonjour,",
      "",
      "Un enfant dont vous êtes le parent ou le tuteur souhaite activer l'entraînement de l'écriture dans l'application Notes Scanner, et vous demande votre accord.",
      "",
      "L'entraînement apprend l'écriture de l'enfant pour que l'application lise ses notes manuscrites plus fidèlement : elle lui crée un modèle de lecture personnel.",
      "",
      "Pour cela, elle lit les photos de ses pages et d'un test d'écriture, les lectures de ces pages et les corrections qu'il y apporte. Ces données sont gardées par Supabase, en région de Paris ; pendant le développement, l'entraînement tourne sur l'ordinateur du développeur.",
      "",
      "L'entraînement est facultatif : sans lui, l'application fonctionne comme avant. L'enfant peut le retirer à tout moment dans l'application ; le retrait efface son modèle personnel et son test d'écriture.",
      "",
      "Si vous êtes d'accord, donnez-lui ce code, à saisir dans l'application. Il est valable 7 jours.",
      "",
      code,
      "",
      "Si vous n'êtes pas d'accord, ou si cette demande ne vous concerne pas, ignorez cet e-mail : rien ne sera activé.",
      "",
      "---",
      "",
      "Hello,",
      "",
      "A child of whom you are the parent or guardian wishes to turn on handwriting training in the Notes Scanner app, and asks for your consent.",
      "",
      "Training learns the child's handwriting so that the app reads their handwritten notes more faithfully: it builds a personal reading model for them.",
      "",
      "To do so, it reads the photos of their pages and of a writing test, the readings of those pages and the corrections they make. This data is kept by Supabase, in the Paris region; during development, training runs on the developer's computer.",
      "",
      "Training is optional: without it, the app works as before. The child can withdraw it at any time in the app; withdrawing erases their personal model and their writing test.",
      "",
      "If you agree, give them this code, to enter in the app. It is valid for 7 days.",
      "",
      code,
      "",
      "If you do not agree, or if this request does not concern you, ignore this e-mail: nothing will be turned on.",
    ].join("\n"),
  };
}

export class MailError extends Error {
  readonly status: number;

  constructor(status: number) {
    super(`mail_${status}`);
    this.name = "MailError";
    this.status = status;
  }
}

export function createResendMailer(key: string, fetchImpl: typeof fetch = fetch): Mailer {
  return {
    send: async (mail: Mail) => {
      const response = await fetchImpl(RESEND_URL, {
        method: "POST",
        headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
        body: JSON.stringify({ from: SENDER, to: [mail.to], subject: mail.subject, text: mail.text }),
        signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
      });
      await response.body?.cancel();
      if (!response.ok) throw new MailError(response.status);
    },
  };
}

export function mailerFrom(get: (name: string) => string | undefined): Mailer | null {
  const key = get("RESEND_API_KEY");
  return key ? createResendMailer(key) : null;
}
