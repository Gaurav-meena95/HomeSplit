import { Hono } from 'hono'

const app = new Hono<{ Bindings: Env }>()

app.get('/api/health', (c) => c.json({ status: 'ok' }))

app.post('/api/homes', async (c) => {
  const body = await c.req.json<{ name?: string }>().catch(() => null)
  if (!body || typeof body.name !== 'string' || body.name.trim() === '') {
    return c.json({ error: 'Name is required' }, 400)
  }

  const id = crypto.randomUUID()
  const name = body.name.trim()
  const createdAt = Date.now()

  await c.env.DB.prepare('INSERT INTO homes (id, name, created_at) VALUES (?, ?, ?)')
    .bind(id, name, createdAt)
    .run()

  return c.json({ id, name }, 201)
})

app.post('/api/homes/:homeId/members', async (c) => {
  const homeId = c.req.param('homeId')
  const body = await c.req.json<{ name?: string }>().catch(() => null)
  if (!body || typeof body.name !== 'string' || body.name.trim() === '') {
    return c.json({ error: 'Name is required' }, 400)
  }

  const home = await c.env.DB.prepare('SELECT id FROM homes WHERE id = ?').bind(homeId).first()
  if (!home) {
    return c.json({ error: 'Home not found' }, 404)
  }

  const id = crypto.randomUUID()
  const name = body.name.trim()
  const createdAt = Date.now()

  await c.env.DB.prepare('INSERT INTO members (id, home_id, name, created_at) VALUES (?, ?, ?, ?)')
    .bind(id, homeId, name, createdAt)
    .run()

  return c.json({ id, homeId, name }, 201)
})

app.post('/api/homes/:homeId/bills', async (c) => {
  const homeId = c.req.param('homeId')
  const body = await c.req.json<{ title?: unknown; totalCents?: unknown }>().catch(() => null)

  const home = await c.env.DB.prepare('SELECT id FROM homes WHERE id = ?').bind(homeId).first()
  if (!home) {
    return c.json({ error: 'Home not found' }, 404)
  }

  if (
    !body ||
    typeof body.totalCents !== 'number' ||
    !Number.isInteger(body.totalCents) ||
    body.totalCents <= 0
  ) {
    return c.json({ error: 'totalCents must be a positive integer' }, 422)
  }

  const title =
    typeof body.title === 'string' && body.title.trim() !== '' ? body.title.trim() : 'Bill'

  const members = await c.env.DB.prepare(
    'SELECT id FROM members WHERE home_id = ? ORDER BY rowid ASC',
  )
    .bind(homeId)
    .all<{ id: string }>()

  if (!members.results || members.results.length === 0) {
    return c.json({ error: 'Home has no members' }, 422)
  }

  const memberList = members.results
  const totalCents = body.totalCents
  const memberCount = memberList.length
  const baseShare = Math.floor(totalCents / memberCount)
  const remainder = totalCents % memberCount

  const billId = crypto.randomUUID()
  const now = Date.now()

  const shares = memberList.map((member, index) => {
    const shareId = crypto.randomUUID()
    const amountCents = baseShare + (index < remainder ? 1 : 0)
    return {
      id: shareId,
      memberId: member.id,
      amountCents,
      paidAt: null,
    }
  })

  const insertBill = c.env.DB.prepare(
    'INSERT INTO bills (id, home_id, title, total_cents, created_at) VALUES (?, ?, ?, ?, ?)',
  ).bind(billId, homeId, title, totalCents, now)

  const insertShares = shares.map((share) =>
    c.env.DB.prepare(
      'INSERT INTO shares (id, bill_id, member_id, amount_cents, paid_at, idempotency_key, created_at) VALUES (?, ?, ?, ?, NULL, NULL, ?)',
    ).bind(share.id, billId, share.memberId, share.amountCents, now),
  )

  await c.env.DB.batch([insertBill, ...insertShares])

  return c.json(
    {
      id: billId,
      homeId,
      title,
      totalCents,
      shares,
    },
    201,
  )
})

