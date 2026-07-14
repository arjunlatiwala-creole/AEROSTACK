import React, {useEffect} from 'react'
import { getTagCloud } from '@/features/loops/loops.api'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { X } from 'lucide-react'

interface Props {
  value: string[]
  onChange: (tags: string[]) => void
  placeholder?: string
}

export const TagInput: React.FC<Props> = ({ value, onChange, placeholder }) => {
  const [all, setAll] = React.useState<string[]>([])
  const [input, setInput] = React.useState('')
  const [suggestions, setSuggestions] = React.useState<string[]>([])

  useEffect(() => {
    (async () => {
      try {
        const cloud = await getTagCloud()
        setAll(cloud.map(c => c.tag))
      } catch {}
    })()
  }, [])

  useEffect(() => {
    const q = input.trim().toLowerCase()
    setSuggestions(
      q
        ? all.filter(t => t.toLowerCase().includes(q) && !value.includes(t)).slice(0, 8)
        : []
    )
  }, [input, all, value])

  const add = (t: string) => {
    const next = Array.from(new Set([...value, t.trim()])).filter(Boolean)
    onChange(next)
    setInput('')
  }
  const remove = (t: string) => onChange(value.filter(v => v !== t))

  return (
    <div>
      <div className="flex flex-wrap gap-2">
        {value.map(t => (
          <Badge key={t} variant="secondary" className="group">
            {t}
            <Button
              variant="ghost"
              size="icon"
              className="ml-1 h-4 w-4 p-0 group-hover:bg-destructive/10"
              onClick={(e) => {
                e.stopPropagation()
                remove(t)
              }}
            >
              <X className="h-3 w-3" />
            </Button>
          </Badge>
        ))}
      </div>

      <Input
        type="text"
        value={input}
        onChange={e => setInput(e.target.value)}
        placeholder={placeholder || 'revgen, AWS'}
        onKeyDown={e => {
          if (e.key === 'Enter' && input.trim()) {
            e.preventDefault()
            add(input)
          }
        }}

      />

      {suggestions.length > 0 && (
        <div className="rounded-md border border-border bg-card p-2 shadow-sm">
          <div className="flex flex-wrap gap-1.5">
            {suggestions.map(s => (
              <Button
                key={s}
                variant="ghost"
                size="sm"
                className="h-auto px-2.5 py-1 text-xs hover:bg-accent/50"
                onClick={() => add(s)}
              >
                {s}
              </Button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
