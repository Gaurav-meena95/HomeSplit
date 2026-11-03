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

export default app
