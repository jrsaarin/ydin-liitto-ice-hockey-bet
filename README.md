# Ydin liitto Cup

A small bookkeeping app for a hockey bet between seven friends.

## The bet

1. Seven players draft four NHL teams each. The draft order is drawn at random and the picks run as a snake: 1 to 7, then 7 to 1, and so on.
2. Carolina starts the season holding the cup.
3. Every game the cup holder plays is a cup game. The player who owns the winning team gets one point. Overtime and shootout results count.
4. When a drafted team beats the cup holder, the cup moves to that team.
5. The four undrafted teams cannot take the cup. If one of them beats the holder, the cup stays and nobody gets a point.
6. The bet covers the regular season only. Most points on the last day wins. Equal points share the win.

## How it works

The app has two phases.

- **Draft.** Everyone opens the page, enters the shared password and chooses their own name. Only the player whose turn it is can pick. Everyone else sees the picks appear within a few seconds.
- **Season.** Once all 28 picks are made the page turns into a read-only scoreboard: standings, the current cup holder, the next cup game, past cup games and every player's teams.

Identity inside the group runs on trust: the password lets you in, and you are expected to choose your own name.

During the draft every player can set a profile picture at the bottom of the page. It is cropped to a square, shrunk in the browser and shown next to the player's name, most visibly in the standings. Pictures survive a league reset.

## Email notifications

During the draft every player can turn on emails at the bottom of the page. A subscribed player gets one email for every pick made by someone else, and a "Your turn to pick" email when they are up next. Addresses are stored on the server and never shown to anyone, including the other players.

The emails are sent from a Gmail account over SMTP. To switch the feature on:

1. Turn on 2-Step Verification for the Gmail account.
2. Create an app password at https://myaccount.google.com/apppasswords.
3. Store the address and the app password as secrets:

```sh
npx wrangler secret put SMTP_USER       # the Gmail address
npx wrangler secret put SMTP_PASSWORD   # the 16-letter app password
```

The commissioner can check the setup with "Send test email" in the "Fix a mistake" panel. The page then shows either a confirmation or the reason the mail server gave.

Without these two secrets the notification card is hidden and no email is sent. If sending fails, the commissioner sees the reason in the "Fix a mistake" panel. A failed email never blocks a pick.

An app password gives full access to the mailbox, so a Gmail account made for this purpose is safer than a personal one.

## Passwords

| Password | Who has it | What it allows |
|---|---|---|
| League password | All players | See the league, draw the draft order, pick for a chosen name |
| Commissioner password | R only | All of the above, plus undoing picks and resetting the league |

Logging in with the commissioner password plays as R automatically. Nobody else can choose R, and only the commissioner can make R's picks.

## Development

Requires Node.js 22 or newer.

```sh
npm install
cp .dev.vars.example .dev.vars   # local passwords are "dev" and "commish"
npm run db:migrate:local         # creates the local database
npm run dev                      # http://localhost:5173
npm test
```

`npm run dev` runs the Vue app and the Worker together, with a local database under `.wrangler/`.

NHL results are fetched by a scheduled job, once a day at 11:00 UTC. Trigger it by hand in development:

```sh
curl "http://localhost:5173/cdn-cgi/handler/scheduled"
```

## Deployment

Everything runs on the free plan of Cloudflare Workers. No credit card is needed.

The production database `cup-bet` already exists and its id is in `wrangler.jsonc`. Deploying takes three commands:

```sh
npx wrangler login                        # only if `npx wrangler whoami` says you are logged out
npm run deploy
npx wrangler secret put LEAGUE_PASSCODE    # the password you share with the group
npx wrangler secret put COMMISH_PASSCODE   # the commissioner's own password
```

Until the league password is set, the page loads but every login is refused. Without a commissioner password nobody can undo picks or reset the league. The two passwords must differ.

When a change adds a file under `migrations/`, run `npm run db:migrate:remote` before `npm run deploy`.

Setting up from scratch on another Cloudflare account needs two more steps before the deploy: run `npx wrangler d1 create cup-bet`, put the printed `database_id` into `wrangler.jsonc`, then run `npm run db:migrate:remote`.

Wrangler prints the public address, which looks like `https://ydin-liitto-cup.<your-account>.workers.dev`.

## Fixing things

The commissioner sees a "Fix a mistake" panel at the bottom of the page, in both phases. It can undo the last pick, reset the league and fetch NHL results right away.

## A new season

Edit `worker/config.js`: the season id, its first and last day, the starting cup holder, the player names and the commissioner. Deploy, then reset the league.
