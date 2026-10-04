import {
  SourceSerif4_400Regular,
  SourceSerif4_400Regular_Italic,
  SourceSerif4_600SemiBold,
} from "@expo-google-fonts/source-serif-4";
import type { TextStyle } from "react-native";

export const colors = {
  paper: "#FAF6EC",
  ink: "#1F1D1A",
  blue: "#24358F",
  sheet: "#FFFDF8",
  inkSecondary: "#6B665E",
  inkTertiary: "#8F897F",
  rule: "#DDD6C9",
  blueTint: "#E6E8F4",
  highlight: "#F6E27A",
  danger: "#A3322A",
} as const;

export const fontFamilies = {
  serif: "SourceSerif4-Regular",
  serifSemiBold: "SourceSerif4-SemiBold",
  serifItalic: "SourceSerif4-Italic",
} as const;

export const fontAssets = {
  [fontFamilies.serif]: SourceSerif4_400Regular,
  [fontFamilies.serifSemiBold]: SourceSerif4_600SemiBold,
  [fontFamilies.serifItalic]: SourceSerif4_400Regular_Italic,
};

export const typography = {
  pageTitle: { fontFamily: fontFamilies.serifSemiBold, fontSize: 26 },
  documentBody: { fontFamily: fontFamilies.serif, fontSize: 17, lineHeight: 26 },
  interfaceBody: { fontSize: 17 },
  interfaceSecondary: { fontSize: 15 },
  footnote: { fontSize: 13 },
} satisfies Record<string, TextStyle>;

export const radius = { control: 8, block: 12 } as const;
