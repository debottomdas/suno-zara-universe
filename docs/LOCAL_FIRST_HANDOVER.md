# Suno Zara Universe — Implementation handover

Repository: `debottomdas/suno-zara-universe`
Branch: `feature/local-first-no-signin-audit`
Draft PR: https://github.com/debottomdas/suno-zara-universe/pull/7
Last feature commit before these documents: `f99eefea2c9a043efa847fb42a3942b2845f4482`.

## Architecture
Mac startup: `npm run universe`, Next.js `http://localhost:3000`, local worker `http://127.0.0.1:47123`. Local data `~/Suno Zara Universe/`; workspace `~/Suno Zara Universe/local-state/workspace.json`.

## Completed
#3 implemented local-first P0–P2 through `e6a405c` with build and stub-provider tests reported passed. The new bulk image upload UI in `components/creative/CreativeStudio.tsx` was committed at `f99eefea`; this specific commit has not been built or tested yet.

## Critical remaining work
1. Flexible Shorts count: remove hard-coded six from `components/creative/CreativeStudio.tsx`, `components/universe-next/MusicNext.tsx`, `components/LocalReleasePublisher.tsx`, creative model/plan/worker, social copy and campaign validation. Default six, support 1–10; migrate existing six-slot projects safely.
2. Selected-only publishing: approval and scheduling must be per selected Short, including a single Short, without duplicate uploads. Respect existing receipts.
3. P3 and P4 production integration, targeted verification and final Mac acceptance test.
4. Check bulk image upload UX and TypeScript build; import uses fresh workspace revision for each image and does not auto-approve.

## Safety
Do not merge or deploy. Do not modify Studio Global or preserved baseline. Do not upload to external platforms without user approval. Live OpenAI and OAuth integration have not been verified. Continue implementation before broad regression testing.

## Suggested focused checks
Run TypeScript/production build, image import against isolated local workspace, variable Shorts render test (1, 3, 6, 10), and selected-only publishing dry run with fake provider. Never send real external publishing requests in automated tests.
