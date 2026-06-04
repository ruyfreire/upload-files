import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import type { useUploadCsv } from '@/hooks/useUploadCsv';
import { CheckCircle2, Loader2, Upload } from 'lucide-react';
import { useRef, useState } from 'react';

type UploadMutation = ReturnType<typeof useUploadCsv>;

interface UploadSectionProps {
  upload: UploadMutation;
}

export function UploadSection({ upload }: UploadSectionProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const { mutate, isPending, isSuccess, isError, error, data, reset } = upload;

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!selectedFile) return;
    reset();
    mutate(selectedFile, {
      onSuccess: () => {
        setSelectedFile(null);
        if (fileInputRef.current) fileInputRef.current.value = '';
      },
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Upload className="size-5" />
          Upload CSV
        </CardTitle>
        <CardDescription>
          Envie um arquivo .csv com colunas nome, data, valor. O processamento é assíncrono via
          Lambda — a tabela abaixo atualiza automaticamente.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4 sm:flex-row sm:items-end">
          <div className="flex-1 space-y-2">
            <Input
              ref={fileInputRef}
              type="file"
              accept=".csv"
              disabled={isPending}
              onChange={(e) => setSelectedFile(e.target.files?.[0] ?? null)}
            />
          </div>
          <Button type="submit" disabled={!selectedFile || isPending}>
            {isPending ? (
              <>
                <Loader2 className="animate-spin" />
                Enviando...
              </>
            ) : (
              'Enviar'
            )}
          </Button>
        </form>

        {isSuccess && data && (
          <Alert className="mt-4 border-green-200 bg-green-50 text-green-900 dark:border-green-900 dark:bg-green-950 dark:text-green-100">
            <CheckCircle2 className="size-4" />
            <AlertTitle>Upload concluído</AlertTitle>
            <AlertDescription>
              Arquivo enviado: <code className="text-xs">{data.s3Key}</code>
              <br />
              Aguardando processamento — a tabela será atualizada em alguns segundos.
            </AlertDescription>
          </Alert>
        )}

        {isError && (
          <Alert variant="destructive" className="mt-4">
            <AlertTitle>Erro no upload</AlertTitle>
            <AlertDescription>{error.message}</AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}
