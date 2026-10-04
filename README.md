# Game Night

Real-time multiplayer table games. Built as a PWA with React + Vite on the frontend and a Node.js + Socket.IO game server on the backend.

Enter your name, pick a game, then create a room or join one with a code:

| Game | Players | Bots |
|---|---|---|
| **Property Deal** — inspired by Monopoly Deal | 2–5 | yes |
| **Mah Jong** — American mahjong | 2–4 | yes |
| **Splendor** — gem-trading engine builder | 2–4 | yes |

## Running locally

```bash
npm install
npm run dev
```

This starts both the game server (port 3001) and the Vite dev server (port 5173) concurrently. Open `http://localhost:5173` in your browser.

To run them separately:

```bash
npm run dev:server   # game server on :3001
npm run dev:client   # vite frontend on :5173
```

## Environment variables

Copy `.env.example` to `.env` and adjust as needed.

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3001` | Port the game server listens on |
| `CORS_ORIGINS` | localhost + Vercel URL | Comma-separated list of allowed frontend origins |
| `VITE_SERVER_URL` | `http://localhost:3001` | Backend URL used by the frontend (set at build time) |

## Deploying

The frontend can be deployed to **Vercel** (set `VITE_SERVER_URL` to your backend URL as a build env var).

The backend (`server.js`) needs a persistent Node.js host — **Render**, **Railway**, or **Fly.io** all have free tiers that work. Set `PORT` and `CORS_ORIGINS` as environment variables on the host.

The `Procfile` (`web: node server.js`) is compatible with Heroku-style platforms.

## How to play — Property Deal

- Your name is remembered between visits, so reopening the app drops you
  straight on the game picker — "← Change name" on that screen changes it
- Create a room, share the room code with friends
- The host starts the game once everyone has joined
- Each turn: draw 2 cards, play up to 3 cards, end your turn
- First player to collect **3 complete property sets** wins

**Playing a card.** Drag it out of your hand and drop it where you want it —
the places that will take the card light up as you move, and a label under the
card says what dropping it there would do. Tap a card instead to read what it
does.

The card lands the instant you let go, however far away the server is: the app
plays the move on your screen straight away and squares it with the server as
the answer comes back. Anything the app can't call on its own — what Pass Go
draws you, who pays what — still waits for the server, and your hand sits out
that moment rather than letting you play into an answer that hasn't arrived.

Your hand is fanned rather than scrolled, so every card is within reach without
a swipe that would fight the drag: cards overlap as the hand grows, and you
pick one up by the sliver of it you can see.

| Card | Where you drop it |
|---|---|
| Money, or anything you'd rather bank | your bank pile |
| Property | your board, or straight onto the matching set |
| Wildcard | onto a set, or on open board space to pick a colour |
| Rent | your board — a popup asks which colour to charge, who pays, and whether to double it |
| House / Hotel | the complete set it goes on |
| Pass Go, It's My Birthday | your board |
| Debt Collector | the player who owes you |
| Sly Deal, Force Deal | the opponent's property card you want |
| Deal Breaker | the complete set you're stealing |

**Double the Rent** isn't dragged out on its own: drop a rent card and, as long
as you have two actions left, the rent popup offers a **×2** option that plays
your Double the Rent card alongside it.

**Just Say No** still works as a prompt — when someone plays an action against
you, the banner at the top offers it (and a counter, if they counter back). On a
rent or a birthday it only lets the player who played it off the hook; everyone
else at the table still pays.

The bots play theirs too, and they spend them on what they're worth. A Deal
Breaker on a finished set always gets a no; a $2M birthday they can settle out
of the bank never does. In between they price the action — what the card being
stolen was doing for a set they're building, whether a demand would force them
to sell off the board, whether letting it through hands someone their third set
— and say no when it's worth more than the card. They'll counter your counter,
too, when the prize is big enough.

Everything each player has banked is stacked into a single pile on their board;
the pile's total sits beside that player's name in their board header, where the
stacked cards can't cover it, and tapping a pile shows what's in it. A wildcard already on your board carries a ⇄
badge and can be dragged into another of your sets. If a set fills up underneath
one — you Deal Breaker the matching set off someone else — the wildcard switches
to its other colour on its own; an all-colour wild has no other colour to fall
back on, so you're asked which one it should become.

**A move the table won't allow** — a property on the bank, rent on a colour you
don't own — comes back as a message and changes nothing: the card goes back in
your hand where it was.

**If the deck runs out** and the discard pile has nothing left to reshuffle
into it, the game is called rather than passing the turn round an empty table
for ever. Whoever has the most complete sets takes it, with total value
breaking a tie, and a dead heat is a draw.

**If you drop off** — the phone sleeps, the tunnel eats the signal — the table
waits for you. The bots stop where they are, your seat is held, and picking the
app back up puts you on the same board with the same hand. Your room is kept
for five minutes after the last player leaves it.

## How to play — Mah Jong

**The set** (160 tiles): three suits — green, red and black — with four of each number
1–9; four each of the green, red and black "Soap" dragons; four each of the N/E/S/W
winds; ten flowers; ten jokers; four blanks. Each suit owns a dragon (green suit ↔
green dragon, red ↔ red, black ↔ Soap), which is how the card's colour-coded `D`
groups resolve.

