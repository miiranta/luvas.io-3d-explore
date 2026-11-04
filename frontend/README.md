# Explore 3D — as salas do Trabalho 2 de Visão Computacional no navegador

App Angular para explorar em 3D as três salas do Instituto de Computação da Unicamp reconstruídas
a partir de vídeo pelo pipeline do Trabalho 2 de MO446 (repositório `mo-446-visao-computacional`,
pasta `Trabalho 2`): A — Laboratório do Recod, B — Sala 90 e C — Copa do IC.

O pipeline faz o trabalho pesado em Python: escolhe os quadros do vídeo, roda o SfM do COLMAP
(SIFT, emparelhamento exaustivo, ou sequencial com detecção de laço na sala B, e mapeador global),
põe o modelo em metros com o tabuleiro de xadrez impresso, alinha a sala ao chão e às paredes por RANSAC, mede largura, comprimento e a
altura da porta, densifica com o PatchMatch do COLMAP na GPU e gera uma malha de Poisson. Este app
só mostra o resultado: nada é recalculado no navegador.

## Como rodar

```bash
npm install --legacy-peer-deps      # o resolvedor de peers do npm 10 quebra na árvore do vitest
npm start                           # http://localhost:4200
npm run build                       # build de produção em dist/v1/browser
npm test -- --watch=false           # testes unitários (Vitest)
npm run typecheck                   # app e testes
npm run e2e                         # o build de produção no Chrome headless, cena por cena
THUMBS=1 npm run e2e                # idem, e regrava as miniaturas do seletor
npm run scenes                      # reconverte public/scenes/ a partir dos resultados do pipeline
```

`npm run scenes` lê `results/<vídeo>/` do pipeline (padrão: o repositório do trabalho ao lado,
em `../../../Visao-Task2/...`; outro caminho com `T2_RESULTS=...`).

## O que tem em cada cena

- **Malha**: Poisson do Open3D sobre a nuvem do PatchMatch, simplificada para 300 mil triângulos,
  com as cores dos pontos e um sombreamento suave pela normal.
- **Densa**: a nuvem do PatchMatch, depois da limpeza do pipeline (outliers e recorte na caixa da
  sala).
- **Esparsa**: os pontos do SfM.
- **Câmeras e trajeto**: as pirâmides das câmeras registradas (no máximo 90 desenhadas) e o
  caminho percorrido, sem as câmeras que o pipeline marcou como mal registradas.
- **Caixa da sala**: as paredes e o chão achados por RANSAC, com a largura e o comprimento
  medidos no modelo e o valor da trena.
- **Corte**: vista de cima, sem o teto e sem a parede mais próxima — a mesma regra das figuras do
  pipeline —, para enxergar o interior; dentro da sala só o teto é cortado.
- **Caminhada**: a câmera percorre o trajeto da gravação (média móvel circular, como no vídeo de
  navegação do pipeline).
- **Medir**: dois toques no modelo dão a distância em centímetros (o modelo está em metros).
- **Métricas**: câmeras registradas, erro de reprojeção, pontos, escala, deriva do laço,
  dimensões com o erro em relação à trena e ângulos entre paredes.

`?scene=A`, `?scene=B` ou `?scene=C` abre a cena direto.

## Formato dos dados (`public/scenes/`)

`tools/build-scenes.mjs` passa do referencial do pipeline (metros, z para cima, chão em z = 0)
para o do renderizador (y para cima): (x, y, z) → (x, z, −y). Cada camada é um binário com as
posições em 16 bits sobre a caixa da camada (resolução abaixo de 1 mm numa sala) seguidas das
cores RGB8; a malha tem ainda os índices uint32. `scene.json` traz as caixas, as poses (centro e
eixos da câmera), a caixa da sala e as métricas; `index.json` lista as cenas do seletor.

## Testes

Os testes unitários cobrem a decodificação (ida e volta da quantização, arquivos truncados,
índices fora do intervalo), a câmera orbital, o corte, a escolha de pontos e de triângulos, as
pirâmides e o trajeto da caminhada. O `e2e` sobe o build de produção num servidor local e abre o
Chrome headless com WebGL na GPU: abre cada cena pelo seletor, confere que cada camada desenha,
que arrastar e a roda do mouse mudam a vista, que o corte muda o que aparece, que a caixa mostra
as medidas com a trena, que dois toques medem uma distância dentro da sala, que a caminhada anda,
que a folha de métricas bate com o `scene.json`, que `?scene=` e o botão de voltar funcionam, que
o layout de celular não sobrepõe os controles e que não há erros no console. As capturas ficam
em `.e2e-results/`.
