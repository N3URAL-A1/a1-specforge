/**
 * lib/workspace-tasks/task-write-service.ts
 *
 * Kanonischer Write-Service für die drei Workspace-Task-Tabellen
 * (FR-004, Haus-Regel Write-Path-Konsolidierung, ADR 2026-06-30).
 * Der EINZIGE Ort, der `api.workspace_tasks`, `api.workspace_task_assignees`
 * und `api.workspace_task_references` mutiert — durchgesetzt von
 * `scripts/gate-write-paths.mjs`.
 *
 * Vertrag (wie bei allen Write-Services des Hauses):
 *   - Jede Funktion bekommt einen lebenden `PoolClient` aus der OFFENEN
 *     Transaktion des Aufrufers. Kein eigenes `withTenantContext`.
 *   - `tenant_id` kommt IMMER aus dem `tenantId`-Parameter, NIE aus dem Body.
 *   - Rückgabe sind RETURNING-Zeilen; Constraint-Verletzungen werfen.
 *
 * KEIN Mailversand hier (ND10). Die Zuweisungs-Mail geht im Route-Handler raus,
 * NACHDEM die Transaktion committet ist. Eine Mail aus dieser Transaktion
 * heraus würde auch dann verschickt, wenn später zurückgerollt wird — und eine
 * verschickte Mail lässt sich nicht zurückholen.
 */

import type { PoolClient } from "pg";
import type {
  CreateTaskInput,
  CreateTaskItemInput,
  ReferenceInput,
  TaskPriority,
  TaskStatus,
  UpdateTaskInput,
  UpdateTaskItemInput,
} from "./schemas";
import { TASK_MAX_ITEMS_PER_TASK } from "./schemas";
import { assertRefInTenant, assertRefsInTenant } from "@/lib/crm/tenant-references";

/**
 * SEC-7: `customer_id`/`project_id` haben einspaltige FKs, die RLS umgehen — ohne diese Pruefung
 * liesse sich eine Aufgabe an Kunde oder Projekt eines fremden Mandanten haengen. Wirft
 * TenantReferenceError (422, fremd und nicht existent gleich). null/undefined = nichts zu pruefen.
 */
async function assertTaskReferences(
  client: PoolClient,
  tenantId: string,
  refs: { customer_id?: number | null; project_id?: number | null }
): Promise<void> {
  await assertRefsInTenant(client, tenantId, [
    ["customer", refs.customer_id],
    ["project", refs.project_id],
  ]);
}

// ── Zeilen-Typen (Spiegel des Schemas aus Migration 123) ────────────────────

export interface WorkspaceTaskRow {
  id: string;
  tenant_id: string;
  customer_id: number | null;
  project_id: number | null;
  title: string;
  description: string;
  status: TaskStatus;
  due_at: Date | null;
  priority: TaskPriority;
  created_by: string;
  completed_at: Date | null;
  deleted_at: Date | null;
  migrated_from_todo_id: number | null;
  created_at: Date;
  updated_at: Date;
}

export interface WorkspaceTaskAssigneeRow {
  id: string;
  tenant_id: string;
  task_id: string;
  user_id: string;
  assigned_by: string | null;
  assigned_at: Date;
  notified_at: Date | null;
}

export interface WorkspaceTaskReferenceRow {
  id: string;
  tenant_id: string;
  task_id: string;
  entity_type: string;
  entity_ref: string;
  label: string;
  created_at: Date;
}

/** Ergebnis von `setAssignees` — Grundlage für den Mailversand im Handler. */
export interface AssigneeDiff {
  added: WorkspaceTaskAssigneeRow[];
  removed: WorkspaceTaskAssigneeRow[];
  /** Zuweisungen, die unverändert bestehen blieben (kein Mailanlass). */
  unchanged: WorkspaceTaskAssigneeRow[];
}

// ── Tasks ───────────────────────────────────────────────────────────────────

