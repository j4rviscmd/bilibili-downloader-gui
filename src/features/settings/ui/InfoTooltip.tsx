import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/shared/animate-ui/radix/tooltip'
import { Info } from 'lucide-react'
import type { ReactElement } from 'react'

interface InfoTooltipProps {
  /** Tooltip text; also used as the accessible label */
  text: string
}

/**
 * Non-interactive Info-icon tooltip rendered inside a choice card or
 * segment.
 *
 * span, not button: the parent card/segment is itself a button and HTML
 * forbids nested buttons. preventDefault + stopPropagation keep the info
 * click from selecting the card / toggling the segment.
 */
export function InfoTooltip({ text }: InfoTooltipProps): ReactElement {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          role="button"
          tabIndex={0}
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
          }}
          className="text-muted-foreground hover:text-foreground cursor-help"
          aria-label={text}
        >
          <Info className="size-3.5" />
        </span>
      </TooltipTrigger>
      <TooltipContent>
        <p className="max-w-xs">{text}</p>
      </TooltipContent>
    </Tooltip>
  )
}
