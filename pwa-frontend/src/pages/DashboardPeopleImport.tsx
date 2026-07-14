import React, { useState } from 'react'
import { executable } from '../lib/squidClient'

export default function DashboardPeopleImport() {
  const [csvUrl, setCsvUrl] = useState('')
  const [csvText, setCsvText] = useState('')
  const [result, setResult] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const importFromUrl = async () => {
    setLoading(true)
    setResult(null)
    try {
      const fn = executable('AerostackService', 'importPeopleFromCsvUrl')
      const res = await fn({ url: csvUrl })
      setResult(JSON.stringify(res, null, 2))
    } catch (e: any) {
      setResult(e?.message || 'Failed')
    } finally {
      setLoading(false)
    }
  }

  const importFromText = async () => {
    setLoading(true)
    setResult(null)
    try {
      const fn = executable('AerostackService', 'importPeopleFromCsv')
      const res = await fn({ csv: csvText })
      setResult(JSON.stringify(res, null, 2))
    } catch (e: any) {
      setResult(e?.message || 'Failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ padding: 16 }}>
      <h1>People Import</h1>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 12, maxWidth: 720 }}>
        <label style={{ display: 'flex', flexDirection: 'column' }}>
          <span>Google Sheets CSV URL</span>
          <input value={csvUrl} onChange={e => setCsvUrl(e.target.value)} placeholder="https://docs.google.com/spreadsheets/d/.../export?format=csv" />
        </label>
        <div>
          <button onClick={importFromUrl} disabled={loading || !csvUrl}>Import from URL</button>
        </div>
        <label style={{ display: 'flex', flexDirection: 'column' }}>
          <span>Paste CSV</span>
          <textarea rows={10} value={csvText} onChange={e => setCsvText(e.target.value)} />
        </label>
        <div>
          <button onClick={importFromText} disabled={loading || !csvText.trim()}>Import from Text</button>
        </div>
      </div>
      {result && (
        <pre style={{ marginTop: 16, padding: 12, background: '#111', color: '#0f0', whiteSpace: 'pre-wrap' }}>{result}</pre>
      )}
    </div>
  )
}
