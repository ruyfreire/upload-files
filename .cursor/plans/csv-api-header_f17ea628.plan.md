---
name: csv-api-header
overview: "Adicionar uma validação simples de CSV no serviço NestJS antes do upload para S3/SNS, reaproveitando a ideia da Lambda: validar apenas o header esperado `nome,data,valor`. A implementação será didática e enxuta, sem testes unitários ou documentação nova conforme sua preferência."
todos: []
isProject: true
phases:
  - name: "Fase 1: Implementação enxuta"
    todos:
      - id: add-csv-parse
        content: Adicionar `csv-parse` como dependência da API, mantendo paridade com a versão usada na Lambda.
        status: pending
      - id: add-header-validation
        content: Implementar validação simples de header CSV em `api/src/upload/upload.service.ts` antes do upload para S3.
        status: pending
  - name: "Fase 2: Validação e revisão"
    todos:
      - id: run-api-checks
        content: Executar validações disponíveis da API, como instalação/build/lint quando aplicável.
        status: pending
      - id: review-changes
        content: Rodar revisão read-only para garantir que a mudança é simples, localizada e sem efeitos colaterais.
        status: pending
---

# Plano: Validação básica de CSV na API NestJS

## Escopo assumido
- Validar o CSV em `api/src/upload/upload.service.ts` antes de enviar para S3.
- Usar o mesmo contrato da Lambda: header exatamente `nome,data,valor`, na mesma ordem.
- Manter a validação simples: sem validar conteúdo das linhas, datas ou valores.
- Retornar erro HTTP `400 Bad Request` se o header estiver inválido ou o CSV não puder ser parseado.
- Adicionar `csv-parse` na API, idealmente na mesma versão usada pela Lambda.

## Arquivos prováveis
- `api/package.json`: adicionar dependência `csv-parse`.
- `api/src/upload/upload.service.ts`: importar parser, criar helpers simples e chamar validação antes do `PutObjectCommand`.
- Lockfile da API, se existir e for atualizado pelo gerenciador de pacotes.

## Estratégia
- Preferir `csv-parse/sync`, porque o arquivo já chega em memória via `Multer` como `file.buffer`.
- Configurar parser com `bom: true`, `trim: true` e `skip_empty_lines: true`.
- Usar `columns: (header) => ...` para normalizar/validar o header, igual ao conceito da Lambda.
- Fazer parse apenas para validação, descartando as linhas depois.

## Validação manual
- Subir/rodar checks disponíveis da API, se houver.
- Testar mentalmente/por comando simples os casos:
  - CSV válido: `nome,data,valor` deve seguir para upload.
  - CSV com header diferente: deve retornar `400` antes de enviar ao S3.
  - CSV vazio ou malformado: deve retornar `400`.