**The deal.** Everyone gets 13 tiles; one player is picked at random for the extra
14th tile and opens the game.

**The Charleston.** Before play, everyone picks 3 tiles to pass. With *n* players
there are *n − 1* passes, each one seat further round the table, so by the end
everyone has passed three tiles to each of the others:

| Players | Passes |
|---|---|
| 2 | A↔B |
| 3 | A→B, B→C, C→A · then A→C, B→A, C→B |
| 4 | A→B, B→C, C→D, D→A · then A→C, B→D, C→A, D→B · then A→D, B→A, C→B, D→C |

Tiles you receive land in your rack before the next pass, so you can keep them or
send them on.

**Play.** The player with 14 tiles discards first, then play goes round. On your
turn you either draw from the wall or take the last discard — but only if it lets
you lay down **three or more tiles** of a group in a win condition. *House rule:*
that group can be either a **set** of the same tile (`999`) or a **run** of
three consecutive numbers in one suit — but only a run a win condition you could
still build *prints* as a run (`123`, `456`, `789`). A win condition that wants
consecutive numbers as sets is asking for `111` or `222`, never `123`, so it
offers no run at all. A tile a win condition only wants as a *pair* or a lone
single can't be claimed.

**Jokers.** A joker stands in for a tile in any **group of three or more**,
provided at least one real tile of that group is there. That covers sets
(`999`, `2222`) and — *house rule* — a run of three consecutive numbers the
card prints as a group: `123`, `456` and `789` in `123 456 789 DDD EE` each
take a real tile plus up to two jokers. A joker never stands in for a **pair**
or a **lone single**, and never for a run the card only prints as pairs (the
`345 678 DD 876 543` palindrome is six pairs, so it takes none).

**The card.** The `🀄 Card` button (where Property Deal has "End Turn") opens the
win-condition card at any time. *House rule:* the hands the card marks `C` are
played like every other hand — a concealed hand can expose here too. Tap hands to mark them; marked hands stay on screen
under your rack with live progress. On the card, colour marks a *suit slot* rather
than a specific suit: same colour means same suit, different colours mean different
suits, so a hand can be built in whichever suits you're actually collecting.

**Blanks.** A blank can be traded for any tile on the discard pile: the blank goes
onto the pile, the tile comes straight into your hand. Play then resumes with the
player *after* whoever used the blank. Because it hands the turn on, a blank can be
spent by any player between turns — while nobody is mid-turn holding a drawn tile
they still have to discard.

**Winning.** The moment your 14 tiles complete a win condition it lights up — on the
card, and in the marked strip under your rack — and a **Mah Jong** button appears.
Declaring reveals every hand and offers the usual rematch. If the wall runs out
first the hand is a draw.

## How to play — Splendor

Race to **15 prestige points** by collecting gems, buying development cards and
attracting nobles. The board is the base game's: 90 development cards in three
levels (the dots on the left of each row), and 10 nobles, of which **5** are in
play at any player count. The bank starts with **7 gems of each colour** (at any player count)
and 5 gold.

**On your turn, do one of four things:**

- **Take gems** — tap gems in the bank at the bottom, then *Take*. Either **three
  different colours**, or **two of one colour** (tap it twice) when that pile still
  holds four or more. If fewer than three colours are left you may take fewer.
- **Reserve a card** — tap a face-up card and choose *Reserve*, or tap a deck to
  reserve its top card blind (only you can see it). You get a **gold** gem if any
  is left. You can hold three reserved cards; they appear under the market.
- **Buy a card** — tap an affordable card (they glow green) and choose *Buy*, from
  the market or from your reserve. Each card you own is a permanent **discount** of
  one gem in its colour. Gold gems stand in for any colour, and are spent
  automatically for whatever you're still short of.
- **Pass** — only offered when you genuinely have no other legal move.

**Ten gems at most.** If a turn leaves you with more than ten, you tap gems in your
own row to pick the extras to return before play moves on.

**Nobles.** The first player whose cards meet a noble's requirements gets it — it
arrives automatically the moment you buy the card that completes it, and is worth 3
points. If that one card completes several nobles, you take all of them.

**Winning.** When a player reaches 15 points the round is finished, so everyone gets
the same number of turns. The highest score wins; a tie goes to the player with
**fewer purchased cards**. Bots (Midas, Croesus and Medici) are available.

## Tech stack

- **Frontend**: React 19, Vite, Tailwind CSS, Socket.IO client
- **Backend**: Node.js, Express 5, Socket.IO
- **Game logic**: pure JS, no framework dependencies
  - Property Deal — `src/game/engine.js`, `src/game/cards.js`
  - Mah Jong — `src/game/mahjong/`: `tiles.js` (the set), `card.js` (the 49 win
    conditions, transcribed from the printed card), `match.js` (expands a card
    hand's suit/number/wind placeholders into concrete tile requirements and
    matches a rack against them), `engine.js` (deal, Charleston, turns, claims,
    blanks, winning), `botAI.js` (the bots)
  - Splendor — `src/game/splendor/`: `cards.js` (the 90 cards and 10 nobles),
    `engine.js` (setup, the four actions, the ten-gem limit, nobles, end of game),
    `botAI.js` (the bots)
