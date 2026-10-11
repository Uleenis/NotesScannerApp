import { forwardRef, useEffect, useImperativeHandle } from "react";
import { View } from "react-native";

type FakeCameraProps = { onCameraReady?: () => void; flash?: string; autofocus?: string };

export const takePictureAsync = jest.fn();

export const cameraRendered = jest.fn();

export const cameraBehavior = { readyOnMount: true };

const mountedCameras: (() => void)[] = [];

export function signalCameraReady(): void {
  mountedCameras.forEach((signal) => signal());
}

const FakeCameraView = forwardRef<{ takePictureAsync: typeof takePictureAsync }, FakeCameraProps>(function FakeCameraView(props, ref) {
  const { onCameraReady, flash } = props;
  cameraRendered(props);
  useImperativeHandle(ref, () => ({ takePictureAsync }));
  useEffect(() => {
    if (cameraBehavior.readyOnMount) {
      onCameraReady?.();
    }
    const signal = () => onCameraReady?.();
    mountedCameras.push(signal);
    return () => {
      mountedCameras.splice(mountedCameras.indexOf(signal), 1);
    };
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

export const PHOTO = { uri: "file:///cache/photo.jpg", width: 4080, height: 3060, exif: { Orientation: 6 } };

export function installPermission(permission: FakePermission | null) {
  const request = jest.fn(async () => granted);
  const refresh = jest.fn(async () => permission);
  cameraModule.useCameraPermissions.mockReturnValue([permission, request, refresh]);
  takePictureAsync.mockReset();
  takePictureAsync.mockResolvedValue(PHOTO);
  cameraRendered.mockReset();
  cameraBehavior.readyOnMount = true;
  return { request, refresh };
}
