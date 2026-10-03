/**
 * WAV worker tests.
 *
 * The worker module installs itself as the thread's message handler on import, so the cases drive
 * it the way the thread does: a stubbed `postMessage` collects the replies and `onmessage` is the
 * entry point.
 * @package    epicurrents/wav-reader
 * @copyright  2026 Sampsa Lohi
 * @license    Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { WorkerMessage } from '@epicurrents/core/types'
import { buildWav } from './wavBuilder'

let replies: WorkerMessage['data'][]
let serial = 0

/** Send a commission through the thread's handler and collect what it posts back. */
const commission = async (message: Record<string, unknown>) => {
    replies = []
    const handler = (globalThis as unknown as {
        onmessage: ((message: WorkerMessage) => Promise<void>) | null
    }).onmessage
    await handler?.({ data: { rn: ++serial, ...message } } as WorkerMessage)
    return replies
}

beforeEach(async () => {
    vi.stubGlobal('postMessage', (message: WorkerMessage['data']) => {
        replies.push(message)
    })
    replies = []
    // Imported after the stub is in place, since the module registers its handler on import.
    await import('#workers/wav.worker')
})

afterEach(() => {
    vi.unstubAllGlobals()
})

describe('message handling', () => {
    test('ignores a message carrying no action', async () => {
        expect(await commission({})).toStrictEqual([])
    })

    test('answers an action it does not know with a failure', async () => {
        const answered = await commission({ action: 'not-an-action' })
        expect(answered[0]?.success).toBe(false)
    })
})

describe('setup-worker', () => {
    test('opens a study from a file and reports its length', async () => {
        const { buffer } = buildWav({ channels: 2, frames: 500, samplingRate: 250 })
        const answered = await commission({
            action: 'setup-worker',
            file: new File([buffer], 'recording.wav', { type: 'audio/wav' }),
        })
        expect(answered[0]).toMatchObject({ dataLength: 2, recordingLength: 2, success: true })
    })

    test('reports a failure when a property is of the wrong type', async () => {
        const answered = await commission({ action: 'setup-worker', url: 42 })
        expect(answered[0]?.success).toBe(false)
    })

    test('reports a failure when the study cannot be opened', async () => {
        const answered = await commission({
            action: 'setup-worker',
            file: new File([new ArrayBuffer(32)], 'broken.wav'),
        })
        expect(answered[0]).toMatchObject({ success: false })
    })
})

describe('set-interruptions', () => {
    test('refuses a table of interruptions', async () => {
        // Stated in the worker as well as in the substitute: the two run the same handlers, and the
        // refusal is a property of the format rather than of the thread it is read on.
        const answered = await commission({ action: 'set-interruptions', interruptions: [[3, 1]] })
        expect(answered[0]?.success).toBe(false)
        expect(String(answered[0]?.error)).toContain('continuous')
    })

    test('accepts an empty table, which asserts nothing', async () => {
        const answered = await commission({ action: 'set-interruptions', interruptions: [] })
        expect(answered[0]?.success).toBe(true)
    })

    test('reports a failure when the table is missing', async () => {
        const answered = await commission({ action: 'set-interruptions' })
        expect(answered[0]?.success).toBe(false)
    })
})
