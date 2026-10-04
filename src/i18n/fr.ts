import type { Strings } from "./en";

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
  account: {
    title: "Compte",
  },
  shell: {
    page: "Page",
    capture: "Capture",
    signIn: "Créer un compte",
    code: "Entre le code",
  },
};