/**
 * Aufgabe anlegen.
 *
 * `completed_at` wird NICHT vom Aufrufer übernommen, sondern aus dem Status
 * abgeleitet — der CHECK `(status='done') = (completed_at IS NOT NULL)` lässt
 * gar nichts anderes zu, und eine Ableitung an genau einer Stelle verhindert,
 * dass ein Aufrufer einen 500er statt einer Validierungsmeldung produziert.
 *
 * Zuweisungen und Verweise gehören zur selben Transaktion: eine Aufgabe, die
 * ohne ihre Zuweisungen entsteht, wäre für "Meine Aufgaben" unsichtbar.
 */
export async function createTask(
  client: PoolClient,
  tenantId: string,
  createdBy: string,
  input: CreateTaskInput
): Promise<WorkspaceTaskRow> {
  const status: TaskStatus = input.status ?? "open";

  await assertTaskReferences(client, tenantId, input);

  const { rows } = await client.query<WorkspaceTaskRow>(
    `INSERT INTO api.workspace_tasks
       (tenant_id, customer_id, project_id, title, description,
        status, priority, due_at, created_by, completed_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9,
             CASE WHEN $6 = 'done' THEN now() ELSE NULL END)
     RETURNING *`,
    [
      tenantId,
      input.customer_id ?? null,
      input.project_id ?? null,
      input.title,
      input.description ?? "",
      status,
      input.priority ?? "normal",
      input.due_at ?? null,
      createdBy,
    ]
  );

  const task = rows[0];

  if (input.assignee_ids?.length) {
    await setAssignees(client, tenantId, task.id, input.assignee_ids, createdBy);
  }
  for (const ref of input.references ?? []) {
    await addReference(client, tenantId, task.id, ref);
  }

  return task;
}

/**
 * Aufgabe teilweise aktualisieren (dynamisches SET, RETURNING *).
 *
 * Gibt `undefined` zurück, wenn keine Zeile getroffen wurde — also bei
 * unbekannter ID, fremdem Tenant oder bereits soft-gelöschter Aufgabe. Der
 * Handler macht daraus einen 404; ein fremder Tenant darf nicht unterscheidbar
 * sein von "gibt es nicht".
 *
 * `completed_at` folgt dem Status und wird deshalb hier gesetzt, nicht vom
 * Aufrufer übergeben. Beim Wechsel auf `done` bekommt eine bereits
 * abgeschlossene Aufgabe ihren ursprünglichen Zeitstempel behalten (COALESCE) —
 * zweimal "erledigt" klicken soll die Historie nicht verschieben.
 */
export async function updateTask(
  client: PoolClient,
  tenantId: string,
  id: string,
  updates: UpdateTaskInput
): Promise<WorkspaceTaskRow | undefined> {
  const entries = Object.entries(updates).filter(([, v]) => v !== undefined);
  if (entries.length === 0) return undefined;

  await assertTaskReferences(client, tenantId, updates);

  const setClauses: string[] = [];
  const values: unknown[] = [];

  for (const [key, value] of entries) {
    values.push(value);
    setClauses.push(`${key} = $${values.length}`);
  }

  if (updates.status !== undefined) {
    setClauses.push(
      updates.status === "done"
        ? "completed_at = COALESCE(completed_at, now())"
        : "completed_at = NULL"
    );
  }

  // updated_at zusätzlich zum Trigger: macht die RETURNING-Zeile korrekt, ohne
  // dass der Aufrufer nachlesen muss.
  setClauses.push("updated_at = now()");

  values.push(id);
  const idParam = `$${values.length}`;
  values.push(tenantId);
  const tenantParam = `$${values.length}`;

  const { rows } = await client.query<WorkspaceTaskRow>(
    `UPDATE api.workspace_tasks
        SET ${setClauses.join(", ")}
      WHERE id = ${idParam}
        AND tenant_id = ${tenantParam}
        AND deleted_at IS NULL
      RETURNING *`,
    values
  );

  return rows[0];
}

