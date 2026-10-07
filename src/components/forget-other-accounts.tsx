import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

import { useAuth } from "@/auth/auth-provider";
import { forgetOtherAccounts } from "@/lib/query-client";

export function ForgetOtherAccounts() {
  const { userId } = useAuth();
  const queryClient = useQueryClient();

  useEffect(() => {
    forgetOtherAccounts(queryClient, userId);
  }, [queryClient, userId]);

  return null;
}
