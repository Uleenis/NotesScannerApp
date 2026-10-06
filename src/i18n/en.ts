const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

export const en = {
  common: {
    cancel: "Cancel",
    done: "Done",
    back: "Back",
    retry: "Try again",
    scan: "Scan",
  },
  library: {
    title: "Library",
    notebooks: "Notebooks",
    newNotebook: "New notebook",
    loadFailed: "Your notebooks could not be loaded.",
    firstLaunch: {
      title: "Your notes, neatly copied",
      body: "Create a notebook for your first course, then photograph a page: the app copies it out for you.",
      create: "Create a notebook",
    },
  },
  newNotebook: {
    title: "New notebook",
    create: "Create",
    nameLabel: "Notebook name",
    hint: "One notebook per course, or one for your journal.",
    duplicate: (name: string) => `You already have a notebook “${name}”. Choose another name.`,
    failed: "The notebook could not be created. Try again.",
  },
  notebook: {
    pageCount: (count: number) => (count === 0 ? "No pages" : count === 1 ? "1 page" : `${count} pages`),
    emptyTitle: "Your first page",
    emptyBody: "Photograph a page of your course: it will appear here, copied out neatly.",
  },
  capture: {
    hint: "The whole page, flat and well lit",
    notebookLabel: "Destination notebook",
    flashLabel: "Flash",
    shutterLabel: "Take the photo",
    counterMonth: (remaining: number) => (remaining === 1 ? "Only 1 page left this month" : `Only ${remaining} pages left this month`),
    counterTrial: (remaining: number) => (remaining === 1 ? "Only 1 trial page left" : `Only ${remaining} trial pages left`),
    reviewTitle: (page: number, notebook: string) => `Page ${page} · ${notebook}`,
    retake: "Retake",
    read: "Read the page",
    sending: "Sending your page…",
    noConnection: "No connection. Reconnect to scan",
    cameraNeeded: "The app needs the camera to scan your pages",
    openSettings: "Open Settings",
    photoUnreadable: "This photo cannot be read. Retake it.",
    sendFailed: "Your page could not be sent. Try again.",
  },
  limit: {
    monthTitle: (max: number) => `Your ${max} pages this month are read`,
    monthBody: (resetMonth: number | null) =>
      `You can scan new ones ${resetMonth === null ? "next month" : `on ${MONTHS[resetMonth]} 1`}. All your pages stay available.`,
    understood: "Got it",
    accountTitle: "Create an account to continue",
    trialBody: "Your 3 trial pages are read. With a free account you get 15 a month, and your pages are kept.",
    dailyBody: "Trials without an account are full for today. With a free account, you can scan right away.",
    createAccount: "Create an account",
    later: "Later",
  },
  account: {
    title: "Account",
  },
  shell: {
    page: "Page",
    signIn: "Create an account",
    code: "Enter the code",
  },
};

export type Strings = typeof en;
