'use strict';

const fs = require('fs');
const path = require('path');
const { parseFlags } = require('./io.cjs');
const { usage } = require('./help.cjs');

// ---------------------------------------------------------------------------
// schema-check — SQL parsing (M6 Task 2.1a)
//
// Bounded parser for the deterministic subset of schema_flaw checks.
// Pure functions, no I/O beyond reading .sql files from a directory.
//
// SUPPORTED SQL SUBSET (also documented in HELP):
//   - Top-level semicolon-terminated statements only.
//   - Single-quoted strings and $$-dollar-quoted regions are treated as opaque
//     (semicolons inside them do not split statements).
//   - No quoted identifiers ("My Table") — plain / schema-qualified names only.
//   - CREATE TABLE: column defs with declared types, inline PRIMARY KEY,
//     table-level PRIMARY KEY (...), inline REFERENCES other(col),
//     table-level FOREIGN KEY (col) REFERENCES other(col).
//   - ALTER TABLE ... ADD CONSTRAINT ... FOREIGN KEY (col) REFERENCES other(col).
//   - ALTER TABLE ... ENABLE ROW LEVEL SECURITY (+ FORCE ROW LEVEL SECURITY).
//   - CREATE TRIGGER <name> ... ON <table> — header only; $$ function bodies
//     are NOT parsed beyond the trigger header.
//   - Unsupported constructs are skipped and counted, never crash.
// ---------------------------------------------------------------------------

function sqlStripComments(sql) {
  // Remove -- line comments and /* */ block comments (naive, no nesting;
  // does not protect comments inside string literals — acceptable for subset).
  return sql.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, '');
}

function sqlSplitStatements(sql) {
  const statements = [];
  let cur = '';
  let i = 0;
  while (i < sql.length) {
    const ch = sql[i];
    if (ch === "'") {
      // opaque single-quoted string ('' escapes)
      cur += ch;
      i++;
      while (i < sql.length) {
        cur += sql[i];
        if (sql[i] === "'") {
          if (sql[i + 1] === "'") {
            cur += sql[++i];
          } else {
            i++;
            break;
          }
        }
        i++;
      }
      continue;
    }
    if (ch === '$' && sql[i + 1] === '$') {
      // opaque $$-quoted region
      const end = sql.indexOf('$$', i + 2);
      if (end === -1) {
        cur += sql.slice(i);
        i = sql.length;
      } else {
        cur += sql.slice(i, end + 2);
        i = end + 2;
      }
      continue;
    }
    if (ch === ';') {
      if (cur.trim()) statements.push(cur.trim());
      cur = '';
      i++;
      continue;
    }
    cur += ch;
    i++;
  }
  if (cur.trim()) statements.push(cur.trim());
  return statements;
}

// serial family → integer family; common aliases; strip length/precision.
const SQL_TYPE_ALIASES = {
  serial: 'integer',
  serial4: 'integer',
  bigserial: 'bigint',
  serial8: 'bigint',
  smallserial: 'smallint',
  serial2: 'smallint',
  int: 'integer',
  int4: 'integer',
  int8: 'bigint',
  int2: 'smallint',
  bool: 'boolean',
  varchar: 'character varying',
  timestamptz: 'timestamp with time zone',
};

function normalizeSqlType(raw) {
  let t = String(raw || '')
    .toLowerCase()
    .replace(/\([^)]*\)/g, '') // strip length/precision suffix
    .replace(/\s+/g, ' ')
    .trim();
  if (SQL_TYPE_ALIASES[t]) t = SQL_TYPE_ALIASES[t];
  return t;
}

function sqlIdent(raw) {
  // strip optional schema qualifier and quotes; lowercase
  const s = String(raw || '').replace(/"/g, '').trim().toLowerCase();
  const parts = s.split('.');
  return parts[parts.length - 1];
}

// Split a CREATE TABLE body at top-level commas (parens-aware).
function splitTopLevelCommas(body) {
  const items = [];
  let depth = 0;
  let cur = '';
  for (const ch of body) {
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      if (cur.trim()) items.push(cur.trim());
      cur = '';
    } else {
      cur += ch;
    }
  }
  if (cur.trim()) items.push(cur.trim());
  return items;
}

