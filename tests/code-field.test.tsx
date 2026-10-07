import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { useState } from "react";

import { CodeField } from "@/components/code-field";

function Harness({ onComplete, disabled = false }: { onComplete: (code: string) => void; disabled?: boolean }) {
  const [value, setValue] = useState("");
  return <CodeField label="Code" value={value} onChange={setValue} onComplete={onComplete} disabled={disabled} />;
}

async function mount(disabled = false) {
  const onComplete = jest.fn();
  await render(<Harness onComplete={onComplete} disabled={disabled} />);
  return { onComplete, input: screen.getByLabelText("Code") };
}

function digits(): string {
  return [0, 1, 2, 3, 4, 5].map((index) => String(screen.getByTestId(`code-box-${index}`).props.children ?? "")).join("");
}

test("shows six empty boxes at first, the first one being the current one", async () => {
  await mount();

  expect(digits()).toBe("");
  expect(screen.getByTestId("code-box-0").props.accessibilityState).toEqual({ selected: true });
  expect(screen.getByTestId("code-box-1").props.accessibilityState).toEqual({ selected: false });
});

test("shows each digit in its box and moves the current box along", async () => {
  const { input } = await mount();

  await fireEvent.changeText(input, "48");

  expect(digits()).toBe("48");
  expect(screen.getByTestId("code-box-0").props.children).toBe("4");
  expect(screen.getByTestId("code-box-1").props.children).toBe("8");
  expect(screen.getByTestId("code-box-2").props.accessibilityState).toEqual({ selected: true });
});

test("keeps only digits", async () => {
  const { input, onComplete } = await mount();

  await fireEvent.changeText(input, "4a8 b1");

  expect(digits()).toBe("481");
  expect(onComplete).not.toHaveBeenCalled();
});

test("does not validate before the sixth digit", async () => {
  const { input, onComplete } = await mount();

  await fireEvent.changeText(input, "12345");

  expect(onComplete).not.toHaveBeenCalled();
});

test("validates by itself at the sixth digit, with the code", async () => {
  const { input, onComplete } = await mount();

  await fireEvent.changeText(input, "12345");
  await fireEvent.changeText(input, "123456");

  expect(onComplete).toHaveBeenCalledTimes(1);
  expect(onComplete).toHaveBeenCalledWith("123456");
});

test("validates a code pasted in one go, even with spaces", async () => {
  const { input, onComplete } = await mount();

  await fireEvent.changeText(input, "123 456");

  expect(onComplete).toHaveBeenCalledTimes(1);
  expect(onComplete).toHaveBeenCalledWith("123456");
});

test("validates only once when the sixth digit is announced again", async () => {
  const { input, onComplete } = await mount();

  await fireEvent.changeText(input, "123456");
  await fireEvent.changeText(input, "123456");

  expect(onComplete).toHaveBeenCalledTimes(1);
});

test("ignores a seventh digit", async () => {
  const { input, onComplete } = await mount();

  await fireEvent.changeText(input, "1234567");

  expect(digits()).toBe("123456");
  expect(onComplete).toHaveBeenCalledTimes(1);
  expect(onComplete).toHaveBeenCalledWith("123456");
});

test("validates again after a digit was erased and typed again", async () => {
  const { input, onComplete } = await mount();

  await fireEvent.changeText(input, "123456");
  await fireEvent.changeText(input, "12345");
  await fireEvent.changeText(input, "123456");

  expect(onComplete).toHaveBeenCalledTimes(2);
});

test("accepts no typing while it is disabled", async () => {
  const { input, onComplete } = await mount(true);

  expect(input.props.editable).toBe(false);
  await fireEvent.changeText(input, "123456");

  expect(digits()).toBe("");
  expect(onComplete).not.toHaveBeenCalled();
});

test("ignores a change that reaches it while it is disabled, even without the keyboard", async () => {
  const { input, onComplete } = await mount(true);

  await act(async () => {
    input.props.onChangeText("123456");
  });

  expect(digits()).toBe("");
  expect(onComplete).not.toHaveBeenCalled();
});

test("lets the keyboard offer the code received", async () => {
  const { input } = await mount();

  expect(input.props.textContentType).toBe("oneTimeCode");
  expect(input.props.autoComplete).toBe("one-time-code");
  expect(input.props.keyboardType).toBe("number-pad");
  expect(input.props.maxLength).toBe(6);
});
