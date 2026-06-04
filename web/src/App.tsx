import { UploadSection } from '@/components/UploadSection';
import { RecordsTable } from '@/components/RecordsTable';
import { useRecords } from '@/hooks/useRecords';
import { useUploadCsv } from '@/hooks/useUploadCsv';
import { useEffect, useRef } from 'react';

function App() {
  const upload = useUploadCsv();
  const { data, isLoading, isFetching, isError, error, refetch } = useRecords({
    polling: upload.polling,
  });

  const completePollingRef = useRef(upload.completePolling);
  completePollingRef.current = upload.completePolling;

  // Encerra polling antes dos 30s se novos registros aparecerem na tabela
  useEffect(() => {
    if (!upload.polling || data === undefined) return;
    if (data.count > upload.baselineCount) {
      completePollingRef.current();
    }
  }, [upload.polling, upload.baselineCount, data?.count, data]);

  return (
    <div className="mx-auto min-h-svh max-w-5xl px-4 py-8">
      <header className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">Pipeline CSV — Estudo AWS</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Upload, processamento assíncrono (S3 → SNS → Lambda → DynamoDB) e listagem em tempo real.
        </p>
      </header>

      <div className="flex flex-col gap-6">
        <UploadSection upload={upload} />
        <RecordsTable
          items={data?.items ?? []}
          count={data?.count ?? 0}
          isLoading={isLoading}
          isFetching={isFetching}
          isError={isError}
          error={error}
          onRefresh={() => refetch()}
          polling={upload.polling}
        />
      </div>
    </div>
  );
}

export default App;
