import { store } from '@/app/store'
import { videoApi } from '@/features/video'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { TitleReplacement } from '@/features/settings/type'
import { useSettings } from '@/features/settings/useSettings'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { Label } from '@/shared/ui/label'
import { Switch } from '@/shared/ui/switch'

const MAX_RULES = 20

/** Default title replacement rules. Must match the Rust backend defaults. */
const DEFAULT_RULES: TitleReplacement[] = [
  { from: '/', to: '-', enabled: true },
  { from: ':', to: '_', enabled: true },
  { from: '*', to: 'x', enabled: true },
  { from: '?', to: '', enabled: true },
  { from: '"', to: "'", enabled: true },
  { from: '<', to: '(', enabled: true },
  { from: '>', to: ')', enabled: true },
  { from: '|', to: '-', enabled: true },
]

/**
 * Title replacement settings component.
 * Manages character replacement rules for video titles.
 */
export function TitleReplacementSettings() {
  const { t } = useTranslation()
  const { settings, saveByForm } = useSettings()
  const [editingIndex, setEditingIndex] = useState<number | null>(null)
  const [editFrom, setEditFrom] = useState('')
  const [editTo, setEditTo] = useState('')

  // undefined/null = use defaults, [] = user deliberately cleared
  const isUsingDefaults = !settings.titleReplacements
  const rules: TitleReplacement[] = settings.titleReplacements ?? DEFAULT_RULES

  /**
   * Saves new title replacement rules.
   * Persists to settings and clears video cache to apply changes.
   *
   * @param newRules - Updated array of title replacement rules
   */
  const saveRules = async (newRules: TitleReplacement[]) => {
    await saveByForm({ ...settings, titleReplacements: newRules })
    store.dispatch(videoApi.util.resetApiState())
  }

  /**
   * Toggles the enabled state of a title replacement rule.
   *
   * @param index - Index of the rule to toggle
   * @param enabled - New enabled state
   */
  const handleToggle = async (index: number, enabled: boolean) => {
    const newRules = rules.map((rule, i) =>
      i === index ? { ...rule, enabled } : rule,
    )
    await saveRules(newRules)
  }

  /**
   * Enters edit mode for a specific rule.
   * Populates edit state with current rule values.
   *
   * @param index - Index of the rule to edit
   */
  const startEdit = (index: number) => {
    setEditingIndex(index)
    setEditFrom(rules[index].from)
    setEditTo(rules[index].to)
  }

  /**
   * Exits edit mode without saving changes.
   * Clears edit state and resets form fields.
   */
  const cancelEdit = () => {
    setEditingIndex(null)
    setEditFrom('')
    setEditTo('')
  }

  /**
   * Saves the current edit and exits edit mode.
   * Requires a non-empty "from" value to save.
   */
  const saveEdit = async () => {
    if (editingIndex === null || !editFrom) return

    const newRules = rules.map((rule, i) =>
      i === editingIndex ? { ...rule, from: editFrom, to: editTo } : rule,
    )
    await saveRules(newRules)
    cancelEdit()
  }

  /**
   * Deletes a title replacement rule by index.
   *
   * @param index - Index of the rule to delete
   */
  const deleteRule = async (index: number) => {
    const newRules = rules.filter((_, i) => i !== index)
    await saveRules(newRules)
  }

  /**
   * Adds a new empty rule and immediately enters edit mode for it.
   * Enforced by MAX_RULES limit to prevent performance issues.
   */
  const addRule = async () => {
    if (rules.length >= MAX_RULES) return

    const newRules = [...rules, { from: '', to: '', enabled: true }]
    await saveRules(newRules)
    setEditingIndex(newRules.length - 1)
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Label>{t('settings.title_replacement.section_label')}</Label>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={addRule}
          disabled={rules.length >= MAX_RULES}
        >
          <Plus className="mr-1 h-4 w-4" />
          {t('settings.title_replacement.add_rule')}
        </Button>
      </div>

      <p className="text-muted-foreground text-sm">
        {t('settings.title_replacement.description')}
      </p>

      {rules.length >= MAX_RULES && (
        <p className="text-muted-foreground text-sm">
          {t('settings.title_replacement.max_rules_reached')}
        </p>
      )}

      {isUsingDefaults && (
        <p className="text-muted-foreground text-sm">
          {t('settings.title_replacement.default_rules_note')}
        </p>
      )}

      {!isUsingDefaults && rules.length === 0 && (
        <p className="text-muted-foreground text-sm italic">
          {t('settings.title_replacement.empty_rules_note')}
        </p>
      )}

      {rules.length > 0 && (
        <div className="space-y-2">
          <div className="text-muted-foreground grid grid-cols-[auto_1fr_1fr_auto] items-center gap-2 text-xs">
            <span className="w-10" />
            <span>{t('settings.title_replacement.from_label')}</span>
            <span>{t('settings.title_replacement.to_label')}</span>
            <span className="w-20" />
          </div>
          {rules.map((rule, index) => (
            <div
              key={index}
              className="grid grid-cols-[auto_1fr_1fr_auto] items-center gap-2"
            >
              <Switch
                checked={rule.enabled}
                onCheckedChange={(checked) => handleToggle(index, checked)}
                aria-label={
                  rule.enabled
                    ? t('settings.title_replacement.enabled')
                    : t('settings.title_replacement.disabled')
                }
              />

              {editingIndex === index ? (
                <>
                  <Input
                    value={editFrom}
                    onChange={(e) => setEditFrom(e.target.value)}
                    placeholder={t(
                      'settings.title_replacement.from_placeholder',
                    )}
                    className="h-8"
                    autoFocus
                  />
                  <Input
                    value={editTo}
                    onChange={(e) => setEditTo(e.target.value)}
                    placeholder={t('settings.title_replacement.to_placeholder')}
                    className="h-8"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') saveEdit()
                      if (e.key === 'Escape') cancelEdit()
                    }}
                  />
                  <div className="flex gap-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={saveEdit}
                      disabled={!editFrom}
                      className="h-8 px-2"
                    >
                      OK
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={cancelEdit}
                      className="h-8 px-2"
                    >
                      {t('actions.cancel')}
                    </Button>
                  </div>
                </>
              ) : (
                <>
                  <Input
                    value={rule.from}
                    readOnly
                    className="bg-muted h-8"
                    placeholder={t(
                      'settings.title_replacement.from_placeholder',
                    )}
                  />
                  <Input
                    value={rule.to}
                    readOnly
                    className="bg-muted h-8"
                    placeholder={t('settings.title_replacement.to_placeholder')}
                  />
                  <div className="flex gap-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => startEdit(index)}
                      className="h-8 w-8 p-0"
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => deleteRule(index)}
                      className="text-destructive hover:text-destructive h-8 w-8 p-0"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
