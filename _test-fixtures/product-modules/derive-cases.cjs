'use strict';
// Shared in-memory roadmap frontmatter cases for run-derive.sh (spec 023 W2).
// Expected values live in run-derive.sh as literals, hand-calculated.
const ms = (id, status, module) => ({ id, title: `T-${id}`, status, target: '2027-01', ...(module ? { module } : {}) });
const ft = (id, milestone, status, deps = [], stage = null) => ({ id, milestone, title: `F-${id}`, status, stage, depends_on: deps });

const cases = {
  // no module anywhere: golden baseline (cursor present, in-flight present)
  plain: {
    project: 'p', title: 'Plain', status: 'active', next: '002',
    milestones: [ms('P1', 'in-progress'), ms('P2', 'planned')],
    features: [ft('001', 'P1', 'done'), ft('002', 'P1', 'in-flight', ['001'], 'plan'), ft('003', 'P1', 'planned', ['001']), ft('004', 'P2', 'planned', ['003'])],
  },
  // no module anywhere: cursor null
  plainDone: {
    project: 'p', title: 'PlainDone', status: 'active', next: null,
    milestones: [ms('P1', 'done')],
    features: [ft('001', 'P1', 'done'), ft('002', 'P1', 'cancelled')],
  },
  // 3 modules, done milestone mid-module, cancelled feature, cross-module dep
  three: {
    project: 'p', title: 'Three', status: 'active', next: '020',
    modules: ['immobilien', 'crm-core', 'platform'],
    milestones: [
      ms('M1', 'done', 'immobilien'), ms('M2', 'in-progress', 'immobilien'), ms('M3', 'planned', 'immobilien'),
      ms('C1', 'in-progress', 'crm-core'), ms('X1', 'planned', 'platform'),
    ],
    features: [
      ft('010', 'M1', 'done'),
      ft('011', 'M2', 'cancelled'),
      ft('012', 'M2', 'in-flight', ['010'], 'execute'), // in-flight is eligible (same rule as project cursor) -> immobilien cursor 012
      ft('013', 'M2', 'planned', ['020']),     // blocked by crm-core 020 (in-flight)
      ft('014', 'M3', 'planned', ['010']),     // later feature, not the cursor
      ft('020', 'C1', 'in-flight', [], 'plan'),
      ft('021', 'C1', 'planned', ['020']),     // blocked by in-flight 020
      ft('030', 'X1', 'done'),
      ft('031', 'X1', 'planned', ['030']),     // eligible -> platform cursor 031
    ],
  },
  // immobilien: first open feature blocked by cross-module dep, later one also blocked
  blocked: {
    project: 'p', title: 'Blocked', status: 'active', next: null,
    modules: ['immobilien', 'crm-core'],
    milestones: [ms('M1', 'in-progress', 'immobilien'), ms('C1', 'in-progress', 'crm-core')],
    features: [
      ft('062', 'M1', 'planned', ['070', '071']),  // first open; first unmet dep = 070
      ft('063', 'M1', 'planned', ['071']),
      ft('070', 'C1', 'in-flight', [], 'execute'),
      ft('071', 'C1', 'planned'),
    ],
  },
  // 4 modules, independent first features
  four: {
    project: 'p', title: 'Four', status: 'active', next: null,
    milestones: ['a', 'b', 'c', 'd'].map((m, i) => ms(`E${i}`, 'planned', m)),
    features: ['a', 'b', 'c', 'd'].flatMap((m, i) => [ft(`${i}01`, `E${i}`, 'planned'), ft(`${i}02`, `E${i}`, 'planned', [`${i}01`])]),
  },
  // AC-5a: module one eligible, module two (zero features), one untagged milestone; modules list order differs from appearance
  ac5a: {
    project: 'p', title: 'Ac5a', status: 'active', next: '001',
    modules: ['zeta', 'alpha'],
    milestones: [ms('A1', 'planned', 'alpha'), ms('Z1', 'planned', 'zeta'), ms('U1', 'planned')],
    features: [ft('001', 'Z1', 'planned'), ft('002', 'U1', 'planned')],
  },
  // roadmap-order first feature of alpha is blocked by cross-module dep (beta 201 in-flight);
  // alpha's cursor must skip it and land on 102. 301 depends on an untagged-milestone feature.
  cross: {
    project: 'p', title: 'Cross', status: 'active', next: null,
    modules: ['alpha', 'beta', 'gamma'],
    milestones: [ms('A1', 'planned', 'alpha'), ms('B1', 'planned', 'beta'), ms('G1', 'planned', 'gamma'), ms('U1', 'planned')],
    features: [
      ft('101', 'A1', 'planned', ['201']), ft('102', 'A1', 'planned'),
      ft('201', 'B1', 'in-flight', [], 'plan'),
      ft('301', 'G1', 'planned', ['401']),
      ft('401', 'U1', 'planned'),
    ],
  },
  // zero-feature module + all-done module
  empty: {
    project: 'p', title: 'Empty', status: 'active', next: null,
    milestones: [ms('E1', 'planned', 'nofeat'), ms('D1', 'done', 'alldone')],
    features: [ft('001', 'D1', 'done'), ft('002', 'D1', 'cancelled')],
  },
};
module.exports = { cases };
