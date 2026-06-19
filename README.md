# Social Touch Games

Suite de minigames cooperativos multitouch da Real Games Studio. Roda em celular, tablet e
mesa touch — jogadores compartilham a mesma tela e se movimentam fisicamente ao redor do device.

**Filosofia:** a tela é apenas o catalisador; o gameplay acontece entre os corpos.

## Stack

- Vite + React 19 + TypeScript
- Canvas 2D puro (sem PixiJS — bundle leve para mobile)
- Web Audio API (síntese de bateria no Pulso)
- Pointer Events API (multitouch unificado, ~10 pontos simultâneos confiáveis)
- HTTPS dev via `@vitejs/plugin-basic-ssl` (necessário para multitouch em iOS/Android modernos)

## Como rodar localmente

```bash
npm install
npm run dev
```

Servidor sobe em `https://localhost:5174` e na rede local. No celular, aceite o aviso de
certificado auto-assinado e teste à vontade.

## Jogos atuais

| Jogo | Mecânica core | Players |
|---|---|---|
| Não Cruzem os Raios | Untangle puzzle com 2 dedos/jogador, níveis com obstáculos | 2–6 |
| Vazamento | Tampar buracos que renascem em outro lugar | 2–6 |
| Pulso | Bateria coletiva sincronizada | 2–6 |
| Constelação | Memória espacial coletiva | 3–6 |
| Bomba Instável | Conter a bomba juntos sem deixar fugir | 2–6 |
| Dança Orbital | Seguir pontos guia em órbitas concêntricas | 2–6 |
| Engrenagens | Girar no sentido certo + velocidade certa, alternados | 2–6 |
| Fantasma | Labirinto às cegas, outros guiam por voz | 2–6 |
| Corrente | Cadeia humana entre dois pólos elétricos | 3–6 |
| Labirinto Rotacional | Defender bola com dedos enquanto arena gira | 2–6 |
| Follow the Line | Seguir curvas Bezier sem colidir com outros dedos | 2–6 |

## Arquitetura

```
src/
├── core/
│   ├── TouchManager.ts    multitouch com grace period 180ms
│   ├── SessionManager.ts  estado de sessão (idle/playing/gameover)
│   ├── GameModule.ts      interface base que todo jogo implementa
│   └── helpers.ts         check-in compartilhado + utilities de desenho
├── components/
│   ├── Home.tsx           grid de seleção
│   └── GameCanvas.tsx     wrapper com HUD, overlay idle/gameover
└── games/<id>/index.ts    cada jogo é um módulo independente
```

Cada jogo implementa `GameModule { init, update, destroy }`. A maioria começa por uma fase de
**check-in** (toque e segure 10s para entrar) compartilhada via `helpers.updateCheckin()`.

## Deploy

Hospedado no Vercel. Faz parte do painel do **Realy** (launcher kiosk da Real Games Studio).
