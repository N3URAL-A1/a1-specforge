---
type: project-analysis
project: niimo
focus: general
title: "Full analysis (general + architecture + security) of niimo"
status: reported
created_at: "2026-07-05 18:13:45.078000+00:00"
findings:
  - "id=F-001; severity=MAJOR; category=ADR drift; location=docs/ + repo root; description=vendored (trimmed) copy of niimo analysis 2026-07-05-general for the SC-001 zero-diff acceptance fixture — see .a1/learnings/projects/a1-specforge for provenance; recommendation=see full report in the Vault"
  - "id=F-002; severity=MAJOR; category=abstraction leak; location=functions/src/cookbook/recipeExtractionService.ts; description=vendored (trimmed); recommendation=see full report"
  - "id=F-003; severity=MINOR; category=god file; location=functions/src/cookbook/recipeExtractionService.ts; description=vendored (trimmed); recommendation=see full report"
  - "id=F-004; severity=MINOR; category=index drift; location=CLAUDE.md; description=vendored (trimmed); recommendation=see full report"
  - "id=F-005; severity=MAJOR; category=simplification; location=functions/src/cookbook/recipeExtractionService.ts; description=vendored (trimmed); recommendation=see full report"
  - "id=F-006; severity=MINOR; category=simplification; location=functions/src/cookbook/recipeExtractionService.ts; description=vendored (trimmed); recommendation=see full report"
  - "id=F-007; severity=MINOR; category=simplification; location=functions/src/cookbook/recipeExtractionService.ts; description=vendored (trimmed); recommendation=see full report"
  - "id=F-008; severity=MINOR; category=simplification; location=functions/src/cookbook/recipeExtractionService.ts; description=vendored (trimmed); recommendation=see full report"
  - "id=F-009; severity=MINOR; category=simplification; location=functions/src/cookbook/recipeExtractionService.ts; description=vendored (trimmed); recommendation=see full report"
  - "id=F-010; severity=MINOR; category=simplification; location=functions/src/cookbook/recipeExtractionService.ts; description=vendored (trimmed); recommendation=see full report"
  - "id=F-011; severity=BLOCKER; category=App Check off; location=functions/src/middleware/appCheck.ts; description=vendored (trimmed); recommendation=see full report"
  - "id=F-012; severity=MAJOR; category=unauth arbitrary email; location=functions/src/mail/sendTransactionalEmail.ts; description=vendored (trimmed); recommendation=see full report"
  - "id=F-013; severity=MAJOR; category=public dead function; location=functions/src/recipes/seedRecipes.ts; description=vendored (trimmed); recommendation=see full report"
  - "id=F-014; severity=MAJOR; category=SSRF DNS rebinding; location=functions/src/cookbook/extractRecipeFromUrl.ts; description=vendored (trimmed); recommendation=see full report"
  - "id=F-015; severity=MINOR; category=runtime EOL; location=functions/package.json; description=vendored (trimmed); recommendation=see full report"
  - "id=F-016; severity=MINOR; category=take-down input trust; location=functions/src/cookbook/handleTakeDownRequest.ts; description=vendored (trimmed); recommendation=see full report"
  - "id=F-017; severity=MINOR; category=rules read breadth; location=firestore.rules; description=vendored (trimmed); recommendation=see full report"
  - "id=F-018; severity=BLOCKER; category=undisclosed processor; location=lib/shared/constants/legal_texts.dart; description=vendored (trimmed); recommendation=see full report"
  - "id=F-019; severity=BLOCKER; category=health-image lawful basis; location=functions/src/cookbook/extractRecipeFromCamera.ts; description=vendored (trimmed); recommendation=see full report"
  - "id=F-020; severity=BLOCKER; category=take-down not functional; location=functions/src/cookbook/handleTakeDownRequest.ts; description=vendored (trimmed); recommendation=see full report"
  - "id=F-021; severity=MAJOR; category=crashlytics consent; location=lib/shared/services/crashlytics_service.dart; description=vendored (trimmed); recommendation=see full report"
  - "id=F-022; severity=MAJOR; category=retention mismatch; location=lib/shared/constants/legal_texts.dart; description=vendored (trimmed); recommendation=see full report"
  - "id=F-023; severity=MAJOR; category=unreviewed legal texts; location=lib/shared/constants/legal_texts.dart; description=vendored (trimmed); recommendation=see full report"
  - "id=F-024; severity=MAJOR; category=AI Act transparency; location=lib/features/chat; description=vendored (trimmed); recommendation=see full report"
  - "id=F-025; severity=MINOR; category=consent revocation; location=lib/features/settings/presentation/screens/member_edit_screen.dart; description=vendored (trimmed); recommendation=see full report"
  - "id=F-026; severity=MAJOR; category=error handling; location=lib/; description=vendored (trimmed); recommendation=see full report"
  - "id=F-027; severity=MAJOR; category=unstructured logging; location=functions/src/; description=vendored (trimmed); recommendation=see full report"
  - "id=F-028; severity=MINOR; category=state dir legacy; location=project root; description=vendored (trimmed); recommendation=see full report"
  - "id=F-029; severity=MINOR; category=feature folder drift; location=lib/features/; description=vendored (trimmed); recommendation=see full report"
  - "id=F-030; severity=MINOR; category=docs drift; location=CLAUDE.md; description=vendored (trimmed); recommendation=see full report"
  - "id=F-031; severity=BLOCKER; category=cross-family IDOR; location=functions/src/notifications/unregisterFcmToken.ts; description=vendored (trimmed); recommendation=see full report"
findings_count:
  - "blocker=5"
  - "major=11"
  - "minor=15"
tags:
  - analysis
  - project/niimo
  - focus/general
permalink: vault/projects/niimo/analyses/2026-07-05-general
---

# Analysis: Full analysis (general + architecture + security) of niimo (VENDORED, TRIMMED)

> This is a trimmed, self-contained copy of the frontmatter `findings[]` from the real
> niimo reference analysis (`projects/niimo/analyses/2026-07-05-general.md`, external to
> this repo, Vault-only). Vendored here (spec 003, Wave 5) so the
> `_test-fixtures/product-audit-mirror/run.sh` acceptance harness does not depend on an
> external filesystem path that may not exist in a clean CI checkout. Only the three
> fields `readAnalysisForPublish` actually consumes (`id`, `severity`, `category`) are
> preserved verbatim; `location`/`description`/`recommendation` are replaced with a
> placeholder string (irrelevant to `product audit-publish`'s parsing, per
> `parseAnalysisFindingString`'s doc comment).
