// Sync Airtable -> camps-snapshot.json (sanitized, deduped, pink-priority)
// Env: AIRTABLE_TOKEN (read scope). Base/table are public-safe ids.
const BASE = 'app8o7hgpxr6xx2Rt';
const TABLE = 'tblsnIjiFlezdL4C2';
const TOKEN = process.env.AIRTABLE_TOKEN;
if (!TOKEN) { console.error('AIRTABLE_TOKEN missing'); process.exit(1); }

const STATUS_MAP = { Orange: 'registered', Purple: 'consent_policy', Pink: 'bed_talk' };
const RANK = { registered: 1, consent_policy: 2, bed_talk: 3 };

function normName(n) {
  return (n || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function snapAddress(raw) {
  if (!raw) return null;
  const s = String(raw).trim();
  if (/center\s*camp/i.test(s)) return '5:59 & A+';
  if (/9:?00.*g\s*plaza|g\s*plaza.*9/i.test(s)) return '8:59 & G-';
  let hh, mm;
  let m = s.match(/(\d{1,2})(?::(\d{2}))?\s*(?:&|and|@)?\s*(esplanade|[a-j])\b/i);
  let streetTok;
  if (m) { hh = parseInt(m[1], 10); mm = m[2] ? parseInt(m[2], 10) : 0; streetTok = m[3]; }
  else {
    m = s.match(/\b(esplanade|[a-j])\s*(?:&|and|@)?\s*(\d{1,2})(?::(\d{2}))?\b/i);
    if (!m) return null;
    streetTok = m[1]; hh = parseInt(m[2], 10); mm = m[3] ? parseInt(m[3], 10) : 0;
  }
  if (hh === 10 && mm === 0) { hh = 9; mm = 30; }   // city edge -> last block
  else mm = mm < 30 ? 0 : 30;                        // floor to block grid
  if (hh < 2 || hh > 9) return null;
  const street = streetTok.length === 1 ? streetTok.toUpperCase() : 'Esplanade';
  return `${hh}:${mm === 0 ? '00' : '30'} & ${street}`;
}

async function fetchAll() {
  let records = [], offset;
  do {
    const url = new URL(`https://api.airtable.com/v0/${BASE}/${TABLE}`);
    url.searchParams.set('pageSize', '100');
    if (offset) url.searchParams.set('offset', offset);
    const r = await fetch(url, { headers: { Authorization: `Bearer ${TOKEN}` } });
    if (!r.ok) throw new Error(`Airtable ${r.status}: ${await r.text()}`);
    const j = await r.json();
    records = records.concat(j.records);
    offset = j.offset;
  } while (offset);
  return records;
}

const records = await fetchAll();
const byName = new Map();
for (const rec of records) {
  const f = rec.fields || {};
  const name = (f['Camp Name'] || '').trim();
  if (!name || name.length < 2) continue;
  if (/^(test|n\/?a|1|tba|asdf|none)$/i.test(name)) continue;
  const status = STATUS_MAP[f['Status']] || 'registered';
  const rawAddr = f['Camp Address'] || f['Address'] || '';
  const key = normName(name);
  const cur = byName.get(key);
  const cand = { name, status, rawAddr: String(rawAddr).trim() };
  if (!cur) { byName.set(key, cand); continue; }
  const better =
    RANK[cand.status] > RANK[cur.status] ||
    (RANK[cand.status] === RANK[cur.status] && !snapAddress(cur.rawAddr) && snapAddress(cand.rawAddr));
  if (better) byName.set(key, { ...cand, name: cur.name.length >= cand.name.length ? cur.name : cand.name });
}

const camps = [...byName.values()]
  .sort((a, b) => a.name.localeCompare(b.name))
  .map((c, i) => {
    const snapped = snapAddress(c.rawAddr);
    const original = c.rawAddr || '(address needed)';
    return {
      id: `2026-${String(i + 1).padStart(3, '0')}`,
      camp_name: c.name,
      placement_address: snapped || original,
      original_address: original,
      bed_status: c.status,
      user_name: null, email: null, buddy_name: null, phone: null,
      pronouns: null, camper_count: null, wants_buddy: null, notes: null, created_at: null
    };
  });

const stats = { none: 0, registered: 0, consent_policy: 0, bed_talk: 0 };
for (const c of camps) stats[c.bed_status]++;

const snapshot = {
  metadata: {
    generatedAt: new Date().toISOString(),
    source: 'airtable_2026_sync',
    tableName: '2026',
    privacy: 'Camp name, address, and BED status only. No personal information.',
    totalCamps: camps.length,
    stats
  },
  camps
};

import { writeFileSync } from 'node:fs';
writeFileSync('app/src/data/camps-snapshot.json', JSON.stringify(snapshot, null, 2) + '\n');
console.log(`snapshot written: ${camps.length} camps`, stats);
