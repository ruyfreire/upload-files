export interface CsvRecord {
  id: string;
  nome: string;
  data: string;
  valor: string;
  sourceKey: string;
  uploadedAt: string;
}

export interface RecordsResponse {
  items: CsvRecord[];
  count: number;
}

export interface UploadResponse {
  s3Key: string;
  messageId: string;
}
