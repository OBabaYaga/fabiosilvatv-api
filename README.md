# fabiosilvatv-api

API da **loja de pontos** e do **ranking semanal dos minijogos** do site [fabiosilvatv.com](https://fabiosilvatv.com) — Vercel (funções Node) + Redis (Upstash).

## Como funcionam os pontos

Cada viewer tem duas carteiras:

1. **Pontos da live (StreamElements)** — os pontos de ver a live. O site **nunca os gasta**, só os lê.
2. **Saldo da loja** — é o que se gasta nos prémios. Ganha os mesmos pontos da live, porque é calculado como `saldo = pontos StreamElements + ajuste`, em que o `ajuste` (no Redis) é a soma das compras, devoluções e ajustes manuais.

## Rotas

| Rota | O quê |
|---|---|
| `GET /api/health` | Confirma que a API está no ar e se o Redis está ligado |
| `GET /api/saldo?username=x` | Pontos da live + saldo da loja de alguém (público) |
| `GET /api/loja` | Prémios visíveis + lista de casinos (público) |
| `POST /api/loja` | Ações com sessão Twitch — ver comentário no topo de `api/loja.js` |
| `GET /api/jogos` | Ranking semanal dos minijogos (público) |
| `POST /api/jogos` | Fichas, bónus diário e jogadas do ranking — ver `api/jogos.js` |

Comprar, ver os próprios pedidos e as ações do streamer exigem `Authorization: Bearer <token Twitch>`. O streamer é quem está em `ADMIN_LOGINS` (por omissão `fabiosilva_tv`).

## Pôr online (Vercel)

1. Em [vercel.com/new](https://vercel.com/new), importa o repositório `OBabaYaga/fabiosilvatv-api` e carrega em **Deploy** (não é preciso mudar nada).
2. No projeto: **Storage → Connect Database** → escolhe a base Upstash/Redis que já usas no `estv-api` (ou cria uma nova grátis). Isto cria sozinho `KV_REST_API_URL` e `KV_REST_API_TOKEN`. Todas as chaves desta API começam por `fstv:`, por isso pode partilhar a base com o ESTV.
3. **Redeploy**.
4. Abre `https://<o-teu-projeto>.vercel.app/api/health` — deve dizer `"redis": true`.
5. Se o endereço do projeto não for `fabiosilvatv-api.vercel.app`, muda `LOJA_API` no topo do `loja.js` do site.

Variáveis opcionais: `ADMIN_LOGINS` (vários separados por vírgulas), `FRONTEND_URL` (por omissão `https://fabiosilvatv.com,https://www.fabiosilvatv.com`), `SE_CHANNEL_ID` (por omissão o do canal fabiosilva_tv).

## Minijogos — ranking

As **fichas dos minijogos não têm nada a ver com a loja**: não se compram, não se trocam por prémios e não mexem no saldo da loja nem nos pontos StreamElements. Servem só para o ranking entre espectadores.

- Na primeira vez cada pessoa recebe **1.000 fichas**. As fichas **acumulam** (não há reset) e o ranking é o total de fichas.
- **Ganham-se fichas a ver a live**: cada ponto novo na StreamElements (o total "desde sempre", que só sobe) dá 1 ficha. A API lê a StreamElements no máximo de 2 em 2 minutos por pessoa. Quem chega a 0 só volta a jogar depois de ver a live.
- No modo Ranking é **o servidor que sorteia** (`lib/og-motor.js`), por isso não dá para fazer batota no browser. No Crash a recolha é sempre a automática.
- `lib/og-motor.js` é uma cópia do `og-motor.js` do site: se mudares um, copia para o outro.
- Variáveis opcionais: `JOGOS_FICHAS_INICIAIS` (1000), `JOGOS_FICHAS_POR_PONTO` (1), `JOGOS_MAX_JOGADAS_DIA` (5000 por pessoa).
- Cada jogada gasta ~7–10 comandos no Redis. O plano grátis do Upstash dá para dezenas de milhares de jogadas por mês; se o ranking pegar muito, vê o consumo no painel do Upstash.

## Usar a loja (streamer)

Entra em fabiosilvatv.com/loja.html com a conta **fabiosilva_tv**: aparece a **Gestão da loja** por baixo dos prémios.

- **Prémios**: muda nome, preço, stock, máximo por pessoa por mês, o que o viewer tem de indicar (nada / casino + ID / email / texto) e se está visível. Os prémios novos começam com **stock 0** — ninguém compra até definires o stock.
- **Pedidos**: cada compra aparece como *Pendente*, com os dados que o viewer indicou. Depois de entregares, carrega em **Entregue**. Se não der, **Recusar e devolver pontos** devolve o saldo, o stock e o limite mensal (o viewer vê a nota que escreveres).
- **Ajustar saldo**: dá ou tira saldo da loja a alguém (não mexe nos pontos StreamElements).
- **Pôr pontos a zero (reset)**: põe o saldo da loja e/ou as fichas dos minijogos de **todos** a zero (escreve RESET para confirmar). O saldo passa a ser `pontos StreamElements − pontos no momento do reset + ajustes`, por isso só conta o que cada um ganhar daí para a frente. Não mexe nos pontos da StreamElements nem nos pedidos já feitos.

## Testes locais

```bash
npm install
node test/mock-external.js          # terminal 1 (Twitch + StreamElements de mentira)
node test/run-tests.js              # terminal 2 (loja)
node test/jogos-tests.js            # terminal 2 (minijogos)
```
