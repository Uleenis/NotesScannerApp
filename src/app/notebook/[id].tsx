import { ScreenPlaceholder } from "@/components/screen-placeholder";
import { useStrings } from "@/i18n";

export default function NotebookScreen() {
  const t = useStrings();

  return <ScreenPlaceholder label={t.shell.notebook} />;
}
