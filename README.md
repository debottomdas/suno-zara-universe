# Suno Zara Universe

A modular creative automation platform for Suno Zara.

The first production module is **Music Studio**, forked from the existing Suno Zara Studio project. The original deployed Studio is not changed by this repository.

## Worlds

- **Music Studio** — `/music`
- **Script Studio** — `/script`
- **Podcast Studio** — `/podcast`

See `UNIVERSE_ARCHITECTURE.md` for the expansion model and shared-service plan.

## Development

```bash
npm install
npm run dev
```

Open `http://localhost:3000` for the Universe dashboard and `http://localhost:3000/music` for Music Studio.

## Important deployment note

Deploy Suno Zara Universe as a **new Vercel project** with its own project name/domain and environment settings. Do not point the existing Suno Zara Studio deployment at this repository if you want the current live Studio to remain unchanged.
