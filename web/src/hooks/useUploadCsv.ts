import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { uploadCsv } from '@/lib/api';
import { RECORDS_QUERY_KEY } from '@/lib/query-client';
import type { RecordsResponse } from '@/types/record';

const POLLING_DURATION_MS = 30_000;

export function useUploadCsv() {
  const queryClient = useQueryClient();
  const [polling, setPolling] = useState(false);
  const [baselineCount, setBaselineCount] = useState(0);
  const pollingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const mutation = useMutation({
    mutationFn: uploadCsv,
  });

  const stopPollingTimer = useCallback(() => {
    if (pollingTimeoutRef.current) {
      clearTimeout(pollingTimeoutRef.current);
      pollingTimeoutRef.current = null;
    }
  }, []);

  /** Encerra polling, limpa alerta de sucesso e cancela o timer de 30s */
  const completePolling = useCallback(() => {
    setPolling(false);
    stopPollingTimer();
    mutation.reset();
  }, [mutation, stopPollingTimer]);

  const startPolling = useCallback(() => {
    stopPollingTimer();
    const cached = queryClient.getQueryData<RecordsResponse>(RECORDS_QUERY_KEY);
    setBaselineCount(cached?.count ?? 0);
    setPolling(true);
    queryClient.invalidateQueries({ queryKey: RECORDS_QUERY_KEY });
    pollingTimeoutRef.current = setTimeout(completePolling, POLLING_DURATION_MS);
  }, [queryClient, stopPollingTimer, completePolling]);

  useEffect(() => () => stopPollingTimer(), [stopPollingTimer]);

  const mutateWithPolling = useCallback(
    (variables: File, options?: Parameters<typeof mutation.mutate>[1]) => {
      const { onSuccess, ...rest } = options ?? {};
      mutation.mutate(variables, {
        ...rest,
        onSuccess: (data, vars, onMutateResult, context) => {
          startPolling();
          onSuccess?.(data, vars, onMutateResult, context);
        },
      });
    },
    [mutation, startPolling],
  );

  return {
    ...mutation,
    mutate: mutateWithPolling,
    polling,
    baselineCount,
    completePolling,
  };
}
