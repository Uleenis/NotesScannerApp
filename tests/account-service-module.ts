export const accountServiceModule = {
  accountService: {
    startSignUp: jest.fn(),
    startSignIn: jest.fn(),
    confirmSignUp: jest.fn(),
    confirmSignIn: jest.fn(),
    completeTransfer: jest.fn(),
    signOut: jest.fn(),
    deleteAccount: jest.fn(),
  },
};
