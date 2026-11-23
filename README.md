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
| `GET /api/hunt` | Bonus hunt ao vivo, arquivo de hunts e palpites — ver `api/hunt.js` |
| `POST /api/hunt` | Palpites do Guess the Balance (sessão Twitch) e sync do servidor das overlays (streamer) |

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

## FS Manager (jogo de manager de futebol)

`/api/manager?acao=...` — a lógica está em `lib/manager/api.js` e o motor em `lib/manager/motor.js`, que tem de ser **igual** ao `manager-motor.js` do site (o teste `test/manager-tests.js` confirma). Chaves no Redis: `fstv:mg:*`.

- Liga da Comunidade (`liga=oficial`): só quem está em `ADMIN_LOGINS` a cria e gere (na própria página do jogo, separador Ligas).
- Ligas privadas: cada pessoa cria até 2 e convida amigos com um código de 6 letras.
- Desafios e ranking usam só a Liga da Comunidade (jogados no servidor).

Testes: `node test/mock-external.js & node test/manager-tests.js`

## App instalável + avisos de live (`/api/push`)

O site é instalável como app (PWA) e quem ativar os avisos recebe uma notificação quando o canal entra em direto na Twitch.

1. Em **https://dev.twitch.tv/console/apps**, abre a app "FabioSilva_TV Website" → **Manage** → **New Secret** e copia o Client Secret.
2. No Vercel (projeto fabiosilvatv-api), cria a variável `TWITCH_CLIENT_SECRET` com esse valor e faz **Redeploy**. Nunca o envies por chat.
3. No site, entra com a conta fabiosilva_tv e abre a **Loja** → painel **Notificações da app** → **Ligar aviso de live**. Ao fim de uns segundos deve aparecer "✅ Ligado".
4. Ativa os avisos no teu telemóvel e usa **Enviar notificação de teste**.

Chaves no Redis: `fstv:push:*` (as chaves VAPID ficam em `fstv:push:vapid` — não mexer). Testes: `node test/mock-external.js & node test/push-tests.js`.

## Bonus hunt ao vivo + Guess the Balance (`/api/hunt`)

O servidor das overlays (no PC do streamer) envia a hunt do bonus tracker
sempre que ela muda. O site mostra-a em `hunt.html`, guarda todas as hunts
no arquivo e recebe os palpites do Guess the Balance (com login da Twitch,
um palpite por pessoa, que pode ser mudado até os palpites fecharem).
O servidor lê os palpites daqui para a overlay, escolhe o vencedor, dá os
pontos e devolve o resultado.

- Quem pode enviar a hunt: o token Twitch da conta em `ADMIN_LOGINS`, ou o
  cabeçalho `X-Hunt-Key` igual à variável `HUNT_SYNC_KEY` (opcional; usa-a se o
  token do servidor for de outra conta, como um bot).
- Chaves no Redis: `fstv:hunt:*` e `fstv:hunts`.
- Testes: `node test/mock-external.js & node test/hunt-tests.js`