app.post('/api/bills/:billId/shares/:shareId/pay', async (c) => {
  const billId = c.req.param('billId')
  const shareId = c.req.param('shareId')
  const idempotencyKey = c.req.header('idempotency-key')?.trim()

  if (!idempotencyKey) {
    return c.json({ error: 'Idempotency-Key header is required' }, 400)
  }

  const bill = await c.env.DB.prepare('SELECT id FROM bills WHERE id = ?').bind(billId).first()
  if (!bill) {
    return c.json({ error: 'Bill not found' }, 404)
  }

  const share = await c.env.DB.prepare(
    'SELECT id, member_id, amount_cents, paid_at, idempotency_key FROM shares WHERE id = ? AND bill_id = ?',
  )
    .bind(shareId, billId)
    .first<{
      id: string
      member_id: string
      amount_cents: number
      paid_at: string | null
      idempotency_key: string | null
    }>()

  if (!share) {
    return c.json({ error: 'Share not found' }, 404)
  }

  if (share.paid_at !== null) {
    if (share.idempotency_key === idempotencyKey) {
      return c.json({
        id: share.id,
        memberId: share.member_id,
        amountCents: share.amount_cents,
        paidAt: share.paid_at,
      })
    }
    return c.json({ error: 'Share has already been paid' }, 409)
  }

  const nowIso = new Date().toISOString()
  const result = await c.env.DB.prepare(
    'UPDATE shares SET paid_at = ?, idempotency_key = ? WHERE id = ? AND bill_id = ? AND paid_at IS NULL',
  )
    .bind(nowIso, idempotencyKey, shareId, billId)
    .run()

  if (result.meta.changes === 0) {
    const refreshed = await c.env.DB.prepare(
      'SELECT id, member_id, amount_cents, paid_at, idempotency_key FROM shares WHERE id = ? AND bill_id = ?',
    )
      .bind(shareId, billId)
      .first<{
        id: string
        member_id: string
        amount_cents: number
        paid_at: string | null
        idempotency_key: string | null
      }>()

    if (refreshed && refreshed.idempotency_key === idempotencyKey) {
      return c.json({
        id: refreshed.id,
        memberId: refreshed.member_id,
        amountCents: refreshed.amount_cents,
        paidAt: refreshed.paid_at,
      })
    }
    return c.json({ error: 'Share has already been paid' }, 409)
  }

  return c.json({
    id: share.id,
    memberId: share.member_id,
    amountCents: share.amount_cents,
    paidAt: nowIso,
  })
})

app.get('/api/homes/:homeId/balances', async (c) => {
  const homeId = c.req.param('homeId')

  const home = await c.env.DB.prepare('SELECT id FROM homes WHERE id = ?').bind(homeId).first()
  if (!home) {
    return c.json({ error: 'Home not found' }, 404)
  }

  const balances = await c.env.DB.prepare(
    `SELECT
      m.id AS memberId,
      m.name,
      COALESCE((
        SELECT SUM(s.amount_cents)
        FROM shares s
        JOIN bills b ON b.id = s.bill_id
        WHERE s.member_id = m.id
          AND b.home_id = m.home_id
          AND s.paid_at IS NULL
      ), 0) AS outstandingCents
    FROM members m
    WHERE m.home_id = ?
    ORDER BY m.rowid ASC`,
  )
    .bind(homeId)
    .all<{ memberId: string; name: string; outstandingCents: number }>()

  return c.json({ balances: balances.results ?? [] })
})

app.get('/api/homes/:homeId/bills', async (c) => {
  const homeId = c.req.param('homeId')

  const home = await c.env.DB.prepare('SELECT id FROM homes WHERE id = ?').bind(homeId).first()
  if (!home) {
    return c.json({ error: 'Home not found' }, 404)
  }

  const billsQuery = await c.env.DB.prepare(
    'SELECT id, home_id, title, total_cents FROM bills WHERE home_id = ? ORDER BY rowid DESC',
  )
    .bind(homeId)
    .all<{ id: string; home_id: string; title: string; total_cents: number }>()

  const bills = billsQuery.results ?? []

  const sharesQuery = await c.env.DB.prepare(
    `SELECT s.id, s.bill_id, s.member_id, m.name AS member_name, s.amount_cents, s.paid_at
     FROM shares s
     JOIN bills b ON b.id = s.bill_id
     JOIN members m ON m.id = s.member_id
     WHERE b.home_id = ?
     ORDER BY s.rowid ASC`,
  )
    .bind(homeId)
    .all<{
      id: string
      bill_id: string
      member_id: string
      member_name: string
      amount_cents: number
      paid_at: string | null
    }>()

  const shares = sharesQuery.results ?? []

  const formattedBills = bills.map((bill) => ({
    id: bill.id,
    homeId: bill.home_id,
    title: bill.title,
    totalCents: bill.total_cents,
    shares: shares
      .filter((s) => s.bill_id === bill.id)
      .map((s) => ({
        id: s.id,
        memberId: s.member_id,
        memberName: s.member_name,
        amountCents: s.amount_cents,
        paidAt: s.paid_at,
      })),
  }))

  return c.json({ bills: formattedBills })
})

export default app
