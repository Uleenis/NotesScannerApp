import { useCallback } from "react";
import { Alert } from "react-native";

import { useAuth } from "@/auth/auth-provider";
import { useAllowance } from "@/capture/queries";
import { useStrings } from "@/i18n";
import type { Strings } from "@/i18n/en";
import { beginExport, endExport, reportProgress } from "../activity";
import type { MyDataPlan, MyDataResult, PlanResult } from "./archive";
import { archiveFileName, archiveReadme } from "./readme";
import { myDataService } from "./service";

const BYTES_PER_MEGABYTE = 1_000_000;

export function sizeLabel(t: Strings, bytes: number): string {
  const megabytes = Math.round(bytes / BYTES_PER_MEGABYTE);
  return megabytes < 1 ? t.myData.smallSize : t.myData.megabytes(megabytes);
}

function failureMessage(t: Strings, result: PlanResult | MyDataResult): string | null {
  switch (result.status) {
    case "tooMany":
      return t.myData.tooMany(result.max);
    case "tooLarge":
      return t.myData.tooLarge;
    case "noSpace":
      return t.myData.noSpace;
    case "unavailable":
      return t.export.unavailable;
    case "error":
      return t.myData.failed;
    default:
      return null;
  }
}

function confirm(t: Strings, plan: MyDataPlan): Promise<boolean> {
  return new Promise((resolve) => {
    Alert.alert(
      t.myData.confirmTitle,
      t.myData.confirmBody(plan.pages.length, sizeLabel(t, plan.estimate)),
      [
        { text: t.common.cancel, style: "cancel", onPress: () => resolve(false) },
        { text: t.myData.confirm, onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    );
  });
}

export function useMyDataExport(): () => void {
  const t = useStrings();
  const auth = useAuth();
  const allowance = useAllowance().data ?? null;
  const identity = auth.status === "ready" ? { userId: auth.userId, email: auth.email, isAnonymous: auth.isAnonymous } : null;
  const userId = identity?.userId ?? null;
  const email = identity?.email ?? null;
  const isAnonymous = identity?.isAnonymous ?? false;

  return useCallback(() => {
    if (userId === null) {
      return;
    }
    const account = { userId, email, isAnonymous };
    const planning = beginExport();
    if (planning === null) {
      return;
    }
    void (async () => {
      let plan: MyDataPlan;
      try {
        const planned = await myDataService.plan(account, planning);
        if (planned.status !== "ready") {
          const shown = failureMessage(t, planned);
          if (shown !== null) {
            Alert.alert(shown);
          }
          return;
        }
        plan = planned.plan;
      } finally {
        endExport(planning);
      }
      if (!(await confirm(t, plan))) {
        return;
      }
      const writing = beginExport();
      if (writing === null) {
        return;
      }
      try {
        const context = {
          allowance,
          fileName: archiveFileName(t.myData.fileName, new Date()),
          readme: archiveReadme(),
        };
        const result = await myDataService.write(plan, context, writing, (done, total) => reportProgress(writing, done, total));
        const shown = failureMessage(t, result);
        if (shown !== null) {
          Alert.alert(shown);
        }
      } finally {
        endExport(writing);
      }
    })();
  }, [t, userId, email, isAnonymous, allowance]);
}

