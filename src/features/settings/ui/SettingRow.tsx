import { Label } from '@/shared/ui/label'
import type { ReactElement, ReactNode } from 'react'

interface SettingItemProps {
  label: ReactNode
  /** Optional htmlFor for the label (associate the row's control id) */
  htmlFor?: string
  description?: ReactNode
  /** Control (switch / input+button / etc.) */
  children: ReactNode
}

/**
 * Horizontal setting row: label + description on the left, control on
 * the right.
 *
 * The dominant idiom for switch-style settings — the label block and the
 * control sit on one baseline and the description wraps under the label.
 *
 * @example
 * ```tsx
 * <SettingRow label={t('settings.theme_label')} description={t('...')}>
 *   <Switch checked={...} onCheckedChange={...} />
 * </SettingRow>
 * ```
 */
export function SettingRow({
  label,
  htmlFor,
  description,
  children,
}: SettingItemProps): ReactElement {
  return (
    <div className="flex items-center justify-between">
      <div className="space-y-0.5">
        <Label htmlFor={htmlFor}>{label}</Label>
        {description !== undefined && (
          <p className="text-muted-foreground text-sm">{description}</p>
        )}
      </div>
      {children}
    </div>
  )
}

/**
 * Stacked setting block: label + description above, control below.
 *
 * Used when the control needs horizontal room (radio grids, path pickers,
 * sliders) or has its own sub-layout.
 *
 * @example
 * ```tsx
 * <SettingField label={t('settings.output_dir_label')} description={t('...')}>
 *   <OutputPathPicker />
 * </SettingField>
 * ```
 */
export function SettingField({
  label,
  htmlFor,
  description,
  children,
}: SettingItemProps): ReactElement {
  return (
    <div className="space-y-2">
      <div className="space-y-0.5">
        <Label htmlFor={htmlFor}>{label}</Label>
        {description !== undefined && (
          <p className="text-muted-foreground text-sm">{description}</p>
        )}
      </div>
      {children}
    </div>
  )
}
