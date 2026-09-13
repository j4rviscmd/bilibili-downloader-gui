import { Button } from '@/components/ui/button'
import { changeLanguage, type SupportedLang } from '@/shared/i18n'
import { invoke } from '@tauri-apps/api/core'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { detectSetupLanguage, setupLanguages } from '../lib/setup-language'

/** Choose and persist the application language before any first-run download. */
export function SetupLanguage({ onComplete }: { onComplete: () => void }) {
  const { t } = useTranslation()
  const [language, setLanguage] = useState(() =>
    detectSetupLanguage(navigator.languages),
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(false)

  useEffect(() => {
    void changeLanguage(language)
  }, [language])

  async function submit() {
    setSaving(true)
    setError(false)
    try {
      await invoke('patch_settings', { patch: { language } })
      onComplete()
    } catch (error) {
      console.error('Failed to save setup language', error)
      setError(true)
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 flex flex-col items-center justify-center gap-5 rounded-2xl bg-[#f5f7fa] p-10 text-[#333333]">
      <h1 className="text-2xl font-medium">{t('init.choose_language')}</h1>
      <p className="text-center text-sm">
        {t('init.choose_language_description')}
      </p>
      <label className="w-full max-w-sm">
        <span className="sr-only">{t('init.choose_language')}</span>
        <select
          className="w-full rounded-md border bg-white p-3"
          value={language}
          disabled={saving}
          onChange={(event) => setLanguage(event.target.value as SupportedLang)}
        >
          {setupLanguages.map(([id, label]) => (
            <option key={id} value={id}>
              {label}
            </option>
          ))}
        </select>
      </label>
      {error && <p role="alert">{t('init.language_save_failed')}</p>}
      <Button disabled={saving} onClick={() => void submit()}>
        {t('init.continue_setup')}
      </Button>
    </div>
  )
}
