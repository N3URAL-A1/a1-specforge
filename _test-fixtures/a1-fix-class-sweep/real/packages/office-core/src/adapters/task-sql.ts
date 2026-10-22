/**
 * adapters/task-sql.ts — gemeinsames SQL fuer Aufgaben-Zeilen aus office-core
 * (058-workflow-core, PLAN M7).
 *
 * Einziger Schreiber von api.workspace_tasks / _assignees / _references im Paket:
 * `task.create` des DirectPgWriteAdapter UND die Folgeaufgaben von
 * applyStageTransition. Spalten identisch mit dem bisherigen `createTask`
 * (direct-pg-write-adapter.ts), damit `task.create` sich nicht aendert.
 *
 * Client-gebunden, keine eigene Transaktion. Mitgliedschaftspruefung der
 * Zugewiesenen bleibt beim Aufrufer (sie wirft adapter-spezifische Fehler).
 *
 * SEC-7: customer_id/project_id werden VOR dem INSERT gegen den Mandanten geprueft
 * (einspaltige FKs umgehen RLS). Wirft TenantReferenceError; der Adapter macht daraus
 * einen WritePortError 422. Bei Folgeaufgaben stammen die Ids aus dem Deal selbst —
 * die Pruefung kostet dort eine Abfrage und greift nie, ist aber dieselbe Stelle.
 */
import type { Queryable } from "./direct-pg-adapter.js";
import { assertRefsInTenant } from "../domain/tenant-references.js";

export interface TaskRowInput {
  tenantId: string;
  title: string;
  description?: string;
  status?: string;
  priority?: string;
  dueAt?: string | null;
  customerId?: number | null;
  projectId?: number | null;
  createdBy: string;
}

export interface TaskRow {
  id: string;
  title: string;
  status: string;
  priority: string;
  created_at: string;
}

export async function insertTaskRow(client: Queryable, input: TaskRowInput): Promise<TaskRow> {
  const status = input.status ?? "open";
  await assertRefsInTenant(client, input.tenantId, [
    ["customer", input.customerId],
    ["project", input.projectId],
  ]);
  const { rows } = await client.query<TaskRow>(
    `INSERT INTO api.workspace_tasks
       (tenant_id, title, description, status, priority, due_at,
        customer_id, project_id, created_by, completed_at)
     VALUES ($1::uuid, $2, $3, $4, $5, $6::timestamptz, $7, $8, $9::uuid,
             CASE WHEN $4 = 'done' THEN now() ELSE NULL END)
     RETURNING id, title, status, priority, created_at`,
    [
      input.tenantId,
      input.title,
      input.description ?? "",
      status,
      input.priority ?? "normal",
      input.dueAt ?? null,
      input.customerId ?? null,
      input.projectId ?? null,
      input.createdBy,
    ]
  );
  return rows[0]!;
}

export async function insertTaskAssignees(
  client: Queryable,
  tenantId: string,
  taskId: string,
  assignedBy: string,
  userIds: readonly string[]
): Promise<void> {
  if (userIds.length === 0) return;
  await client.query(
    `INSERT INTO api.workspace_task_assignees (tenant_id, task_id, user_id, assigned_by)
     SELECT $1::uuid, $2::uuid, uid, $3::uuid FROM unnest($4::uuid[]) AS uid`,
    [tenantId, taskId, assignedBy, [...userIds]]
  );
}

export async function insertTaskReference(
  client: Queryable,
  tenantId: string,
  taskId: string,
  entityType: string,
  entityRef: string,
  label: string
): Promise<void> {
  await client.query(
    `INSERT INTO api.workspace_task_references (tenant_id, task_id, entity_type, entity_ref, label)
     VALUES ($1::uuid, $2::uuid, $3, $4, $5)`,
    [tenantId, taskId, entityType, entityRef, label]
  );
}
