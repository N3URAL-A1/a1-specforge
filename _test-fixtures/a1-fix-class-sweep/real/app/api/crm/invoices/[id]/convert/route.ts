/**
 * POST /api/crm/invoices/[id]/convert
 *
 * Spec 009 — Wave 2: Quote → Invoice + Project (atomar)
 *
 * Wandelt eine akzeptierte Quote atomar in eine neue Invoice + ein neues Projekt um.
 *
 * Preconditions:
 *   - type = 'quote'
 *   - status = 'accepted'
 *
 * Idempotent: Ein zweiter Aufruf gibt { already_converted: true } zurück ohne
 * neue Datensätze zu erstellen.
 *
 * Atomarität: Alles in einer withTenantContext-Transaktion — kein halber Zustand
 * möglich. Wenn das Projekt-INSERT scheitert, wird die Invoice nicht erstellt und
 * umgekehrt.
 *
 * Response 201: { invoice: { id, invoice_number }, project: { id, name } }
 * Response 200: { invoice_id, project_id, already_converted: true }
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { headers as nextHeaders } from "next/headers";
import { withTenantContext } from "@/lib/db/tenant-pool";
import { getNextInvoiceNumber } from "@/lib/crm/invoice-number";
import { ensureProjectForQuote } from "@/lib/crm/auto-project";
import { checkFeatureFlag } from "@/lib/features/api-guard";
import { logError } from "@/lib/log";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // --- Auth guard ---
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const h = await nextHeaders();
  const tenantId = h.get("x-tenant-id");
  const userId = session.user.id;

  if (!tenantId || !userId) {
    return NextResponse.json({ error: "Tenant context missing" }, { status: 400 });
  }

  // Wave 5 — Feature-Gate: Convert-Route ist Quote-spezifisch → immer prüfen
  const featureGuard = await checkFeatureFlag(
    "invoices",
    tenantId
  );
  if (featureGuard) return featureGuard;

  const { id } = await params;
  const quoteId = parseInt(id, 10);
  if (isNaN(quoteId)) {
    return NextResponse.json({ error: "Invalid invoice ID" }, { status: 400 });
  }

  try {
    const result = await withTenantContext(
      { userId, tenantId, isSuperadmin: session.user.isSuperadmin ?? false },
      async (client) => {
        // 1. Quote laden + validieren
        const quoteResult = await client.query<{
          id: number;
          type: string;
          status: string;
          customer_id: number;
          title: string | null;
          invoice_number: string;
          total: number;
          subtotal: number;
          tax_rate: number;
          tax_amount: number;
          kleinunternehmer: boolean;
          notes: string | null;
          service_period_start: string | null;
          service_period_end: string | null;
        }>(
          `SELECT id, type, status, customer_id,
                  COALESCE(notes, invoice_number) AS title,
                  invoice_number, total, subtotal, tax_rate, tax_amount,
                  kleinunternehmer, notes, service_period_start, service_period_end
           FROM api.invoices
           WHERE id = $1 AND tenant_id = $2`,
          [quoteId, tenantId]
        );

        if (quoteResult.rows.length === 0) {
          return { notFound: true } as const;
        }

        const quote = quoteResult.rows[0]!;

        if (quote.type !== "quote") {
          return { badRequest: "Not a quote" } as const;
        }

        if (quote.status !== "accepted") {
          return { badRequest: "Quote must be accepted before converting" } as const;
        }

        // 2. Idempotency-Check: bereits konvertiert?
        const idempCheck = await client.query<{ id: number; project_id: number | null }>(
          `SELECT id, project_id FROM api.invoices
           WHERE converted_from_id = $1 AND tenant_id = $2
           LIMIT 1`,
          [quoteId, tenantId]
        );

        if (idempCheck.rows.length > 0) {
          const existing = idempCheck.rows[0]!;
          return {
            alreadyConverted: true,
            invoice_id: existing.id,
            project_id: existing.project_id,
          } as const;
        }

        // 3. Projekt idempotent anlegen
        const project = await ensureProjectForQuote(client, tenantId, {
          id: quote.id,
          customer_id: quote.customer_id,
          title: quote.title ?? quote.invoice_number,
          total: quote.total,
        });

        // 4. Rechnungsnummer in dieser Tx ziehen (atomar, lückenlos) + Invoice anlegen
        const invoiceNumber = await getNextInvoiceNumber(client, "invoice");
        const invoiceInsert = await client.query<{ id: number; invoice_number: string }>(
          `INSERT INTO api.invoices (
             tenant_id, type, status, customer_id, project_id, converted_from_id,
             invoice_number, subtotal, tax_rate, tax_amount, total,
             kleinunternehmer, issue_date, due_date,
             service_period_start, service_period_end, notes
           ) VALUES (
             $1, 'invoice', 'draft', $2, $3, $4,
             $5, $6, $7, $8, $9,
             $10, CURRENT_DATE, CURRENT_DATE + INTERVAL '14 days',
             $11, $12, $13
           )
           RETURNING id, invoice_number`,
          [
            tenantId,
            quote.customer_id,
            project.id,
            quoteId,
            invoiceNumber,
            quote.subtotal,
            quote.tax_rate,
            quote.tax_amount,
            quote.total,
            quote.kleinunternehmer,
            quote.service_period_start,
            quote.service_period_end,
            quote.notes,
          ]
        );

        const newInvoice = invoiceInsert.rows[0]!;

        // 5. Invoice-Items kopieren (neue invoice_id, auto-SERIAL id)
        await client.query(
          `INSERT INTO api.invoice_items (tenant_id, invoice_id, position, description, quantity, unit, unit_price, total)
           SELECT $1, $2, position, description, quantity, unit, unit_price, total
           FROM api.invoice_items
           WHERE invoice_id = $3 AND tenant_id = $1`,
          [tenantId, newInvoice.id, quoteId]
        );

        return {
          invoice: { id: newInvoice.id, invoice_number: newInvoice.invoice_number },
          project: { id: project.id, name: project.name },
        } as const;
      }
    );

    // --- Response routing ---
    if ("notFound" in result) {
      return NextResponse.json({ error: "Quote not found" }, { status: 404 });
    }

    if ("badRequest" in result) {
      return NextResponse.json({ error: result.badRequest }, { status: 400 });
    }

    if ("alreadyConverted" in result) {
      return NextResponse.json(
        {
          invoice_id: result.invoice_id,
          project_id: result.project_id,
          already_converted: true,
        },
        { status: 200 }
      );
    }

    return NextResponse.json(
      { invoice: result.invoice, project: result.project },
      { status: 201 }
    );
  } catch (e) {
    logError("api/crm/invoices/[id]/convert", "Fehler:", e);
    return NextResponse.json({ error: "Interner Serverfehler" }, { status: 500 });
  }
}
