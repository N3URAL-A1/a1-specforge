---
title: Use a queue for outbound mail
status: proposed
date: 2026-11-01
deciders: [alex]
---

# ADR 0007: Use a queue for outbound mail

## Context

The signup flow sends a welcome mail inside the request. A slow SMTP relay
makes the signup page time out.

## Decision

Mail is written to an `outbox` table in the same transaction as the signup
row. A worker drains the table and sends the mail. Sends are capped at 20
per second per relay.

## Consequences

- Signup latency no longer depends on the relay.
- A failed send is retried by the worker; the request never sees it.
- One more process to run and monitor.
