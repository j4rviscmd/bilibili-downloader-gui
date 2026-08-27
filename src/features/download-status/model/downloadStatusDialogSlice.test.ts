/**
 * downloadStatusDialogSlice unit suite.
 *
 * Dispatches against the real singleton store and asserts on
 * `store.getState().downloadStatusDialog`. The slice keeps
 * `activeParentId` across close/reopen cycles so the same download
 * status is redisplayed.
 */

import { store } from '@/app/store'
import { beforeEach, describe, expect, it } from 'vitest'

import {
  closeDownloadStatusDialog,
  openDownloadStatusDialog,
  setActiveDownloadStatusParent,
} from './downloadStatusDialogSlice'

const initialState = { dialogOpen: false, activeParentId: null }

function dialog() {
  return store.getState().downloadStatusDialog
}

beforeEach(() => {
  store.dispatch(closeDownloadStatusDialog())
  store.dispatch(setActiveDownloadStatusParent(null))
})

describe('downloadStatusDialogSlice', () => {
  it('opens without a payload and leaves activeParentId untouched', () => {
    store.dispatch(setActiveDownloadStatusParent('parent-1'))
    store.dispatch(openDownloadStatusDialog())

    expect(dialog()).toEqual({ dialogOpen: true, activeParentId: 'parent-1' })
  })

  it('open with a payload pins the displayed parent', () => {
    store.dispatch(openDownloadStatusDialog('parent-2'))
    expect(dialog()).toEqual({ dialogOpen: true, activeParentId: 'parent-2' })
  })

  it('closing keeps activeParentId for the next reopen', () => {
    store.dispatch(openDownloadStatusDialog('parent-1'))
    store.dispatch(closeDownloadStatusDialog())

    expect(dialog()).toEqual({ dialogOpen: false, activeParentId: 'parent-1' })

    store.dispatch(openDownloadStatusDialog())
    expect(dialog()).toEqual({ dialogOpen: true, activeParentId: 'parent-1' })
  })

  it('setActiveDownloadStatusParent switches or clears the target', () => {
    store.dispatch(setActiveDownloadStatusParent('parent-9'))
    expect(dialog().activeParentId).toBe('parent-9')

    store.dispatch(setActiveDownloadStatusParent(null))
    expect(dialog()).toEqual(initialState)
  })
})
