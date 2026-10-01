import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { Search } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

/**
 * Keyword input + submit button for the video search page.
 *
 * Local draft state only; submission goes through the caller-provided
 * `onSearch` (the `useVideoSearch().search` dispatcher) so Redux keeps the
 * submitted keyword.
 */
export function VideoSearchInput({
  onSearch,
  loading,
}: {
  onSearch: (keyword: string) => void
  loading: boolean
}) {
  const { t } = useTranslation()
  const [draft, setDraft] = useState('')

  return (
    <form
      className="flex w-full gap-2"
      onSubmit={(e) => {
        e.preventDefault()
        onSearch(draft)
      }}
    >
      <Input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder={t('videoSearch.placeholder')}
        aria-label={t('videoSearch.placeholder')}
      />
      <Button type="submit" disabled={loading || !draft.trim()}>
        <Search />
        {t('videoSearch.searchButton')}
      </Button>
    </form>
  )
}
