import type { Strings } from "./en";

const MONTHS = [
  "janvier",
  "février",
  "mars",
  "avril",
  "mai",
  "juin",
  "juillet",
  "août",
  "septembre",
  "octobre",
  "novembre",
  "décembre",
];

export const fr: Strings = {
  common: {
    cancel: "Annuler",
    done: "OK",
    back: "Retour",
    retry: "Réessayer",
    scan: "Scanner",
  },
  library: {
    title: "Bibliothèque",
    notebooks: "Carnets",
    newNotebook: "Nouveau carnet",
    loadFailed: "Tes carnets n'ont pas pu être chargés.",
    firstLaunch: {
      title: "Tes notes, au propre",
      body: "Crée un carnet pour ton premier cours, puis photographie une page : l'app la recopie pour toi.",
      create: "Créer un carnet",
    },
  },
  newNotebook: {
    title: "Nouveau carnet",
    create: "Créer",
    nameLabel: "Nom du carnet",
    hint: "Un carnet par cours, ou un pour ton journal.",
    duplicate: (name: string) => `Tu as déjà un carnet « ${name} ». Choisis un autre nom.`,
    failed: "Le carnet n'a pas pu être créé. Réessaie.",
  },
  notebook: {
    pageCount: (count: number) => (count === 0 ? "Aucune page" : count === 1 ? "1 page" : `${count} pages`),
    emptyTitle: "Ta première page",
    emptyBody: "Photographie une page de ton cours : elle apparaîtra ici, recopiée au propre.",
  },
  capture: {
    hint: "Toute la page, à plat, bien éclairée",
    notebookLabel: "Carnet de destination",
    flashLabel: "Flash",
    shutterLabel: "Prendre la photo",
    counterMonth: (remaining: number) => (remaining === 1 ? "Plus qu'une page ce mois-ci" : `Plus que ${remaining} pages ce mois-ci`),
    counterTrial: (remaining: number) => (remaining === 1 ? "Plus qu'une page d'essai" : `Plus que ${remaining} pages d'essai`),
    reviewTitle: (page: number, notebook: string) => `Page ${page} · ${notebook}`,
    retake: "Reprendre",
    read: "Lire la page",
    sending: "Envoi de ta page…",
    noConnection: "Pas de connexion. Reconnecte-toi pour scanner",
    cameraNeeded: "L'app a besoin de l'appareil photo pour scanner tes pages",
    openSettings: "Ouvrir Réglages",
    photoUnreadable: "Cette photo ne peut pas être lue. Reprends-la.",
    sendFailed: "Ta page n'a pas pu être envoyée. Réessaie.",
  },
  limit: {
    monthTitle: (max: number) => `Tes ${max} pages du mois sont lues`,
    monthBody: (resetMonth: number | null) =>
      `Tu pourras en scanner de nouvelles ${resetMonth === null ? "le mois prochain" : `le 1er ${MONTHS[resetMonth]}`}. Tes pages restent toutes consultables.`,
    understood: "Compris",
    accountTitle: "Crée un compte pour continuer",
    trialBody: "Tes 3 pages d'essai sont lues. Avec un compte gratuit, tu en as 15 par mois, et tes pages sont gardées.",
    dailyBody: "Les essais sans compte sont complets pour aujourd'hui. Avec un compte gratuit, tu scannes tout de suite.",
    createAccount: "Créer un compte",
    later: "Plus tard",
  },
  account: {
    title: "Compte",
  },
  shell: {
    page: "Page",
    signIn: "Créer un compte",
    code: "Entre le code",
  },
};