/**
 * Aufgabe soft-löschen.
 *
 * Kein hartes DELETE: Aufgaben tragen Geschäftsinhalt und hängen an
 * Audit-Einträgen. Ein zweiter Aufruf auf eine bereits gelöschte Aufgabe
 * trifft 0 Zeilen und überschreibt den ursprünglichen Löschzeitpunkt nicht.
 *
 * Zuweisungen und Verweise bleiben stehen — sie hängen per ON DELETE CASCADE
 * an der Zeile und werden erst beim endgültigen Löschen (Tenant-Purge)
 * mitgenommen. Die Lesepfade filtern ohnehin über `deleted_at IS NULL` auf der
 * Aufgabe.
 */
export async function deleteTask(
  client: PoolClient,
  tenantId: string,
  id: string
): Promise<WorkspaceTaskRow | undefined> {
  const { rows } = await client.query<WorkspaceTaskRow>(
    `UPDATE api.workspace_tasks
        SET deleted_at = now(), updated_at = now()
      WHERE id = $1
        AND tenant_id = $2
        AND deleted_at IS NULL
      RETURNING *`,
    [id, tenantId]
  );
  return rows[0];
}

// ── Zuweisungen ─────────────────────────────────────────────────────────────

/**
 * Zuweisungsmenge ersetzen (PUT-Semantik) und die Differenz melden.
 *
 * Der Rückgabewert ist der Auslöser für die Zuweisungs-Mail: der Handler
 * verschickt nach dem Commit genau für `added` (ohne den Handelnden selbst).
 * Deshalb ist es wichtig, dass `unchanged` NICHT in `added` landet — sonst
 * bekäme jede Speicherung eines unveränderten Formulars eine neue Mail.
 *
 * Re-Assign nach Un-Assign erzeugt bewusst eine NEUE Zeile: `notified_at` ist
 * dadurch wieder NULL und die Mail geht korrekt erneut raus (ND10).
 *
 * Die Aufgabe wird vorab im eigenen Tenant und ungelöscht verifiziert. Ohne
 * diese Prüfung würde eine Zuweisung an eine fremde Aufgabe zwar von RLS
 * geblockt, aber als leeres Ergebnis statt als Fehler zurückkommen.
 */
/**
 * Prüft, dass jede Ziel-ID zu einem Mitglied DIESES Tenants gehört.
 *
 * Ohne diese Prüfung ließe sich jemand aus einem fremden Tenant zuweisen: der
 * Fremdschlüssel zeigt auf `api.platform_users` und kennt keine Mitgliedschaft,
 * und RLS greift nicht, weil die eingefügte Zeile selbst korrekt getenantet ist
 * (`tenant_id` kommt aus dem Kontext). Gegen preprod verifiziert — die
 * Datenbank akzeptiert eine solche Zeile anstandslos.
 *
 * Folgen wären still: die Person taucht als Zuweisung auf, ihr Name lässt sich
 * mangels Mitgliedschaft nicht auflösen (siehe W3-D1), und sie sieht die
 * Aufgabe in ihrem eigenen Workspace nie. Deshalb ABLEHNEN statt stillschweigend
 * verwerfen — wer eine Person zuweist, muss erfahren, dass es nicht ging.
 *
 * `tenant_users` ist aus dem Tenant-Kontext lesbar (die RLS-Rekursion betrifft
 * nur Schreibzugriffe), deshalb genügt hier die laufende Transaktion — kein
 * System-Kontext nötig.
 */
async function assertTenantMembers(
  client: PoolClient,
  tenantId: string,
  userIds: readonly string[]
): Promise<void> {
  if (userIds.length === 0) return;

  const { rows } = await client.query<{ user_id: string }>(
    `SELECT user_id FROM api.tenant_users
      WHERE tenant_id = $1 AND user_id = ANY($2::uuid[])`,
    [tenantId, [...userIds]]
  );

  const members = new Set(rows.map((r) => r.user_id));
  const strangers = userIds.filter((id) => !members.has(id));
  if (strangers.length > 0) {
    throw new InvalidAssigneeError(strangers);
  }
}

