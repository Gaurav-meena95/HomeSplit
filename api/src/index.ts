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

export default app
