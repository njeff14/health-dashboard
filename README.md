# Health Dashboard

A personal health analytics platform that unifies data from your Oura Ring and Garmin watch into a single local dashboard — with AI-powered insights, correlation analysis, and custom metrics like Body Battery and estimated VO2max.

Built by [Corevia Technology](https://github.com/njeff14).

---

## Features

- **Overview** — Daily readiness, estimated VO2max, body battery, sleep score, HRV, and resting HR with 14-day rolling averages and trend indicators. AI insight buttons powered by Claude.
- **Correlation Explorer** — Plot any metric against any other (sleep stages, workout data, daily health, tags) and measure Pearson correlation. Supports workout → next-night sleep pairing and lifestyle tag analysis.
- **Tag Impact Analysis** — Select an Oura lifestyle tag and/or a workout type to see how they affect sleep, HRV, readiness, body battery, and sleep stages in the days before and after.
- **Readiness & Training Load** — Training load breakdown (ATL decay), body battery component chart, and workout category distribution over the last 30 days.
- **AI Health Chat** — Floating chat assistant with full access to your recent health data. Ask broad questions or get specific recommendations.
- **Estimated VO2max** — Extends Garmin's running-only VO2max estimates to all workout types using HR-based regression.
- **Custom Body Battery** — Composite metric combining Oura readiness (50%), training freshness (30%), and stress/recovery balance (20%).

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 14 (App Router) |
| Database | SQLite via `better-sqlite3` |
| Charts | Recharts |
| Styling | Tailwind CSS + shadcn/ui |
| Health data | Oura API v2, Garmin Connect |
| AI insights | Anthropic Claude (claude-sonnet) |

---

## Prerequisites

- Node.js 18+
- [Oura Ring](https://ouraring.com) with a personal access token
- [Garmin Connect](https://connect.garmin.com) account credentials
- [Anthropic API key](https://console.anthropic.com) (for AI insights — optional)

---

## Setup

### 1. Clone and install

```bash
git clone https://github.com/njeff14/health-dashboard.git
cd health-dashboard
npm install
```

### 2. Configure environment variables

```bash
cp .env.local.example .env.local
```

Edit `.env.local` and fill in your credentials:

| Variable | Description |
|----------|-------------|
| `OURA_PERSONAL_ACCESS_TOKEN` | From [cloud.ouraring.com/personal-access-tokens](https://cloud.ouraring.com/personal-access-tokens) |
| `GARMIN_USERNAME` | Your Garmin Connect email address |
| `GARMIN_PASSWORD` | Your Garmin Connect password |
| `HEALTH_ANTHROPIC_API_KEY` | From [console.anthropic.com](https://console.anthropic.com) — required for AI features |

> **Note:** The key is named `HEALTH_ANTHROPIC_API_KEY` (not `ANTHROPIC_API_KEY`) to avoid conflicts with Claude Code's own environment variable.

### 3. Run the development server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### 4. Sync your data

Navigate to **Settings** and use the sync controls to pull your Oura and Garmin data. Start with a 90-day initial sync.

---

## Data & Privacy

All data is stored locally in a SQLite database (`data/health.db`). Nothing is sent to any external server except:
- Oura and Garmin APIs (to fetch your own data)
- Anthropic's API (only when you use AI insight features, sending anonymized health summaries)

The database file is excluded from git via `.gitignore`.

---

## License

MIT License — © 2026 Corevia Technology. See [LICENSE](./LICENSE) for details.
