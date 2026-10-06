import { forwardRef, useEffect, useImperativeHandle } from "react";
import { View } from "react-native";

type FakeCameraProps = { onCameraReady?: () => void; flash?: string };

export const takePictureAsync = jest.fn();

const FakeCameraView = forwardRef<{ takePictureAsync: typeof takePictureAsync }, FakeCameraProps>(function FakeCameraView(props, ref) {
  const { onCameraReady, flash } = props;
  useImperativeHandle(ref, () => ({ takePictureAsync }));
  useEffect(() => {
    onCameraReady?.();
  }, [onCameraReady]);
  return <View testID="camera-view" accessibilityState={{ selected: flash === "on" }} />;
});

export const cameraModule = {
  CameraView: FakeCameraView,
  useCameraPermissions: jest.fn(),
};

export type FakePermission = { granted: boolean; canAskAgain: boolean; status: string; expires: "never" };

export const granted: FakePermission = { granted: true, canAskAgain: true, status: "granted", expires: "never" };
export const refused: FakePermission = { granted: false, canAskAgain: false, status: "denied", expires: "never" };
export const undetermined: FakePermission = { granted: false, canAskAgain: true, status: "undetermined", expires: "never" };

export const PHOTO = { uri: "file:///cache/photo.jpg", width: 3000, height: 4000 };

export function installPermission(permission: FakePermission | null) {
  const request = jest.fn(async () => granted);
  const refresh = jest.fn(async () => permission);
  cameraModule.useCameraPermissions.mockReturnValue([permission, request, refresh]);
  takePictureAsync.mockReset();
  takePictureAsync.mockResolvedValue(PHOTO);
  return { request, refresh };
}
