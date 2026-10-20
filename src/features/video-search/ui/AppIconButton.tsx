import { useSelector, type RootState } from '@/app/store'
import bilibiliTvMarkBlue from '@/assets/bilibili-tv-mark-blue.svg'
import bilibiliTvMark from '@/assets/bilibili-tv-mark.svg'
import { Button } from '@/shared/ui/button'

/**
 * App-icon button prefixing a page title (bilibili-style home shortcut).
 * The icon follows the accent setting: pink by default, blue with the
 * blue accent. The parent page owns what the click does.
 */
export function AppIconButton({
  label,
  onClick,
}: {
  /** Accessible name (pre-translated). No tooltip by design: the
   * title-prefix placement makes the shortcut self-explanatory. */
  label: string
  onClick: () => void
}) {
  const accent = useSelector(
    (state: RootState) => state.settings.accentColor ?? 'pink',
  )
  return (
    // Why -my-2: net 28px layout height (44px button - 16px margins)
    // matches the text-xl title row, so the title strip does not grow;
    // the 8px visual overflow each side stays inside the header's py-3
    // padding. Why size-11 on top of size="icon": the preset tops out at
    // 40px. Why no transform classes: a transform would create a
    // stacking context (overlay-trap precedent #790, 86b08ec).
    <Button
      variant="ghost"
      size="icon"
      className="-my-2 size-11 cursor-pointer"
      aria-label={label}
      onClick={onClick}
    >
      <img
        src={accent === 'blue' ? bilibiliTvMarkBlue : bilibiliTvMark}
        alt=""
        aria-hidden
        className="size-8"
      />
    </Button>
  )
}
