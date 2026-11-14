# Plan: Spec 030

## API
- `common/row-version.ts`: `versionOf`, `atVersion(base)` (0 also matches a missing field),
  `BUMP` (`$inc`), `staleEdit(current)`, `rowDeleted()`, `assertBase()`.
- Schemas: optional `version` on the five collections. Responses include it when > 0.
- `SessionsService.update/updateExercise/updateSet` and `NutritionService.updateEntry/upsertWeighIn`:
  check, write filtered on the version, and on no match say which way the race went.
- Deletes are idempotent.

## Web
- `offline/conflicts.ts` (pure): which edit an item is, the clash, the field diff, combined text,
  `rebased()`, same-row ordering. Tested in `conflicts.spec.ts`.
- `offline/outbox.ts`: `lastErrorCurrent`, `replace()`.
- Overlays: `baseVersion` in the patch metas; `versionAfter()`.
- `training-offline.ts`, `nutrition-offline.ts`: send `baseVersion`; keep `was` for "add it again".
- `sync-conflicts.ts`: keep mine / keep theirs / save combined / add it again; weigh-in undo.
- `components/sync-status.tsx`: `ClashChoice`.

## Verification
- Unit: API `sessions.service.spec.ts` (spec 030 block), `nutrition-versions.spec.ts`; web
  `conflicts.spec.ts`, `outbox.spec.ts`.
- Runtime: two browser profiles on one account against a throwaway Mongo; offline edits of the
  same set, note and weigh-in on both, then reconnect each and resolve.