// Keywords that terminate a column's type token sequence.
const SQL_COLDEF_STOPWORDS = new Set([
  'not', 'null', 'default', 'primary', 'references', 'unique', 'check',
  'constraint', 'generated', 'collate',
]);

function parseColumnDef(item) {
  const tokens = item.replace(/\s+/g, ' ').trim().split(' ');
  const name = sqlIdent(tokens[0]);
  const typeTokens = [];
  let i = 1;
  while (i < tokens.length) {
    const t = tokens[i].toLowerCase().replace(/,$/, '');
    if (SQL_COLDEF_STOPWORDS.has(t)) break;
    typeTokens.push(tokens[i]);
    i++;
  }
  const rest = tokens.slice(i).join(' ');
  const col = { name, type: typeTokens.join(' ') };
  const restLc = ` ${rest.toLowerCase()} `;
  col.primaryKey = restLc.includes(' primary key');
  const refM = rest.match(/references\s+([A-Za-z0-9_."]+)\s*(?:\(\s*([A-Za-z0-9_"]+)\s*\))?/i);
  if (refM) {
    col.references = { table: sqlIdent(refM[1]), column: refM[2] ? sqlIdent(refM[2]) : null };
  }
  return col;
}

function parseCreateTable(stmt) {
  const m = stmt.match(/^create\s+table\s+(?:if\s+not\s+exists\s+)?([A-Za-z0-9_."]+)\s*\(([\s\S]*)\)\s*[^)]*$/i);
  if (!m) return null;
  const table = { name: sqlIdent(m[1]), columns: [], pk: [], fks: [] };
  for (const item of splitTopLevelCommas(m[2])) {
    const lc = item.toLowerCase();
    if (/^(constraint\s+[A-Za-z0-9_"]+\s+)?primary\s+key\s*\(/.test(lc)) {
      const pkM = item.match(/primary\s+key\s*\(([^)]*)\)/i);
      if (pkM) table.pk = pkM[1].split(',').map(sqlIdent);
      continue;
    }
    if (/^(constraint\s+[A-Za-z0-9_"]+\s+)?foreign\s+key\s*\(/.test(lc)) {
      const fkM = item.match(/foreign\s+key\s*\(\s*([A-Za-z0-9_"]+)\s*\)\s*references\s+([A-Za-z0-9_."]+)\s*(?:\(\s*([A-Za-z0-9_"]+)\s*\))?/i);
      if (fkM) {
        table.fks.push({
          column: sqlIdent(fkM[1]),
          refTable: sqlIdent(fkM[2]),
          refColumn: fkM[3] ? sqlIdent(fkM[3]) : null,
          source: 'table-constraint',
        });
      }
      continue;
    }
    if (/^(unique|check|exclude|like)\b/.test(lc)) continue; // other table constraints — skipped
    const col = parseColumnDef(item);
    if (!col.name || !col.type) continue; // unparseable — skip, never crash
    table.columns.push({ name: col.name, type: col.type });
    if (col.primaryKey) table.pk.push(col.name);
    if (col.references) {
      table.fks.push({
        column: col.name,
        refTable: col.references.table,
        refColumn: col.references.column,
        source: 'inline',
      });
    }
  }
  return table;
}

function parseAlterTable(stmt) {
  const m = stmt.match(/^alter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?([A-Za-z0-9_."]+)\s+([\s\S]*)$/i);
  if (!m) return null;
  const table = sqlIdent(m[1]);
  const body = m[2];
  const out = { table };
  if (/enable\s+row\s+level\s+security/i.test(body)) out.rlsEnable = true;
  if (/force\s+row\s+level\s+security/i.test(body)) out.rlsForce = true;
  const fkM = body.match(/add\s+constraint\s+[A-Za-z0-9_"]+\s+foreign\s+key\s*\(\s*([A-Za-z0-9_"]+)\s*\)\s*references\s+([A-Za-z0-9_."]+)\s*(?:\(\s*([A-Za-z0-9_"]+)\s*\))?/i);
  if (fkM) {
    out.fk = {
      column: sqlIdent(fkM[1]),
      refTable: sqlIdent(fkM[2]),
      refColumn: fkM[3] ? sqlIdent(fkM[3]) : null,
      source: 'alter-table',
    };
  }
  return out;
}

function parseCreateTrigger(stmt) {
  const m = stmt.match(/^create\s+(?:or\s+replace\s+)?(?:constraint\s+)?trigger\s+([A-Za-z0-9_"]+)[\s\S]*?\son\s+([A-Za-z0-9_."]+)/i);
  if (!m) return null;
  return { name: sqlIdent(m[1]), table: sqlIdent(m[2]) };
}

// Read all .sql files in dir (sorted), parse into a schema model.
// Returns { files, tables: {name → {name, columns, pk, fks, file}},
//           triggers: [{name, table, file}], rls: {table → {enabled, force}},
//           skippedStatements }
function parseSqlFiles(dir) {
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  const model = { files, tables: {}, triggers: [], rls: {}, skippedStatements: 0 };
  for (const file of files) {
    const sql = sqlStripComments(fs.readFileSync(path.join(dir, file), 'utf8'));
    for (const stmt of sqlSplitStatements(sql)) {
      const lc = stmt.toLowerCase();
      if (/^create\s+table\b/.test(lc)) {
        const t = parseCreateTable(stmt);
        if (t) {
          t.file = file;
          model.tables[t.name] = t;
        } else {
          model.skippedStatements++;
        }
      } else if (/^alter\s+table\b/.test(lc)) {
        const a = parseAlterTable(stmt);
        if (!a) {
          model.skippedStatements++;
          continue;
        }
        if (a.rlsEnable || a.rlsForce) {
          const cur = model.rls[a.table] || { enabled: false, force: false };
          model.rls[a.table] = {
            enabled: cur.enabled || !!a.rlsEnable,
            force: cur.force || !!a.rlsForce,
          };
        }
        if (a.fk && model.tables[a.table]) model.tables[a.table].fks.push(a.fk);
        else if (a.fk) {
          model.tables[a.table] = { name: a.table, columns: [], pk: [], fks: [a.fk], file };
        }
        if (!a.rlsEnable && !a.rlsForce && !a.fk) model.skippedStatements++;
      } else if (/^create\s+(or\s+replace\s+)?(constraint\s+)?trigger\b/.test(lc)) {
        const tr = parseCreateTrigger(stmt);
        if (tr) {
          tr.file = file;
          model.triggers.push(tr);
        } else {
          model.skippedStatements++;
        }
      } else {
        // any other statement type: outside the supported subset — skip silently
      }
    }
  }
  return model;
}

// schema-check parse — hidden debug mode: dump the parsed schema model as JSON.
function cmdSchemaCheckParse(args) {
  const flags = parseFlags(args, { migrations: 'value', json: 'bool' });
  const dir = flags.migrations;
  if (!dir) usage('schema-check parse requires --migrations <dir>');
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
    throw new Error(`migrations dir not found: ${dir}`);
  }
  return parseSqlFiles(dir);
}

// ---------------------------------------------------------------------------
// schema-check run — the 3 deterministic checks (M6 Task 2.1b)
//
// Check A (audit trigger): every created table has a CREATE TRIGGER matching
//   --trigger-pattern (default: audit|log). Projects can override the pattern
//   via the flag (a constitution may document a project default — no
//   constitution code integration in M6).
// Check B (RLS): every created table has ALTER TABLE … ENABLE ROW LEVEL
//   SECURITY (warn if no FORCE).
// Check C (FK types): each FK column's normalized type equals the referenced
//   PK column's normalized type (serial→integer etc.).
//
// Owns stdout + exit code: 0 = pass, 1 = findings, 2 = error.
// ---------------------------------------------------------------------------

function cmdSchemaCheckRun(args) {
  const flags = parseFlags(args, {
    migrations: 'value',
    tables: 'value',
    'trigger-pattern': 'value',
    json: 'bool',
  });
  const dir = flags.migrations;
  if (!dir) usage('schema-check run requires --migrations <dir>');

  let model;
  try {
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
      throw new Error(`migrations dir not found: ${dir}`);
    }
    model = parseSqlFiles(dir);
    if (model.files.length === 0) throw new Error(`no .sql files in: ${dir}`);
  } catch (e) {
    process.stderr.write(`error: ${e.message}\n`);
    process.exit(2);
  }

  let triggerPattern;
  try {
    triggerPattern = new RegExp(flags['trigger-pattern'] || 'audit|log', 'i');
  } catch (e) {
    process.stderr.write(`error: invalid --trigger-pattern: ${e.message}\n`);
    process.exit(2);
  }

  const only = flags.tables ? new Set(flags.tables.split(',').map((t) => sqlIdent(t))) : null;
  const tableNames = Object.keys(model.tables).filter((t) => !only || only.has(t));
  if (tableNames.length === 0) {
    process.stderr.write(`error: no matching tables found in migrations\n`);
    process.exit(2);
  }

  const findings = [];
  const warnings = [];
  const lines = [];

  for (const name of tableNames) {
    const table = model.tables[name];
    const tableFindings = [];

    // Check A — audit trigger
    const hasTrigger = model.triggers.some((tr) => tr.table === name && triggerPattern.test(tr.name));
    if (!hasTrigger) {
      tableFindings.push({
        check: 'audit_trigger',
        table: name,
        message: `no CREATE TRIGGER matching /${triggerPattern.source}/i on table "${name}"`,
      });
    }

    // Check B — RLS enabled
    const rls = model.rls[name];
    if (!rls || !rls.enabled) {
      tableFindings.push({
        check: 'rls',
        table: name,
        message: `no ALTER TABLE ${name} ENABLE ROW LEVEL SECURITY found`,
      });
    } else if (!rls.force) {
      warnings.push({
        check: 'rls_force',
        table: name,
        message: `RLS enabled but not FORCEd on "${name}" (table owner bypasses RLS)`,
      });
    }

    // Check C — FK type match
    for (const fk of table.fks) {
      const refTable = model.tables[fk.refTable];
      if (!refTable) {
        warnings.push({
          check: 'fk_type',
          table: name,
          message: `FK ${name}.${fk.column} references unknown table "${fk.refTable}" — skipped`,
        });
        continue;
      }
      const refColName = fk.refColumn || refTable.pk[0];
      const localCol = table.columns.find((c) => c.name === fk.column);
      const refCol = refTable.columns.find((c) => c.name === refColName);
      if (!localCol || !refCol) {
        warnings.push({
          check: 'fk_type',
          table: name,
          message: `FK ${name}.${fk.column} → ${fk.refTable}.${refColName}: column not found — skipped`,
        });
        continue;
      }
      const localType = normalizeSqlType(localCol.type);
      const refType = normalizeSqlType(refCol.type);
      if (localType !== refType) {
        tableFindings.push({
          check: 'fk_type',
          table: name,
          message: `FK type mismatch: ${name}.${fk.column} is ${localType}, but ${fk.refTable}.${refColName} is ${refType}`,
        });
      }
    }

    if (tableFindings.length === 0) {
      lines.push(`PASS  ${name}`);
    } else {
      lines.push(`FAIL  ${name}`);
      for (const f of tableFindings) lines.push(`      - [${f.check}] ${f.message}`);
      findings.push(...tableFindings);
    }
  }

  const status = findings.length === 0 ? 'PASS' : 'FAIL';
  if (flags.json) {
    process.stdout.write(
      JSON.stringify(
        {
          status,
          migrations: dir,
          tables_checked: tableNames,
          findings,
          warnings,
          skipped_statements: model.skippedStatements,
        },
        null,
        2
      ) + '\n'
    );
  } else {
    for (const l of lines) process.stdout.write(`${l}\n`);
    for (const w of warnings) process.stdout.write(`WARN  [${w.check}] ${w.message}\n`);
    process.stdout.write(
      `schema-check: ${status} — ${tableNames.length} table(s), ${findings.length} finding(s), ${warnings.length} warning(s)\n`
    );
  }
  process.exit(findings.length === 0 ? 0 : 1);
}

module.exports = { cmdSchemaCheckParse, cmdSchemaCheckRun };
