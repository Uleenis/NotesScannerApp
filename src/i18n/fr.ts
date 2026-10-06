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

const SHORT_MONTHS = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];

const withYear = (text: string, year: number | null) => (year === null ? text : `${text} ${year}`);

const longDate = (day: number, month: number, year: number | null) => withYear(`${day === 1 ? "1er" : day} ${MONTHS[month]}`, year);

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
    latestPages: "Dernières pages",
    cardMeta: (notebook: string, date: string) => `${notebook} · ${date}`,
    anonymousReminder: "Tes pages ne sont liées à aucun compte. Crée-en un pour les garder.",
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
    pageCountAndDate: (count: string, date: string) => `${count} · ${date}`,
    pagesLoadFailed: "Tes pages n'ont pas pu être chargées.",
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
    photoTooLarge: "Cette photo est trop lourde pour être envoyée.",
    shotFailed: "La photo n'a pas pu être prise. Réessaie.",
  },
  limit: {
    monthTitle: (max: number) => `Tes ${max} pages du mois sont lues`,
    monthBody: (resetMonth: number | null) =>
      `Tu pourras en scanner de nouvelles ${resetMonth === null ? "le mois prochain" : `le 1er ${MONTHS[resetMonth]}`}. Tes pages restent toutes consultables.`,
    understood: "Compris",
    accountTitle: "Crée un compte pour continuer",
    trialBody: (trial: number, monthly: number) =>
      `Tes ${trial} pages d'essai sont lues. Avec un compte gratuit, tu en as ${monthly} par mois, et tes pages sont gardées.`,
    dailyBody: "Les essais sans compte sont complets pour aujourd'hui. Avec un compte gratuit, tu scannes tout de suite.",
    createAccount: "Créer un compte",
    later: "Plus tard",
  },
  dates: {
    short: (day: number, month: number, year: number | null) => withYear(`${day} ${SHORT_MONTHS[month]}`, year),
    long: longDate,
    takenAt: (day: number, month: number, year: number | null, time: string) => `Prise le ${longDate(day, month, year)} à ${time}`,
  },
  reading: {
    waitingTitle: "Lecture de ta page",
    waitingBody: (notebook: string) => `Tu peux quitter cet écran : la page continue d'être lue et t'attendra dans ${notebook}.`,
    scanNext: "Scanner la page suivante",
    backTo: (notebook: string) => `Retour à ${notebook}`,
    deferredTitle: "La lecture n'a pas abouti",
    deferredBody: (minutes: number) =>
      `Le service de lecture n'a pas répondu. Ta photo est enregistrée, l'app réessaie dans ${minutes} ${minutes === 1 ? "minute" : "minutes"}.`,
    failedTitle: "La lecture a échoué",
    failedBody: "La lecture n'a pas pu se faire après plusieurs essais. Ta photo reste enregistrée.",
    relaunch: "Relancer la lecture",
    relaunchTooSoon: "Tu as déjà relancé cette page aujourd'hui. Réessaie demain.",
    relaunchFailed: "La relance n'a pas abouti. Réessaie.",
    heldTitle: "Page en attente",
    heldBody: "Ta limite de pages est atteinte. Cette page sera lue quand tu la rouvriras, une fois ta limite renouvelée.",
    unreadableTitle: "La photo n'a pas pu être lue",
    unreadableBody: "Reprends la page en photo.",
    loadFailed: "Cette page n'a pas pu être chargée.",
  },
  document: {
    pageNumber: (number: number) => `Page ${number}`,
    info: (number: number, date: string) => `Page ${number} · ${date}`,
    openPhoto: "Voir la photo d'origine",
    stateInProgress: "Lecture en cours",
    stateDeferred: (minutes: number) => `Lecture reportée · nouvel essai dans ${minutes} min`,
    stateFailed: "La lecture a échoué",
  },
  photo: {
    title: "Photo d'origine",
    close: "Fermer",
    loadFailed: "La photo n'a pas pu être chargée.",
    label: "La page telle qu'elle a été prise",
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
