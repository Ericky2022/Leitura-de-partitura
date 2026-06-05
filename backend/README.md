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
