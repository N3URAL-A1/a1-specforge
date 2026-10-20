/**
 * lib/crm/api.ts — Re-Export Barrel
 *
 * MAJOR-1 (Wave 5 Reinhard Hotfix): api.ts war >1000 Zeilen.
 * Jetzt aufgeteilt in Domain-Module. Dieses Barrel re-exportiert alles
 * damit bestehende Imports von "@/lib/crm/api" weiterhin funktionieren.
 *
 * Domain-Module:
 *   lib/crm/postgrest-client.ts  — shared infra (JWT, fetch wrapper)
 *   lib/crm/leads.ts             — Lead CRUD
 *   lib/crm/contacts.ts          — Contacts, Outreach Events, Notes
 *   lib/crm/customers.ts         — Customers, Partners
 *   lib/crm/todos.ts             — Todos, Todo Actions
 *   lib/crm/deals.ts             — Deals, Deal Stage History
 *   lib/crm/invoices.ts          — Invoices, Invoice Items, Payments, PDF Snapshots
 *   lib/crm/projects.ts          — Projects, Milestones, Time Entries
 *   lib/crm/communications.ts    — Communication Log
 *   lib/crm/dashboard.ts         — Dashboard Home Data
 */

export * from "@/lib/crm/leads";
export * from "@/lib/crm/contacts";
export * from "@/lib/crm/customers";
export * from "@/lib/crm/todos";
export * from "@/lib/crm/deals";
export * from "@/lib/crm/invoices";
export * from "@/lib/crm/projects";
export * from "@/lib/crm/communications";
export * from "@/lib/crm/dashboard";
