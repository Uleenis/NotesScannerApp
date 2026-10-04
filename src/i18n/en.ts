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
  account: {
    title: "Account",
  },
  shell: {
    page: "Page",
    capture: "Capture",
    signIn: "Create an account",
    code: "Enter the code",
  },
};

export type Strings = typeof en;
