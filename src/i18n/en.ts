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

const SHORT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const withYear = (text: string, year: number | null) => (year === null ? text : `${text}, ${year}`);

const longDate = (day: number, month: number, year: number | null) => withYear(`${MONTHS[month]} ${day}`, year);

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
    latestPages: "Latest pages",
    cardMeta: (notebook: string, date: string) => `${notebook} · ${date}`,
    anonymousReminder: "Your pages are not linked to any account. Create one to keep them.",
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
    pageCountAndDate: (count: string, date: string) => `${count} · ${date}`,
    pagesLoadFailed: "Your pages could not be loaded.",
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
    photoTooLarge: "This photo is too heavy to be sent.",
    shotFailed: "The photo could not be taken. Try again.",
  },
  limit: {
    monthTitle: (max: number) => `Your ${max} pages this month are read`,
    monthBody: (resetMonth: number | null) =>
      `You can scan new ones ${resetMonth === null ? "next month" : `on ${MONTHS[resetMonth]} 1`}. All your pages stay available.`,
    understood: "Got it",
    accountTitle: "Create an account to continue",
    trialBody: (trial: number, monthly: number) =>
      `Your ${trial} trial pages are read. With a free account you get ${monthly} a month, and your pages are kept.`,
    dailyBody: "Trials without an account are full for today. With a free account, you can scan right away.",
    createAccount: "Create an account",
    later: "Later",
  },
  dates: {
    short: (day: number, month: number, year: number | null) => withYear(`${SHORT_MONTHS[month]} ${day}`, year),
    long: longDate,
    takenAt: (day: number, month: number, year: number | null, time: string) => `Taken on ${longDate(day, month, year)} at ${time}`,
  },
  reading: {
    waitingTitle: "Reading your page",
    waitingBody: (notebook: string) => `You can leave this screen: the page keeps being read and will wait for you in ${notebook}.`,
    scanNext: "Scan the next page",
    backTo: (notebook: string) => `Back to ${notebook}`,
    deferredTitle: "The reading did not go through",
    deferredBody: (minutes: number) =>
      `The reading service did not answer. Your photo is saved, and the app will try again in ${minutes} ${minutes === 1 ? "minute" : "minutes"}.`,
    failedTitle: "The reading failed",
    failedBody: "The page could not be read after several tries. Your photo stays saved.",
    relaunch: "Read again",
    relaunchTooSoon: "You already read this page again today. Try again tomorrow.",
    relaunchFailed: "The new try did not go through. Try again.",
    heldTitle: "Page on hold",
    heldBody: "Your page limit is reached. This page will be read when you open it again, once your limit is renewed.",
    unreadableTitle: "The photo could not be read",
    unreadableBody: "Take the page in photo again.",
    loadFailed: "This page could not be loaded.",
  },
  document: {
    pageNumber: (number: number) => `Page ${number}`,
    info: (number: number, date: string) => `Page ${number} · ${date}`,
    openPhoto: "See the original photo",
    stateInProgress: "Reading in progress",
    stateDeferred: (minutes: number) => `Reading delayed · trying again in ${minutes} min`,
    stateFailed: "The reading failed",
  },
  photo: {
    title: "Original photo",
    close: "Close",
    loadFailed: "The photo could not be loaded.",
    label: "The page as it was taken",
  },
  account: {
    title: "Account",
  },
  shell: {
    signIn: "Create an account",
    code: "Enter the code",
  },
};

export type Strings = typeof en;
