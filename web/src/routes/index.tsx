import { createFileRoute } from '@tanstack/react-router'
import { useCallback, useEffect, useState } from 'react'

export const Route = createFileRoute('/')({
  component: HomeView,
})

type HomeSummary = {
  id: string
  name: string
  created_at: number
}

type Member = {
  id: string
  homeId: string
  name: string
}

type Share = {
  id: string
  memberId: string
  memberName: string
  amountCents: number
  paidAt: string | null
}

type Bill = {
  id: string
  homeId: string
  title: string
  totalCents: number
  shares: Share[]
}

type Balance = {
  memberId: string
  name: string
  outstandingCents: number
}

function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`
}

function HomeView() {
  const [homes, setHomes] = useState<HomeSummary[]>([])
  const [activeHomeId, setActiveHomeId] = useState<string>('')
  const [activeHomeName, setActiveHomeName] = useState<string>('')

  const [members, setMembers] = useState<Member[]>([])
  const [bills, setBills] = useState<Bill[]>([])
  const [balances, setBalances] = useState<Balance[]>([])

  const [isLoading, setIsLoading] = useState<boolean>(true)
  const [pageError, setPageError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [actionSuccess, setActionSuccess] = useState<string | null>(null)

  const [payingShareId, setPayingShareId] = useState<string | null>(null)

  const [newHomeName, setNewHomeName] = useState<string>('')
  const [isCreatingHome, setIsCreatingHome] = useState<boolean>(false)

  const [newMemberName, setNewMemberName] = useState<string>('')
  const [isAddingMember, setIsAddingMember] = useState<boolean>(false)

  const [billTitle, setBillTitle] = useState<string>('')
  const [billAmountDollars, setBillAmountDollars] = useState<string>('')
  const [isCreatingBill, setIsCreatingBill] = useState<boolean>(false)

  const loadHomes = useCallback(async () => {
    try {
      const res = await fetch('/api/homes')
      if (!res.ok) throw new Error('Failed to load homes')
      const data = (await res.json()) as { homes: HomeSummary[] }
      setHomes(data.homes)
      const firstHome = data.homes[0]
      if (firstHome && !activeHomeId) {
        setActiveHomeId(firstHome.id)
        setActiveHomeName(firstHome.name)
      }
    } catch {
      // Fallback gracefully without crashing
    }
  }, [activeHomeId])

  const loadHomeData = useCallback(async (homeId: string) => {
    if (!homeId) return
    setIsLoading(true)
    setPageError(null)

    try {
      const [homeRes, membersRes, billsRes, balancesRes] = await Promise.all([
        fetch(`/api/homes/${homeId}`),
        fetch(`/api/homes/${homeId}/members`),
        fetch(`/api/homes/${homeId}/bills`),
        fetch(`/api/homes/${homeId}/balances`),
      ])

      if (homeRes.status === 404) {
        setPageError('Home not found')
        setIsLoading(false)
        return
      }

      if (!homeRes.ok || !membersRes.ok || !billsRes.ok || !balancesRes.ok) {
        throw new Error('Server returned an error while fetching data')
      }

      const homeData = (await homeRes.json()) as { id: string; name: string }
      const membersData = (await membersRes.json()) as { members: Member[] }
      const billsData = (await billsRes.json()) as { bills: Bill[] }
      const balancesData = (await balancesRes.json()) as { balances: Balance[] }

      setActiveHomeName(homeData.name)
      setMembers(membersData.members)
      setBills(billsData.bills)
      setBalances(balancesData.balances)
    } catch (err) {
      setPageError(err instanceof Error ? err.message : 'Unable to connect to the server')
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    loadHomes()
  }, [loadHomes])

  useEffect(() => {
    if (activeHomeId) {
      loadHomeData(activeHomeId)
    } else {
      setIsLoading(false)
    }
  }, [activeHomeId, loadHomeData])

  const handleCreateHome = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newHomeName.trim()) return

    setIsCreatingHome(true)
    setActionError(null)

    try {
      const res = await fetch('/api/homes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newHomeName.trim() }),
      })

      const data = (await res.json()) as { id?: string; name?: string; error?: string }
      if (!res.ok || !data.id) {
        throw new Error(data.error || 'Failed to create home')
      }

      setNewHomeName('')
      setActionSuccess(`Home "${data.name}" created successfully`)
      await loadHomes()
      setActiveHomeId(data.id)
      setActiveHomeName(data.name ?? '')
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Error creating home')
    } finally {
      setIsCreatingHome(false)
    }
  }

  const handleAddMember = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newMemberName.trim() || !activeHomeId) return

    setIsAddingMember(true)
    setActionError(null)

    try {
      const res = await fetch(`/api/homes/${activeHomeId}/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newMemberName.trim() }),
      })

      const data = (await res.json()) as { id?: string; name?: string; error?: string }
      if (!res.ok || !data.id) {
        throw new Error(data.error || 'Failed to add member')
      }

      setNewMemberName('')
      setActionSuccess(`Member "${data.name}" added successfully`)
      await loadHomeData(activeHomeId)
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Error adding member')
    } finally {
      setIsAddingMember(false)
    }
  }

  const handleCreateBill = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!billTitle.trim() || !billAmountDollars || !activeHomeId) return

    const parsedDollars = Number.parseFloat(billAmountDollars)
    if (Number.isNaN(parsedDollars) || parsedDollars <= 0) {
      setActionError('Bill amount must be a positive number')
      return
    }

    const totalCents = Math.round(parsedDollars * 100)
    if (totalCents <= 0) {
      setActionError('Total cents must be greater than zero')
      return
    }

    if (members.length === 0) {
      setActionError('Cannot create a bill: this home has no members yet')
      return
    }

    setIsCreatingBill(true)
    setActionError(null)

    try {
      const res = await fetch(`/api/homes/${activeHomeId}/bills`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: billTitle.trim(),
          totalCents,
        }),
      })

      const data = (await res.json()) as { id?: string; error?: string }
      if (!res.ok || !data.id) {
        throw new Error(data.error || 'Failed to create bill')
      }

      setBillTitle('')
      setBillAmountDollars('')
      setActionSuccess('Bill created and split successfully')
      await loadHomeData(activeHomeId)
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Error creating bill')
    } finally {
      setIsCreatingBill(false)
    }
  }

  const handlePayShare = async (billId: string, shareId: string) => {
    setPayingShareId(shareId)
    setActionError(null)
    setActionSuccess(null)

    const idempotencyKey = crypto.randomUUID()

    try {
      const res = await fetch(`/api/bills/${billId}/shares/${shareId}/pay`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': idempotencyKey,
        },
      })

      const data = (await res.json()) as { id?: string; error?: string; paidAt?: string }
      if (!res.ok) {
        throw new Error(data.error || 'Payment failed')
      }

      setActionSuccess('Payment recorded successfully')
      await loadHomeData(activeHomeId)
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Payment failed. Share remains unpaid.')
    } finally {
      setPayingShareId(null)
    }
  }

  return (
    <div style={styles.container}>
      <header style={styles.header}>
        <div>
          <h1 style={styles.brandTitle}>HomeSplit</h1>
          <p style={styles.brandSubtitle}>Shared Bill Splitter with Idempotent Payments</p>
        </div>
      </header>

      {actionError && (
        <div style={styles.alertError}>
          <span>⚠️ {actionError}</span>
          <button type="button" style={styles.closeBtn} onClick={() => setActionError(null)}>
            ×
          </button>
        </div>
      )}

      {actionSuccess && (
        <div style={styles.alertSuccess}>
          <span>✓ {actionSuccess}</span>
          <button type="button" style={styles.closeBtn} onClick={() => setActionSuccess(null)}>
            ×
          </button>
        </div>
      )}

      <div style={styles.topControlGrid}>
        <div style={styles.card}>
          <h2 style={styles.cardTitle}>Home Selection</h2>
          {homes.length > 0 ? (
            <div style={styles.formGroup}>
              <label htmlFor="home-select" style={styles.label}>
                Active Home:
              </label>
              <select
                id="home-select"
                style={styles.select}
                value={activeHomeId}
                onChange={(e) => {
                  const selected = homes.find((h) => h.id === e.target.value)
                  if (selected) {
                    setActiveHomeId(selected.id)
                    setActiveHomeName(selected.name)
                  }
                }}
              >
                {homes.map((h) => (
                  <option key={h.id} value={h.id}>
                    {h.name}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <p style={styles.emptyNotice}>No homes created yet.</p>
          )}

          <form onSubmit={handleCreateHome} style={styles.inlineForm}>
            <input
              type="text"
              placeholder="New Home Name (e.g. Flat 4B)"
              value={newHomeName}
              onChange={(e) => setNewHomeName(e.target.value)}
              style={styles.input}
              disabled={isCreatingHome}
            />
            <button
              type="submit"
              style={styles.primaryButton}
              disabled={isCreatingHome || !newHomeName.trim()}
            >
              {isCreatingHome ? 'Creating...' : '+ Create Home'}
            </button>
          </form>
        </div>

        {activeHomeId && (
          <div style={styles.card}>
            <h2 style={styles.cardTitle}>Add Member</h2>
            <p style={styles.helperText}>
              Members will receive bill shares in the order they are added.
            </p>
            <form onSubmit={handleAddMember} style={styles.inlineForm}>
              <input
                type="text"
                placeholder="Member Name (e.g. Rahul)"
                value={newMemberName}
                onChange={(e) => setNewMemberName(e.target.value)}
                style={styles.input}
                disabled={isAddingMember}
              />
              <button
                type="submit"
                style={styles.secondaryButton}
                disabled={isAddingMember || !newMemberName.trim()}
              >
                {isAddingMember ? 'Adding...' : '+ Add Member'}
              </button>
            </form>
          </div>
        )}
      </div>

      {activeHomeId && (
        <section style={styles.section}>
          <div style={styles.card}>
            <h2 style={styles.cardTitle}>Outstanding Balances — {activeHomeName}</h2>
            {isLoading ? (
              <p style={styles.emptyNotice}>Loading balances...</p>
            ) : balances.length === 0 ? (
              <p style={styles.emptyNotice}>No members in this home yet.</p>
            ) : (
              <div style={styles.balancesGrid}>
                {balances.map((b) => (
                  <div key={b.memberId} style={styles.balanceItem}>
                    <div style={styles.balanceName}>{b.name}</div>
                    <div
                      style={{
                        ...styles.balanceAmount,
                        color: b.outstandingCents > 0 ? '#b91c1c' : '#15803d',
                      }}
                    >
                      {formatCents(b.outstandingCents)}
                    </div>
                    <div style={styles.balanceStatus}>
                      {b.outstandingCents === 0 ? 'All settled' : 'Unpaid balance'}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      )}

      {activeHomeId && members.length > 0 && (
        <section style={styles.section}>
          <div style={styles.card}>
            <h2 style={styles.cardTitle}>Create & Split New Bill</h2>
            <form onSubmit={handleCreateBill} style={styles.billForm}>
              <div style={{ flex: 2, minWidth: 200 }}>
                <label htmlFor="bill-title" style={styles.label}>
                  Bill Title
                </label>
                <input
                  id="bill-title"
                  type="text"
                  placeholder="e.g. WiFi, Groceries, Electricity"
                  value={billTitle}
                  onChange={(e) => setBillTitle(e.target.value)}
                  style={styles.input}
                  disabled={isCreatingBill}
                />
              </div>

              <div style={{ flex: 1, minWidth: 140 }}>
                <label htmlFor="bill-amount" style={styles.label}>
                  Total Amount ($)
                </label>
                <input
                  id="bill-amount"
                  type="number"
                  step="0.01"
                  min="0.01"
                  placeholder="e.g. 50.00"
                  value={billAmountDollars}
                  onChange={(e) => setBillAmountDollars(e.target.value)}
                  style={styles.input}
                  disabled={isCreatingBill}
                />
              </div>

              <div style={{ alignSelf: 'flex-end' }}>
                <button
                  type="submit"
                  style={styles.primaryButton}
                  disabled={isCreatingBill || !billTitle.trim() || !billAmountDollars}
                >
                  {isCreatingBill ? 'Splitting...' : 'Split Bill Evenly'}
                </button>
              </div>
            </form>
          </div>
        </section>
      )}

      {activeHomeId && (
        <section style={styles.section}>
          <div style={styles.card}>
            <div style={styles.cardHeaderFlex}>
              <h2 style={styles.cardTitle}>Bills & Shares</h2>
              <button
                type="button"
                style={styles.textButton}
                onClick={() => loadHomeData(activeHomeId)}
                disabled={isLoading}
              >
                ↻ Refresh
              </button>
            </div>

            {pageError ? (
              <div style={styles.errorCard}>
                <p>Failed to load data: {pageError}</p>
                <button
                  type="button"
                  style={styles.secondaryButton}
                  onClick={() => loadHomeData(activeHomeId)}
                >
                  Retry
                </button>
              </div>
            ) : isLoading ? (
              <p style={styles.emptyNotice}>Loading bills and shares...</p>
            ) : bills.length === 0 ? (
              <div style={styles.emptyStateContainer}>
                <p style={styles.emptyStateTitle}>No bills yet</p>
                <p style={styles.emptyNotice}>
                  Create your first bill above to automatically split amounts between members.
                </p>
              </div>
            ) : (
              <div style={styles.billsList}>
                {bills.map((bill) => (
                  <div key={bill.id} style={styles.billCard}>
                    <div style={styles.billHeader}>
                      <div>
                        <h3 style={styles.billTitleText}>{bill.title}</h3>
                        <span style={styles.billMeta}>
                          Total: <strong>{formatCents(bill.totalCents)}</strong> (
                          {bill.shares.length} shares)
                        </span>
                      </div>
                    </div>

                    <div style={styles.sharesContainer}>
                      <table style={styles.table}>
                        <thead>
                          <tr>
                            <th style={styles.th}>Member</th>
                            <th style={styles.th}>Share Amount</th>
                            <th style={styles.th}>Status</th>
                            <th style={styles.th}>Action</th>
                          </tr>
                        </thead>
                        <tbody>
                          {bill.shares.map((share) => (
                            <tr key={share.id} style={styles.tr}>
                              <td style={styles.td}>
                                <strong>{share.memberName || 'Member'}</strong>
                              </td>
                              <td style={styles.td}>{formatCents(share.amountCents)}</td>
                              <td style={styles.td}>
                                {share.paidAt ? (
                                  <span style={styles.badgePaid}>Paid</span>
                                ) : (
                                  <span style={styles.badgeUnpaid}>Unpaid</span>
                                )}
                              </td>
                              <td style={styles.td}>
                                {share.paidAt ? (
                                  <span style={styles.paidTimestamp}>
                                    {new Date(share.paidAt).toLocaleTimeString([], {
                                      hour: '2-digit',
                                      minute: '2-digit',
                                    })}
                                  </span>
                                ) : (
                                  <button
                                    type="button"
                                    style={styles.payButton}
                                    onClick={() => handlePayShare(bill.id, share.id)}
                                    disabled={payingShareId === share.id}
                                  >
                                    {payingShareId === share.id ? 'Processing...' : 'Pay Share'}
                                  </button>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      )}
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    maxWidth: 960,
    margin: '0 auto',
    padding: '32px 16px 64px',
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
    color: '#1e293b',
    backgroundColor: '#f8fafc',
    minHeight: '100vh',
  },
  header: {
    marginBottom: 28,
    borderBottom: '1px solid #e2e8f0',
    paddingBottom: 16,
  },
  brandTitle: {
    fontSize: 28,
    fontWeight: 700,
    color: '#0f172a',
    margin: 0,
  },
  brandSubtitle: {
    fontSize: 14,
    color: '#64748b',
    margin: '4px 0 0',
  },
  alertError: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#fee2e2',
    color: '#991b1b',
    padding: '12px 16px',
    borderRadius: 8,
    marginBottom: 20,
    fontSize: 14,
    border: '1px solid #fecaca',
  },
  alertSuccess: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#dcfce7',
    color: '#166534',
    padding: '12px 16px',
    borderRadius: 8,
    marginBottom: 20,
    fontSize: 14,
    border: '1px solid #bbf7d0',
  },
  closeBtn: {
    background: 'none',
    border: 'none',
    fontSize: 18,
    cursor: 'pointer',
    color: 'inherit',
  },
  topControlGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
    gap: 20,
    marginBottom: 24,
  },
  section: {
    marginBottom: 24,
  },
  card: {
    backgroundColor: '#ffffff',
    borderRadius: 12,
    padding: 24,
    boxShadow: '0 1px 3px 0 rgba(0, 0, 0, 0.05), 0 1px 2px 0 rgba(0, 0, 0, 0.03)',
    border: '1px solid #e2e8f0',
  },
  cardHeaderFlex: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: 600,
    color: '#1e293b',
    margin: '0 0 16px',
  },
  formGroup: {
    marginBottom: 16,
  },
  label: {
    display: 'block',
    fontSize: 13,
    fontWeight: 500,
    color: '#475569',
    marginBottom: 6,
  },
  select: {
    width: '100%',
    padding: '10px 12px',
    borderRadius: 6,
    border: '1px solid #cbd5e1',
    fontSize: 14,
    color: '#0f172a',
    backgroundColor: '#fff',
  },
  inlineForm: {
    display: 'flex',
    gap: 8,
  },
  input: {
    flex: 1,
    padding: '9px 12px',
    borderRadius: 6,
    border: '1px solid #cbd5e1',
    fontSize: 14,
    color: '#0f172a',
  },
  primaryButton: {
    backgroundColor: '#2563eb',
    color: '#ffffff',
    border: 'none',
    borderRadius: 6,
    padding: '9px 16px',
    fontSize: 14,
    fontWeight: 500,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  },
  secondaryButton: {
    backgroundColor: '#f1f5f9',
    color: '#334155',
    border: '1px solid #cbd5e1',
    borderRadius: 6,
    padding: '9px 16px',
    fontSize: 14,
    fontWeight: 500,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  },
  textButton: {
    background: 'none',
    border: 'none',
    color: '#2563eb',
    fontSize: 13,
    fontWeight: 500,
    cursor: 'pointer',
  },
  helperText: {
    fontSize: 13,
    color: '#64748b',
    margin: '0 0 12px',
  },
  emptyNotice: {
    color: '#64748b',
    fontSize: 14,
    margin: 0,
  },
  balancesGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
    gap: 16,
  },
  balanceItem: {
    backgroundColor: '#f8fafc',
    padding: 16,
    borderRadius: 8,
    border: '1px solid #e2e8f0',
  },
  balanceName: {
    fontSize: 14,
    fontWeight: 600,
    color: '#334155',
  },
  balanceAmount: {
    fontSize: 22,
    fontWeight: 700,
    margin: '6px 0 2px',
  },
  balanceStatus: {
    fontSize: 12,
    color: '#64748b',
  },
  billForm: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 16,
    alignItems: 'flex-start',
  },
  billsList: {
    display: 'flex',
    flexDirection: 'column',
    gap: 16,
  },
  billCard: {
    border: '1px solid #e2e8f0',
    borderRadius: 8,
    overflow: 'hidden',
  },
  billHeader: {
    backgroundColor: '#f8fafc',
    padding: '12px 16px',
    borderBottom: '1px solid #e2e8f0',
  },
  billTitleText: {
    margin: 0,
    fontSize: 16,
    fontWeight: 600,
    color: '#0f172a',
  },
  billMeta: {
    fontSize: 13,
    color: '#64748b',
  },
  sharesContainer: {
    padding: 0,
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse',
    fontSize: 14,
  },
  th: {
    textAlign: 'left',
    padding: '10px 16px',
    backgroundColor: '#ffffff',
    color: '#64748b',
    fontWeight: 500,
    borderBottom: '1px solid #e2e8f0',
    fontSize: 13,
  },
  tr: {
    borderBottom: '1px solid #f1f5f9',
  },
  td: {
    padding: '12px 16px',
    color: '#1e293b',
  },
  badgePaid: {
    backgroundColor: '#dcfce7',
    color: '#166534',
    padding: '3px 8px',
    borderRadius: 9999,
    fontSize: 12,
    fontWeight: 500,
  },
  badgeUnpaid: {
    backgroundColor: '#fee2e2',
    color: '#991b1b',
    padding: '3px 8px',
    borderRadius: 9999,
    fontSize: 12,
    fontWeight: 500,
  },
  payButton: {
    backgroundColor: '#0284c7',
    color: '#fff',
    border: 'none',
    borderRadius: 4,
    padding: '6px 12px',
    fontSize: 12,
    fontWeight: 500,
    cursor: 'pointer',
  },
  paidTimestamp: {
    fontSize: 12,
    color: '#94a3b8',
  },
  emptyStateContainer: {
    textAlign: 'center',
    padding: '32px 16px',
  },
  emptyStateTitle: {
    fontSize: 16,
    fontWeight: 600,
    color: '#334155',
    margin: '0 0 6px',
  },
  errorCard: {
    backgroundColor: '#fef2f2',
    border: '1px solid #fecaca',
    padding: 16,
    borderRadius: 8,
    color: '#991b1b',
    fontSize: 14,
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
    alignItems: 'flex-start',
  },
}
