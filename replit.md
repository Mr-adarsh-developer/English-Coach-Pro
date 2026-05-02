# FluencyFlow — Personal English Tutor Platform

## Overview

FluencyFlow is an AI-powered English tutor chat app. Users can type in English or Hindi/Hinglish and receive real-time corrections, translations, and conversation coaching. Features voice input/output, a vocabulary vault, fluency tracking, and session summaries.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **Frontend**: React + Vite (artifacts/fluency-flow) — dark mode, electric blue, Framer Motion
- **API framework**: Express 5 (artifacts/api-server)
- **Database**: PostgreSQL + Drizzle ORM
- **AI**: OpenAI via Replit AI Integrations (gpt-5.4 for chat, no API key needed)
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)

## Key Features

1. **Hybrid Input**: Hindi/Hinglish → auto-translated to English; English → corrected with polished version + explanation
2. **Real-time Streaming**: SSE streaming for AI responses, token by token
3. **Voice Mode**: Web Speech API (STT) + SpeechSynthesis (TTS)
4. **Vocabulary Vault**: Auto-extracted words/idioms from each conversation
5. **Fluency Vibe Score**: 1-10 animated arc gauge, updates per message
6. **Session Summary**: AI-generated mistakes, new words, encouragement — downloadable as PDF
7. **Scenario Roleplay**: General Chat, Job Interview, Ordering Coffee, Startup Pitch

## DB Schema

- `conversations` — id, scenario, fluency_score, created_at
- `messages` — id, conversation_id, role, content, original_input, polished_version, correction, created_at
- `vocabulary_entries` — id, conversation_id, word, type, definition, example_sentence, created_at

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)

## Architecture

- Frontend (`/`) → `artifacts/fluency-flow` (React/Vite on dynamic PORT)
- API (`/api`) → `artifacts/api-server` (Express on port 8080)
- AI routes: `POST /api/conversations/:id/messages` — SSE streaming with GPT-5.4
- OpenAI integration: `@workspace/integrations-openai-ai-server` (Replit AI Integrations proxy)

## Environment Variables

- `AI_INTEGRATIONS_OPENAI_BASE_URL` — set by Replit AI Integrations
- `AI_INTEGRATIONS_OPENAI_API_KEY` — set by Replit AI Integrations
- `DATABASE_URL`, `PGHOST`, etc. — set by Replit PostgreSQL
- `SESSION_SECRET` — session signing secret

See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.
