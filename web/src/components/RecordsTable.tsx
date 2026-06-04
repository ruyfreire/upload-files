import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import type { CsvRecord } from '@/types/record';
import { Database, Loader2, RefreshCw } from 'lucide-react';

interface RecordsTableProps {
  items: CsvRecord[];
  count: number;
  isLoading: boolean;
  isFetching: boolean;
  isError: boolean;
  error: Error | null;
  onRefresh: () => void;
  polling?: boolean;
}

function formatDate(iso: string) {
  try {
    return new Date(iso).toLocaleString('pt-BR');
  } catch {
    return iso;
  }
}

export function RecordsTable({
  items,
  count,
  isLoading,
  isFetching,
  isError,
  error,
  onRefresh,
  polling = false,
}: RecordsTableProps) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
        <div className="space-y-1">
          <CardTitle className="flex items-center gap-2">
            <Database className="size-5" />
            Registros no DynamoDB
          </CardTitle>
          <CardDescription>Linhas extraídas dos CSVs processados pela Lambda.</CardDescription>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="secondary">{count} registro(s)</Badge>
          {polling && (
            <Badge variant="outline" className="gap-1">
              <Loader2 className="size-3 animate-spin" />
              Atualizando...
            </Badge>
          )}
          <Button variant="outline" size="sm" onClick={onRefresh} disabled={isFetching}>
            <RefreshCw className={isFetching ? 'animate-spin' : ''} />
            Atualizar
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {isError && (
          <Alert variant="destructive" className="mb-4">
            <AlertTitle>Erro ao carregar registros</AlertTitle>
            <AlertDescription>{error?.message}</AlertDescription>
          </Alert>
        )}

        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <p className="text-muted-foreground py-8 text-center text-sm">
            Nenhum registro encontrado. Faça um upload acima para popular a tabela.
          </p>
        ) : (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nome</TableHead>
                  <TableHead>Data</TableHead>
                  <TableHead>Valor</TableHead>
                  <TableHead>Arquivo origem</TableHead>
                  <TableHead>Upload em</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((record) => (
                  <TableRow key={record.id}>
                    <TableCell className="font-medium">{record.nome}</TableCell>
                    <TableCell>{record.data}</TableCell>
                    <TableCell>{record.valor}</TableCell>
                    <TableCell className="max-w-[180px] truncate text-xs text-muted-foreground">
                      {record.sourceKey}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {formatDate(record.uploadedAt)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        {isFetching && !isLoading && !polling && (
          <p className="text-muted-foreground mt-2 flex items-center gap-1 text-xs">
            <Loader2 className="size-3 animate-spin" />
            Atualizando...
          </p>
        )}
      </CardContent>
    </Card>
  );
}
