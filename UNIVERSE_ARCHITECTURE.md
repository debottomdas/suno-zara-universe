# Suno Zara Universe

Suno Zara Universe is a separate application forked from the existing Suno Zara Studio codebase. The existing deployed Studio is intentionally not modified by this project.

## Product structure

- `/` — Universe home and module launcher
- `/music` — Music Studio (the existing song creation / media / social / publishing workflow)
- `/script` — Script Studio foundation
- `/podcast` — Podcast Studio foundation

## Architectural rule

Each creative world owns its domain workflow. Shared platform services should gradually move into reusable modules rather than being copied between worlds.

### Creative domains

1. Music
   - lyrics / import
   - style generation
   - Suno handoff
   - artwork and clips
   - full video + shorts
   - social metadata
   - publishing
   - analytics

2. Script
   - idea / logline
   - synopsis / story world
   - beats / scene plan
   - screenplay
   - critique / rewrite
   - pitch and promotional assets

3. Podcast
   - series and episode planning
   - research
   - episode script
   - audio / chapter metadata
   - clips and social assets
   - publishing / analytics

### Shared services (target architecture)

- identity and authentication
- project / asset library
- prompt and brand profiles
- image and video generation
- local render worker
- social publishing connectors
- scheduling
- analytics ingestion
- notifications and job status

## Migration principle

The current Music Studio continues to work as copied code under `/music`. Refactoring into shared services should happen incrementally after parity is verified. This avoids destabilising the existing music workflow while Universe expands.
