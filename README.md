## Naucto dummy admin console

A copy of the admin console with nothing real behind it: its own backend, its own database and its
own bucket, filled with made-up people, games, reports and moderation history so that every page
of the console has something to show. It is built by Willy from this repository's submodules,
which track `main` of the [Backend](https://github.com/Naucto/Backend) and the
[Admin-Panel](https://github.com/Naucto/Admin-Panel), the way
[Production-Environment](https://github.com/Naucto/Production-Environment) builds beta.naucto.net.

There is no frontend in this stack. Every link the console draws to the site (a game, a profile, a
staff preview) leads to `https://beta.naucto.net`, where the ids are those of the real site and
not of the dummy data.

### Services

| Service   | What it is                                                                                         |
| --------- | -------------------------------------------------------------------------------------------------- |
| `admin`   | The console, from `./admin`. nginx serves it and forwards `/api` to the backend.                   |
| `backend` | The API, from `./backend` (`prod` target), unchanged.                                              |
| `seed`    | Applies the migrations, then fills the database and the bucket, then exits. From `seed/Dockerfile`. |
| `db`      | Postgres 18.                                                                                       |
| `storage` | MinIO: game documents, covers and bug screenshots.                                                 |

### Deploying on Willy

One domain is enough: `<the dummy console's domain> → admin:80`. The backend and the storage stay
on the private network.

Each service's environment is written out in `docker-compose.yml`. None of it is secret: it names
services of this stack and passwords that only ever guard fake data. If Willy wants the values
entered per service, they are:

- **db**: `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`.
- **storage**: `MINIO_ROOT_USER`, `MINIO_ROOT_PASSWORD`.
- **seed**: `DATABASE_URL`, the five `S3_*`, `EDGE_ENDPOINT`, `SEED_MODE`, `SEED_PASSWORD`, and
  optionally `USERNAME` and `PASSWORD` (see below).
- **backend**: `NODE_ENV`, `DATABASE_URL`, `FRONTEND_URL`, the five `S3_*`, `EDGE_ENDPOINT`.
- **admin**: `NAUCTO_API_URL`.

Worth setting differently on a deployment people can reach:

- `SEED_PASSWORD` on **seed**. It is the password of every seeded account, the staff ones
  included, and the default is printed below.
- `JWT_SECRET` on **backend**, to keep sessions across a restart. Left out, the backend draws a
  random one each time it starts, and a restart signs everyone out.

### Signing in

Every account has the password in `SEED_PASSWORD` (`Naucto!dummy1` unless changed).

| Account                       | Role      | Sees                                             |
| ----------------------------- | --------- | ------------------------------------------------ |
| `admin@naucto-dummy.test`     | Admin     | Everything, and may change everything            |
| `moderator@naucto-dummy.test` | Moderator | The moderation screens only                      |
| `camille@naucto-dummy.test`   | Moderator | The same, as a second name in the log            |
| `viewer@naucto-dummy.test`    | Viewer    | Every screen, with none of the controls to write |

#### An admin account of your own

Set `USERNAME` (an email address) and `PASSWORD` on the **seed** service and the seed also creates
that account as an admin, with that password. It is written again on every seed, so it survives a
reset.

- On Willy, enter both on the `seed` service. They are in no file of this repository, which is
  public.
- On a laptop, copy `.env.example` to `.env` and fill it in. `docker-compose.local.yml` hands that
  file to the seed. `.env` is ignored by git.

### What the seed writes

| Console pages                                                   | Data                                                                                                                                                                                                                           |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Overview, Audience, Games, Creators, Timeline, Compare, Explorer, Live | 80 days of usage up to the minute the seed ran, from the backend's own `prisma/seed-dev-analytics.ts`: visitors, sessions, plays, multiplayer rooms, sign-ups and presence, already rolled up                                |
| Posts                                                           | Eleven posts and videos, each with the wave of visitors it brought                                                                                                                                                             |
| Feedback                                                        | 150 ratings over the same 80 days, from players and creators, low scores with their reasons                                                                                                                                    |
| Bugs                                                            | 14 bug reports in every status and every category, half with a screenshot, some with console lines or an engine error, two following a low rating                                                                             |
| Crashes                                                         | 10 crashes from the web app, the engine and the backend, with stacks and occurrences: open, resolved, ignored, and one that came back                                                                                          |
| Queue, case                                                     | Six open cases: a copied game, two comments (one edited since it was reported), two accounts (one of them suspended) and a game with a single report                                                                           |
| Users                                                           | Accounts in every standing: good, warned, suspended until a date, suspended with no end, reinstated, and one erased by staff                                                                                                   |
| All games                                                       | Published games, drafts, a fork, and a game hidden by moderation, each with a cover                                                                                                                                            |
| Comments                                                        | Visible comments and replies, one hidden, one deleted by staff, one hidden then restored                                                                                                                                       |
| Log                                                             | Every kind of decision at least once: warnings, suspensions, a reinstatement, hides and restores, deletions, dismissed reports, role changes, a profile edit and a draft opened by staff                                       |
| Staff                                                           | The four staff accounts above                                                                                                                                                                                                  |

Every game has a real game document in the bucket (its save, and its release when it is published),
built by the Frontend's `tools/seed-content.ts` and kept in `seed/fixtures/games`. So a decision
taken in the console works as it does in production: hiding a game moves its release and cover out
of reach, restoring puts them back, and a frontend pointed at this backend would open and play
each game.

Dates are counted back from the moment the seed runs, so a fresh deployment always has activity up
to today. The data does not move afterwards: redeploy to bring it up to date.

### Reset on every deployment

With `SEED_MODE=reset` (the default) the seed wipes the database and the bucket and fills them
again every time the stack starts, so whatever was hidden, suspended or resolved while showing the
console is undone by a redeploy. `SEED_MODE=once` seeds an empty database and leaves a seeded one
alone.

The seed only wipes what it filled. It refuses to run against a database holding accounts without
its own `admin@naucto-dummy.test`, and against a bucket holding objects without its
`.naucto-dummy` marker, so pointing it at real data by mistake stops it before it deletes anything.

### Running it locally

```sh
git clone --recurse-submodules https://github.com/Naucto/ATP-Dummy-Admin-Panel.git
cd ATP-Dummy-Admin-Panel
docker compose -f docker-compose.yml -f docker-compose.local.yml up --build
```

The console is then on <http://localhost:3002>. The first start takes a few minutes: three images
to build, then about a minute of seeding.

### Updating

```sh
git submodule update --remote
```

moves both submodules to the head of their `main`. The seed imports a few things from the backend
(`seedAnalytics`, the bucket's key layout, the content size and the crash grouping), so that it
writes what the backend would. If one of them is renamed there, the seed stops at start with the
import that no longer resolves, and the backend does not start on a half-seeded database.

To refresh the game documents after the engine's format changes, in the Frontend:

```sh
node tools/run-ts.mjs tools/seed-content.ts --content-only <this repo>/seed/fixtures/games/snake-8-bit.bin 'Snake 8-bit'
```

and likewise for `Moon Lander`, `Ferry Click`, `Duel`, `Your First Game` and `Platformer Tutorial`.
