# Backend simples (TXT)

Este backend salva os resultados dos alunos em `backend/data/results.txt`.

## Rodar

1. Entre na pasta `backend`
2. Instale dependencias: `npm install`
3. Inicie: `npm run dev`

A API roda em `http://localhost:3001`.

## Rotas

- `GET /api/health`
- `GET /api/results`
- `POST /api/results`
- `DELETE /api/results`

## Formato do POST

```json
{
  "timestamp": "2026-04-24T20:00:00.000Z",
  "student": "Joao",
  "level": "Inicial",
  "phase": 1,
  "score": 16,
  "totalQuestions": 20,
  "percent": 80
}
```
## Conversao de PDF para MusicXML

A rota `POST /api/score-reader/convert-pdf` usa o Audiveris para ler PDF de
partitura e exportar MusicXML.

Para rodar sem instalar Audiveris no Windows, use o container a partir da raiz
do projeto:

```bash
npm run start:api:docker
```

Depois rode o app Angular normalmente:

```bash
npm start
```

O app vai enviar o PDF para `http://localhost:3001`, receber o MusicXML e tocar
as notas reconhecidas.

PDFs escaneados, inclinados, com baixa resolucao ou manuscritos podem precisar
de correcao manual no MusicXML gerado.
