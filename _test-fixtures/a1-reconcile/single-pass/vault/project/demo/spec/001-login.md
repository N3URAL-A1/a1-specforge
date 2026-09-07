---
id: 001-login
project: demo
feature_slug: login
title: Login Feature
status: clarified
created: 2026-05-01
updated: 2026-05-01
---

# Login Feature — Spec

## Functional Requirements

- FR-001: User can enter email and password via `src/auth/LoginForm.tsx`.
- FR-002: System validates credentials in `src/auth/credentials.ts`.
- FR-003: API endpoint `POST /api/login` issues a session cookie on success.
- FR-004: On failure, return `401` with a clear error message.
