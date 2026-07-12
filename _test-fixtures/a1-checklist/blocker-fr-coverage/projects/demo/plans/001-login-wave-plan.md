---
type: wave-plan
spec_path: projects/demo/spec/001-login.md
spec_id: "001"
project: demo
created: 2026-05-13
waves: 2
---

# Wave Plan: Login

## Wave 1: Auth backend

**Suggested agent(s):** a1-walter-web-developer, backend-bernd
**Depends on:** none
**Stories advanced:** FR-001

Implement the email+password endpoint.

## Wave 2: Forgot-password flow

**Suggested agent(s):** a1-walter-web-developer
**Depends on:** Wave 1
**Stories advanced:** FR-002

Implement the password reset flow on top of Wave 1.