export async function setAssignees(
  client: PoolClient,
  tenantId: string,
  taskId: string,
  userIds: readonly string[],
  actorId: string
): Promise<AssigneeDiff> {
  const { rows: taskRows } = await client.query<{ id: string }>(
    `SELECT id FROM api.workspace_tasks
      WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
    [taskId, tenantId]
  );
  if (taskRows.length === 0) {
    throw new WorkspaceTaskNotFoundError(taskId);
  }

  // Doppelte IDs im Eingang würden am UNIQUE-Index scheitern.
  const target = Array.from(new Set(userIds));

  await assertTenantMembers(client, tenantId, target);

  const { rows: existing } = await client.query<WorkspaceTaskAssigneeRow>(
    `SELECT * FROM api.workspace_task_assignees
      WHERE task_id = $1 AND tenant_id = $2`,
    [taskId, tenantId]
  );

  const existingByUser = new Map(existing.map((r) => [r.user_id, r]));
  const targetSet = new Set(target);

  const toRemove = existing.filter((r) => !targetSet.has(r.user_id));
  const toAdd = target.filter((u) => !existingByUser.has(u));
  const unchanged = existing.filter((r) => targetSet.has(r.user_id));

  let removed: WorkspaceTaskAssigneeRow[] = [];
  if (toRemove.length > 0) {
    const { rows } = await client.query<WorkspaceTaskAssigneeRow>(
      `DELETE FROM api.workspace_task_assignees
        WHERE task_id = $1 AND tenant_id = $2 AND user_id = ANY($3::uuid[])
        RETURNING *`,
      [taskId, tenantId, toRemove.map((r) => r.user_id)]
    );
    removed = rows;
  }

  let added: WorkspaceTaskAssigneeRow[] = [];
  if (toAdd.length > 0) {
    const { rows } = await client.query<WorkspaceTaskAssigneeRow>(
      `INSERT INTO api.workspace_task_assignees (tenant_id, task_id, user_id, assigned_by)
       SELECT $1, $2, uid, $3 FROM unnest($4::uuid[]) AS uid
       RETURNING *`,
      [tenantId, taskId, actorId, toAdd]
    );
    added = rows;
  }

  return { added, removed, unchanged };
}

/**
 * `notified_at` nach erfolgreichem Mailversand stempeln (ND10).
 *
 * Bewusst eine eigene Funktion und NICHT Teil von `setAssignees`: der Versand
 * passiert erst nach dem Commit, also in einer anderen Transaktion. Ein Fehler
 * hier ist unkritisch — im schlimmsten Fall bekommt jemand beim nächsten
 * Speichern eine zweite Mail, was besser ist als eine ausbleibende.
 */
export async function markAssigneeNotified(
  client: PoolClient,
  tenantId: string,
  assigneeId: string
): Promise<void> {
  await client.query(
    `UPDATE api.workspace_task_assignees
        SET notified_at = now()
      WHERE id = $1 AND tenant_id = $2 AND notified_at IS NULL`,
    [assigneeId, tenantId]
  );
}

// ── Verweise ────────────────────────────────────────────────────────────────

/**
 * Verweis hinzufügen. Idempotent: derselbe Verweis zweimal angelegt ergibt
 * dieselbe Zeile (UNIQUE auf task_id/entity_type/entity_ref), die Beschriftung
 * wird dabei aktualisiert.
 */
export async function addReference(
  client: PoolClient,
  tenantId: string,
  taskId: string,
  ref: ReferenceInput
): Promise<WorkspaceTaskReferenceRow> {
  // 059 (P-7): `entity_ref` ist ein freier Text ohne FK — ein Verweis auf ein Objekt wird gegen den Mandanten
  // geprueft (fremd und nicht existent: dieselbe 422 PROPERTY_NOT_FOUND). Die uebrigen Typen bleiben wie bisher.
  if (ref.entity_type === "property") {
    await assertRefInTenant(client, tenantId, "property", ref.entity_ref);
  }
  const { rows } = await client.query<WorkspaceTaskReferenceRow>(
    `INSERT INTO api.workspace_task_references
       (tenant_id, task_id, entity_type, entity_ref, label)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (task_id, entity_type, entity_ref)
       DO UPDATE SET label = EXCLUDED.label
     RETURNING *`,
    [tenantId, taskId, ref.entity_type, ref.entity_ref, ref.label ?? ""]
  );
  return rows[0];
}

/**
 * Verweis entfernen. Gibt zurück, ob eine Zeile getroffen wurde — der Handler
 * unterscheidet damit 204 von 404.
 */
export async function removeReference(
  client: PoolClient,
  tenantId: string,
  taskId: string,
  referenceId: string
): Promise<boolean> {
  const { rowCount } = await client.query(
    `DELETE FROM api.workspace_task_references
      WHERE id = $1 AND task_id = $2 AND tenant_id = $3`,
    [referenceId, taskId, tenantId]
  );
  return (rowCount ?? 0) > 0;
}

// ── Fehler ──────────────────────────────────────────────────────────────────

/**
 * Die Aufgabe existiert im aktiven Tenant nicht (oder ist gelöscht).
 *
 * Eigene Klasse, damit der Handler daraus einen 404 machen kann, ohne die
 * Fehlermeldung zu parsen. Bewusst ohne Unterscheidung zwischen "gibt es
 * nicht" und "gehört einem anderen Tenant" — die Unterscheidung wäre selbst
 * schon ein Informationsleck.
 */
export class WorkspaceTaskNotFoundError extends Error {
  constructor(public readonly taskId: string) {
    super(`Workspace task ${taskId} not found in active tenant`);
    this.name = "WorkspaceTaskNotFoundError";
  }
}

/**
 * Mindestens eine Zuweisung zielt auf jemanden, der nicht zum Tenant gehört.
 *
 * Eigene Klasse statt eines generischen Fehlers, damit die Route daraus einen
 * 422 mit verständlicher Meldung macht und keinen 500er.
 */
export class InvalidAssigneeError extends Error {
  constructor(public readonly userIds: readonly string[]) {
    super(
      userIds.length === 1
        ? "Die zugewiesene Person ist kein Mitglied dieses Workspace."
        : `${userIds.length} zugewiesene Personen sind keine Mitglieder dieses Workspace.`
    );
    this.name = "InvalidAssigneeError";
  }
}


// ── Checklisten-Punkte (Spec 051) ───────────────────────────────────────────

/**
 * Eine Aufgabe hat ihr Punkte-Limit erreicht.
 *
 * Eigene Klasse wie InvalidAssigneeError, damit die Route einen 422 mit
 * lesbarer Meldung daraus macht statt eines 500ers.
 */
export class TaskItemLimitError extends Error {
  constructor(public readonly limit: number) {
    super(`Eine Aufgabe kann höchstens ${limit} Punkte haben.`);
    this.name = "TaskItemLimitError";
  }
}

/** Ein Punkt mit diesem Text steht schon auf der Liste. */
export class DuplicateTaskItemError extends Error {
  constructor(public readonly title: string) {
    super("Diesen Punkt gibt es auf der Liste bereits.");
    this.name = "DuplicateTaskItemError";
  }
}

export interface TaskItemRow {
  id: string;
  tenant_id: string;
  task_id: string;
  title: string;
  done: boolean;
  position: number;
  completed_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

/**
 * Punkt anhängen.
 *
 * Serialisiert über eine Sperre auf der ELTERNZEILE (`SELECT … FOR UPDATE` auf
 * `api.workspace_tasks`), nicht über das INSERT allein.
 *
 * Warum: Ein `INSERT … SELECT MAX(position)+1 … HAVING count(*) < 20` sieht aus,
 * als entschiede die Datenbank alles in einem Zug — tut sie unter READ COMMITTED
 * aber nicht. Beide Transaktionen lesen denselben Ausgangsstand, bevor eine von
 * ihnen committet. Mit zwei echten Verbindungen reproduziert (19 vorhandene
 * Punkte, zwei parallele Inserts):
 *
 *     A: 20 | B: 20
 *     Gesamt: 21 (Limit 20) | doppelte Positionen: 1
 *
 * Limit überschritten UND Position doppelt vergeben. Die Zeilensperre macht die
 * beiden Vorgänge nacheinander sichtbar: der zweite liest erst, wenn der erste
 * fertig ist, und sieht dann 20 Punkte.
 *
 * Gesperrt wird die Aufgabe, nicht die Punkte-Tabelle: es gibt keine Zeile, die
 * "alle Punkte dieser Aufgabe" repräsentiert, und ein Tabellen-Lock würde
 * Aufgaben blockieren, die nichts miteinander zu tun haben. Der Lock hält nur
 * bis zum Ende der umgebenden Transaktion (withTenantContext).
 */
export async function addItem(
  client: PoolClient,
  tenantId: string,
  taskId: string,
  input: CreateTaskItemInput
): Promise<TaskItemRow> {
  const { rowCount: locked } = await client.query(
    `SELECT 1 FROM api.workspace_tasks
      WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL
      FOR UPDATE`,
    [taskId, tenantId]
  );
  // Die Aufgabe wurde zwischen Vorprüfung und Sperre gelöscht — der Aufrufer
  // macht daraus einen 404, keinen 500er.
  if (!locked) throw new WorkspaceTaskNotFoundError(taskId);

  try {
    const { rows } = await client.query<TaskItemRow>(
      `INSERT INTO api.workspace_task_items (tenant_id, task_id, title, position)
       SELECT $1, $2, $3,
              COALESCE(MAX(position), 0) + 1
         FROM api.workspace_task_items
        WHERE task_id = $2
       HAVING count(*) < $4
       RETURNING *`,
      [tenantId, taskId, input.title, TASK_MAX_ITEMS_PER_TASK]
    );

    // Kein RETURNING heißt: das HAVING hat gegriffen, die Liste ist voll.
    // (Bei einer leeren Tabelle liefert die Aggregat-Abfrage genau eine Zeile
    // mit count 0, das HAVING ist also auch für den ersten Punkt erfüllt.)
    if (!rows[0]) throw new TaskItemLimitError(TASK_MAX_ITEMS_PER_TASK);
    return rows[0];
  } catch (error) {
    // 23505 = unique_violation. Auf den NAMEN geprüft, nicht nur auf den Code:
    // die Tabelle trägt zwei Unique-Indizes (PK + Titel), und ein pauschaler
    // Catch würde eine PK-Kollision als "Punkt existiert bereits" ausgeben —
    // eine irreführende Meldung für einen ganz anderen Fehler.
    if (isDuplicateItemTitle(error)) {
      throw new DuplicateTaskItemError(input.title);
    }
    throw error;
  }
}

/** Ist der Fehler genau die Titel-Dublette (nicht irgendeine Unique-Verletzung)? */
function isDuplicateItemTitle(error: unknown): boolean {
  const e = error as { code?: string; constraint?: string };
  return e?.code === "23505" && e?.constraint === "uq_workspace_task_items_task_title";
}

/**
 * Punkt ändern: Titel, Erledigt-Status oder beides.
 *
 * `done` und `completed_at` werden IMMER zusammen gesetzt — der DB-CHECK
 * `(done = true) = (completed_at IS NOT NULL)` kann über diesen Pfad nicht
 * verletzt werden. Deshalb nimmt die Eingabe auch kein `completed_at` entgegen.
 */
export async function updateItem(
  client: PoolClient,
  tenantId: string,
  taskId: string,
  itemId: string,
  input: UpdateTaskItemInput
): Promise<TaskItemRow | undefined> {
  const sets: string[] = [];
  const values: unknown[] = [tenantId, taskId, itemId];

  if (input.title !== undefined) {
    values.push(input.title);
    sets.push(`title = $${values.length}`);
  }
  if (input.done !== undefined) {
    values.push(input.done);
    sets.push(`done = $${values.length}`);
    // Gekoppelt, nicht als eigenes Eingabefeld: der Zeitstempel folgt dem
    // Status, nie umgekehrt.
    sets.push(`completed_at = CASE WHEN $${values.length} THEN now() ELSE NULL END`);
  }

  if (sets.length === 0) return undefined;

  try {
    const { rows } = await client.query<TaskItemRow>(
      `UPDATE api.workspace_task_items
          SET ${sets.join(", ")}
        WHERE tenant_id = $1 AND task_id = $2 AND id = $3
        RETURNING *`,
      values
    );
    return rows[0];
  } catch (error) {
    if (isDuplicateItemTitle(error)) {
      throw new DuplicateTaskItemError(input.title ?? "");
    }
    throw error;
  }
}

/** Punkt entfernen. `undefined`, wenn es ihn nicht gab. */
export async function deleteItem(
  client: PoolClient,
  tenantId: string,
  taskId: string,
  itemId: string
): Promise<TaskItemRow | undefined> {
  const { rows } = await client.query<TaskItemRow>(
    `DELETE FROM api.workspace_task_items
      WHERE tenant_id = $1 AND task_id = $2 AND id = $3
      RETURNING *`,
    [tenantId, taskId, itemId]
  );
  return rows[0];
}

/** Die übergebene Reihenfolge nennt nicht genau die Punkte dieser Aufgabe. */
export class IncompleteReorderError extends Error {
  constructor(
    public readonly expected: number,
    public readonly received: number
  ) {
    super(
      "Die Reihenfolge muss alle Punkte der Aufgabe genau einmal nennen."
    );
    this.name = "IncompleteReorderError";
  }
}

/**
 * Punkte neu sortieren.
 *
 * Die Liste MUSS vollständig sein und jede Id genau einmal enthalten. Das ist
 * keine Bequemlichkeit, sondern eine Korrektheitsbedingung: Positionen werden
 * aus dem Index vergeben (1..n), und wer nur eine Teilmenge nennt, vergibt
 * Positionen doppelt.
 *
 * Belegt gegen die Datenbank: vier Punkte auf 1..4, dann nur die letzten beiden
 * umsortiert → `P1@1, P3@1, P2@2, P4@2`. Zwei Paare mit identischer Position,
 * und die Anzeigereihenfolge wird mehrdeutig. Ein früherer Kommentar behauptete
 * hier, unvollständige Listen liefen "ins Leere" — das gilt nur für FREMDE Ids,
 * nicht für Teilmengen der eigenen.
 *
 * Deshalb wird die Vollständigkeit VOR dem UPDATE geprüft, in derselben
 * Transaktion: sonst könnte zwischen Prüfung und Schreiben ein Punkt dazukommen.
 *
 * Das eigentliche Umsortieren bleibt EIN Statement (`unnest WITH ORDINALITY`) —
 * so gibt es keinen Zwischenzustand mit halb sortierter Liste.
 */
export async function reorderItems(
  client: PoolClient,
  tenantId: string,
  taskId: string,
  itemIds: readonly string[]
): Promise<number> {
  const unique = new Set(itemIds);
  if (unique.size !== itemIds.length) {
    throw new IncompleteReorderError(itemIds.length, unique.size);
  }

  const { rows } = await client.query<{ n: string }>(
    `SELECT count(*)::text AS n
       FROM api.workspace_task_items
      WHERE tenant_id = $1 AND task_id = $2`,
    [tenantId, taskId]
  );
  const existing = Number(rows[0]?.n ?? 0);
  if (existing !== itemIds.length) {
    throw new IncompleteReorderError(existing, itemIds.length);
  }

  const { rowCount } = await client.query(
    `UPDATE api.workspace_task_items i
        SET position = neu.position
       FROM (
         SELECT id::uuid, ordinality::int AS position
           FROM unnest($3::uuid[]) WITH ORDINALITY AS t(id, ordinality)
       ) neu
      WHERE i.id = neu.id
        AND i.tenant_id = $1
        AND i.task_id   = $2`,
    [tenantId, taskId, itemIds]
  );

  // Weniger geänderte Zeilen als genannte Ids heißt: mindestens eine Id gehört
  // nicht zu dieser Aufgabe. Die Anzahl stimmte dann zwar, die Menge nicht —
  // und die nicht genannten eigenen Punkte behielten ihre alte Position.
  const changed = rowCount ?? 0;
  if (changed !== itemIds.length) {
    throw new IncompleteReorderError(existing, changed);
  }

  return changed;
}
