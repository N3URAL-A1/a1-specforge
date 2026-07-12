'use strict';

const { parseFlags, nowIso } = require('./io.cjs');
const { usage } = require('./help.cjs');
const {
  reservationsFile,
  loadReservations,
  acquireReservationsLock,
  exitWithLock,
  writeJsonAtomic,
} = require('./locks.cjs');

function cmdCheckReservations(args) {
  const flags = parseFlags(args, {
    claim: 'value',
    by: 'value',
    file: 'value',
    list: 'bool',
    release: 'bool',
  });
  const file = reservationsFile(flags);

  if (flags.list) {
    const data = loadReservations(file);
    const out = { file, count: data.reservations.length, reservations: data.reservations };
    process.stdout.write(JSON.stringify(out, null, 2) + '\n');
    process.exit(0);
  }

  if (flags.release) {
    if (!flags.by) {
      usage('check reservations --release requires --by <spec-id> (optionally --claim <type>:<value>)');
    }
    const by = flags.by;
    let type = null;
    let value = null;
    if (flags.claim) {
      const relIdx = flags.claim.indexOf(':');
      if (relIdx <= 0 || relIdx === flags.claim.length - 1) {
        usage(`check reservations --claim must be <type>:<value> (got: ${flags.claim})`);
      }
      type = flags.claim.slice(0, relIdx);
      value = flags.claim.slice(relIdx + 1);
    }
    const lockPath = acquireReservationsLock(file);
    const data = loadReservations(file);

    if (flags.claim) {
      const existing = data.reservations.find((r) => r.type === type && r.value === value);
      if (existing && existing.by !== by) {
        const out = {
          status: 'FORBIDDEN',
          file,
          claim: { type, value, by },
          held_by: existing.by,
        };
        process.stdout.write(JSON.stringify(out, null, 2) + '\n');
        process.stderr.write(
          `cannot release: ${type}:${value} is held by ${existing.by}, not ${by}\n`
        );
        exitWithLock(lockPath, 1);
      }
    }

    const matches = flags.claim
      ? data.reservations.filter((r) => r.type === type && r.value === value)
      : data.reservations.filter((r) => r.by === by);

    if (matches.length === 0) {
      const out = { status: 'OK', file, released: [], idempotent: true, note: 'nothing to release' };
      process.stdout.write(JSON.stringify(out, null, 2) + '\n');
      exitWithLock(lockPath, 0);
    }

    const removed = matches.filter((r) => r.by === by);
    const remaining = data.reservations.filter(
      (r) => !removed.some((m) => m === r)
    );
    writeJsonAtomic(file, { ...data, reservations: remaining });
    const out = { status: 'OK', file, released: removed, idempotent: false };
    process.stdout.write(JSON.stringify(out, null, 2) + '\n');
    exitWithLock(lockPath, 0);
  }

  if (!flags.claim || !flags.by) {
    usage('check reservations requires --claim <type>:<value> --by <spec-id> (or --list)');
  }
  const idx = flags.claim.indexOf(':');
  if (idx <= 0 || idx === flags.claim.length - 1) {
    usage(`check reservations --claim must be <type>:<value> (got: ${flags.claim})`);
  }
  const type = flags.claim.slice(0, idx);
  const value = flags.claim.slice(idx + 1);
  const by = flags.by;

  const data = loadReservations(file);
  const existing = data.reservations.find((r) => r.type === type && r.value === value);

  if (existing) {
    if (existing.by === by) {
      const out = { status: 'OK', idempotent: true, file, reservation: existing };
      process.stdout.write(JSON.stringify(out, null, 2) + '\n');
      process.exit(0);
    }
    const out = {
      status: 'CONFLICT',
      file,
      claim: { type, value, by },
      held_by: existing.by,
      holder: existing,
    };
    process.stdout.write(JSON.stringify(out, null, 2) + '\n');
    process.stderr.write(
      `conflict: ${type}:${value} already reserved by ${existing.by} (at ${existing.at})\n`
    );
    process.exit(1);
  }

  const reservation = { type, value, by, at: nowIso() };
  const next = { reservations: [...data.reservations, reservation] };
  writeJsonAtomic(file, next);
  const out = { status: 'OK', idempotent: false, file, reservation };
  process.stdout.write(JSON.stringify(out, null, 2) + '\n');
  process.exit(0);
}

module.exports = { cmdCheckReservations };
