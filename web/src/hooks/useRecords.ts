import { useQuery } from '@tanstack/react-query';
import { fetchRecords } from '@/lib/api';
import { RECORDS_QUERY_KEY } from '@/lib/query-client';

interface UseRecordsOptions {
  /** Ativa polling a cada 2s (ex.: após upload enquanto Lambda processa) */
  polling?: boolean;
}

export function useRecords({ polling = false }: UseRecordsOptions = {}) {
  return useQuery({
    queryKey: RECORDS_QUERY_KEY,
    queryFn: () => fetchRecords(),
    refetchInterval: polling ? 2000 : false,
  });
}
