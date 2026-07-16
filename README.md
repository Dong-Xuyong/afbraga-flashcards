# AF Braga Flashcards

Aplicação web de flashcards estilo Anki para preparação dos exames de árbitro da AF Braga.

## Baralhos

| Ficheiro | Baralho |
|----------|---------|
| `data/c5-versao-a.json` | C5 Versão A |
| `data/c6-versao-a.json` | C6 Versão A |
| `data/cf.json` | CF |

O índice `data/index.json` lista os três baralhos. **Os ficheiros JSON atuais são stubs** com uma carta placeholder cada — serão substituídos pelos dados reais dos exames.

## Como abrir

O browser bloqueia `fetch()` em ficheiros abertos directamente (`file://`). Use um servidor local simples:

### Python (recomendado)

```bash
cd "docs/afbraga-flashcards"
python -m http.server 8080
```

Depois abra: **http://localhost:8080**

### Node.js (npx)

```bash
cd "docs/afbraga-flashcards"
npx serve -p 8080
```

### VS Code / Cursor

Extensão **Live Server** → clicar com o botão direito em `index.html` → *Open with Live Server*.

## Funcionalidades

- **Início** — escolher baralho (C5 Versão A, C6 Versão A, CF) com contagem de cartas e cartas por rever
- **Estudar** — pergunta na frente; clique/toque ou **Espaço** para virar
- **Verso** — resposta correcta destacada; todas as opções listadas
- **Avaliar** — Novamente / Difícil / Bom / Fácil (teclas **1–4**)
- **Repetição espaçada** — fila por baralho guardada em `localStorage`
- **Progresso** — cartas restantes e revistas hoje

## Formato dos dados

```json
{
  "deckId": "c5-versao-a",
  "title": "C5 Versão A",
  "cards": [
    {
      "id": "c5a-001",
      "number": 1,
      "question": "Pergunta...",
      "options": { "A": "...", "B": "...", "C": "...", "D": "..." },
      "answer": "B",
      "answerText": "Texto da resposta correcta"
    }
  ]
}
```

## Estrutura

```
docs/afbraga-flashcards/
├── index.html
├── styles.css
├── app.js
├── README.md
└── data/
    ├── index.json
    ├── c5-versao-a.json
    ├── c6-versao-a.json
    └── cf.json
```
