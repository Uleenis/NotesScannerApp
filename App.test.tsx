import { render, screen } from "@testing-library/react-native";

import App from "./App";

test("renders the home screen", async () => {
  await render(<App />);
  expect(screen.getByText("Open up App.js to start working on your app!")).toBeTruthy();
});
