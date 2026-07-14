import React, { useEffect, useMemo, useState } from 'react'
import { fetchAuthSession } from 'aws-amplify/auth';
import { useDispatch } from 'react-redux'
import type { AppDispatch } from '../../store'
import type { ScoreOutcomeRequest } from '@enterprise/common'
import { scoreOutcome, fetchLoops } from '../../features/loops/loops.slice'

interface Props {
  loopId: string
  open: boolean
  onClose: () => void
}

export const ScoreModal: React.FC<Props> = ({ loopId, open, onClose }) => {
  const dispatch = useDispatch<AppDispatch>()
  const [outcome, setOutcome] = useState<number>(3)
  const [contributorsText, setContributorsText] = useState('')
  const [lessonAbstract, setLessonAbstract] = useState('')
  const [lessonTags, setLessonTags] = useState('')
  const [lessonReuse, setLessonReuse] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sessionEmail, setSessionEmail] = useState('')

  useEffect(() => {
    const loadEmail = async () => {
      try {
        const session = await fetchAuthSession({ forceRefresh: false });
        const email = session.tokens?.idToken?.payload?.email || session.tokens?.accessToken?.payload?.username || "";
        setSessionEmail(String(email));
      } catch (err) {
        console.warn("Failed to load session email", err);
      }
    };
    loadEmail();
  }, []);

  const contributors = useMemo(() => {
    try {
      if (!contributorsText.trim()) return []
      const parsed = JSON.parse(contributorsText)
      if (Array.isArray(parsed)) return parsed
      return []
    } catch {
      return []
    }
  }, [contributorsText])

  if (!open) return null

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitting(true)
    setError(null)
    try {
      const req: ScoreOutcomeRequest = {
        loop_id: loopId,
        outcome_score: outcome,
        contributors: contributors.length ? contributors : undefined,
        lesson: lessonAbstract
          ? { abstract: lessonAbstract, tags: lessonTags.split(',').map(t => t.trim()).filter(Boolean), reuse_notes: lessonReuse || undefined }
          : undefined,
        updated_by: sessionEmail || undefined,
      } as any
      await dispatch(scoreOutcome(req)).unwrap()
      await dispatch(fetchLoops())
      onClose()
    } catch (err: any) {
      setError(err?.message || 'Failed to score outcome')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
      <div style={{ background: '#111', color: '#fff', padding: 20, borderRadius: 8, width: 'min(720px, 96vw)' }}>
        <h2 style={{ marginTop: 0 }}>Score Outcome</h2>
        <form onSubmit={submit}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <label style={{ display: 'flex', flexDirection: 'column' }}>
              <span>Outcome (1–5)</span>
              <select value={outcome} onChange={e => setOutcome(parseInt(e.target.value))}>
                {[1,2,3,4,5].map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </label>
            <label style={{ gridColumn: '1 / span 2', display: 'flex', flexDirection: 'column' }}>
              <span>Contributors JSON (array of objects with keys: email, share)</span>
              <textarea rows={3} value={contributorsText} onChange={e => setContributorsText(e.target.value)} placeholder='[{"email":"x@enterprise.io","share":0.25}]' />
            </label>
            <label style={{ gridColumn: '1 / span 2', display: 'flex', flexDirection: 'column' }}>
              <span>Lesson Abstract</span>
              <textarea rows={3} maxLength={280} value={lessonAbstract} onChange={e => setLessonAbstract(e.target.value)} />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column' }}>
              <span>Lesson Tags (comma-separated)</span>
              <input value={lessonTags} onChange={e => setLessonTags(e.target.value)} placeholder='aws, cost-optimization' />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column' }}>
              <span>Lesson Reuse Notes</span>
              <input value={lessonReuse} onChange={e => setLessonReuse(e.target.value)} />
            </label>
          </div>
          {error && <p style={{ color: '#f66' }}>{error}</p>}
          <div style={{ display: 'flex', gap: 8, marginTop: 16, justifyContent: 'flex-end' }}>
            <button type="button" onClick={onClose} disabled={submitting}>Cancel</button>
            <button type="submit" disabled={submitting}>Save</button>
          </div>
        </form>
      </div>
    </div>
  )
}
