# Workspace

## Overview

pnpm workspace monorepo using TypeScript. Each package manages its own dependencies.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/api-server run dev` — run API server locally

See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.

## Artifacts

### Pacific Systems Call Logger (`artifacts/call-logger`)

- **Type**: data-visualization (React + Vite)
- **Preview path**: `/`
- **Purpose**: Hotline call data dashboard with import, deduplication, visualization, and export

**Features**:
- Multi-format import: Standard CSV, MicroSIP CSV, MicroSIP INI, MicroSIP XML, Callcentric CSV
- Drag-and-drop + file picker + paste import
- Preview before confirm (shows first 5 rows)
- Deduplication with stable composite keys (phone|name|datetime|duration|status)
- `localStorage` master database — persists across sessions
- Manual call entry form with duplicate detection
- Status filters: All, Answered, Call Ended, Missed, Canceled, Voicemail, Outgoing, Repeat Callers
- Follow-up targets table with reason tracking
- Export: Master CSV + Daily Summary TXT
- 8 metric cards, 6 charts (Recharts)

**Key files**:
- `src/lib/types.ts` — CallStatus, CallSource, StoredCall, ImportResult
- `src/lib/parsers.ts` — all format parsers + dedup key generation
- `src/lib/callDate.ts` — `getCallDate`, `getHourKey`, `getDateKey`, `repairTimestamps` — all guarded by `isPlausible()` (year >= 2001)
- `src/lib/storage.ts` — localStorage CRUD + merge import; `DATA_SCHEMA_VERSION=3` with purge of unresolvable timestamps
- `src/lib/report.ts` — daily summary TXT and master CSV generation
- `src/lib/utils.ts` — maskPhone, formatDuration, cn
- `src/data/sampleData.ts` — sample StoredCall[]
- `src/pages/Dashboard.tsx` — main single-page dashboard

**Timestamp fix (v3 schema)**:
- Root cause was `new Date("0")` = year 2000 epoch which falsely placed all calls at "12AM" in charts
- Fix 1 (`callDate.ts`): `isPlausible(d)` guard requires year >= 2001 everywhere; `tryUnixOrString` rejects bare integer strings and small numbers
- Fix 2 (`parsers.ts`): unix timestamp threshold raised to `>= 1_000_000_000`; rows with invalid timestamps are skipped (not silently epoch-stamped)
- Fix 3 (`storage.ts`): Schema v3 repair now purges stored calls where `getCallDate(c) === null` (broken pre-fix artifacts)
