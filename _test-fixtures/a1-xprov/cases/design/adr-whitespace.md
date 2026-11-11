---
title: Use a queue for outbound mail
status: accepted
date: 2026-11-08
---


# ADR 0007: Use a queue for outbound mail   


## Context

    The signup flow sends a welcome mail inside the request. A slow SMTP relay
  makes the signup page time out.   

## Decision

	Mail is written to an `outbox` table in the same transaction as the signup
row. A worker drains the table and sends the mail.


## Consequences

  - Signup latency no longer depends on the relay.
- A failed send is retried by the worker; the request never sees it.   
   - One more process to run and monitor.


