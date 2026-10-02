import type { Delta, PathValue } from '@signalk/server-api'
import type { Mock } from 'vitest'

export type HandleMessage = (id: string, delta: Delta) => void

/** The first path/value of the n-th delta passed to a mocked handleMessage. */
export function sentValue(mock: Mock<HandleMessage>, call: number): PathValue {
  const update = mock.mock.calls.at(call)?.[1].updates[0]
  if (!update || !('values' in update)) {
    throw new Error(`handleMessage call ${call} carried no values`)
  }
  return update.values[0]
}

export function defined<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) {
    throw new Error('expected a value')
  }
  return value
}
