# AF Braga — Leis, flashcards e exame

Aplicação web (JavaScript simples, sem build) para estudar as Leis do Jogo e as Normas da AF Braga: sessão diária, flashcards com repetição espaçada, simulação de exame, leitor das leis e wiki.

## Separadores

| Rota | Separador |
|------|-----------|
| `#/hoje` | **Hoje** — 10 perguntas por dia, série e mapa das leis 1–17 |
| `#/flashcards` | **Flashcards** — repetição espaçada |
| `#/exame` | **Exame** — cotação oficial: certa **+5**, em branco **0**, errada **−2** |
| `#/leis`, `#/leis/<id>`, `#/leis/page/<slug>` | **Leis** — pesquisa, índice e leitor |
| `#/testes` | **Testes** — testes escritos oficiais, em flashcards ou exame, com filtro por lei |
| `#/alteracoes`, `#/alteracoes/<lei>` | **Alterações** — alterações 2026/27, lei a lei |
| `#/circulares`, `#/circulares/<id>` | **Circulares** — comunicados e esclarecimentos |
| `#/wiki`, `#/wiki/<slug>` | **Wiki** — conceitos, fontes e marcadores |

No telemóvel a barra fica em baixo; no ecrã largo, em cima. A rota inicial é `#/hoje`.

## Site online

**https://dong-xuyong.github.io/afbraga-flashcards/**

Repo público: https://github.com/Dong-Xuyong/afbraga-flashcards

No telemóvel: abre o link no browser; no iPhone podes usar Partilhar → Adicionar ao Ecrã Principal.

## Dados

| Ficheiro | Conteúdo |
|----------|----------|
| `data/index.json` | Baralhos (`kind`: `exam`, `scenario`, `changes`) |
| `data/c5-versao-a.json` | C5 Versão A |
| `data/c6-versao-a.json` | C6 Versão A |
| `data/cf.json` | CF |
| `data/laws.json` | Blocos das leis e normas (gerado) |
| `data/wiki.json` | Páginas da wiki em HTML (gerado) |
| `data/cenarios.json` | Cenários, se existirem na wiki |
| `data/alteracoes-2627.json` | Cartas das alterações 26/27, se existirem |
| `data/alteracoes-leis-2627.json` | Texto das alterações 2026/27, por lei |
| `data/quiz-escritos.json` | Testes escritos com resposta oficial |
| `data/circulares.md` | CO 66, 67, 68 e 70 |
| `data/esclarecimentos.md` | Minuto do lesionado, bolas oficiais e substituições |

Os PDF ficam em `pdfs/` e abrem em `pdfs/<ficheiro>#page=N`.

Progresso no browser (`localStorage`):

- `afbraga-srs-<deckId>` — repetição espaçada de cada baralho
- `afbraga-daily` — perguntas e respostas do dia (`date`, `ids`, `answers`)
- `afbraga-stats` — acertos por lei e série (`byLaw`, `streak`)
- `afbraga-notes` — marcadores e notas por bloco

## Como abrir localmente

O browser bloqueia `fetch()` em `file://`. Usa um servidor local:

```bash
cd "docs/afbraga-flashcards"
python -m http.server 8080
```

Abre **http://localhost:8080**.

## Reconstruir e sincronizar

Na raiz do repositório Second Brain:

```bash
python scripts/build_referee_data.py
python scripts/sync_afbraga_flashcards.py --dry-run
python scripts/sync_afbraga_flashcards.py
```

`build_referee_data.py` lê `referee-wiki/wiki` e escreve `docs/afbraga-flashcards/data`. O sync corre o build, copia a app para `Dong-Xuyong/afbraga-flashcards` e faz push. `--dry-run` mostra o diff e não faz commit nem push.

Testes da lógica (sem browser):

```bash
node scripts/test_afbraga_core.js
```

## Estrutura

```
docs/afbraga-flashcards/
├── index.html
├── styles.css
├── core.js
├── app.js
├── README.md
├── dong-ui/
├── pdfs/
└── data/
```
