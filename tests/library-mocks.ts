export const NOTEBOOK_SERVICE_MOCK = {
  list: jest.fn(),
  get: jest.fn(),
  create: jest.fn(),
  rename: jest.fn(),
  remove: jest.fn(),
  chapters: jest.fn(),
  createChapter: jest.fn(),
  renameChapter: jest.fn(),
  removeChapter: jest.fn(),
};

export const PAGE_SERVICE_MOCK = {
  list: jest.fn(async () => []),
  get: jest.fn(),
  photoUrl: jest.fn(),
  startReading: jest.fn(),
  setPageType: jest.fn(),
  move: jest.fn(),
  remove: jest.fn(),
  words: jest.fn(async () => ({ words: [], corrections: [], gaps: [] })),
  correct: jest.fn(),
  edit: jest.fn(),
  alerts: jest.fn(async () => []), second: jest.fn(async () => null),
};
