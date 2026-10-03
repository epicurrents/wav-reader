/**
 * WAV worker substitute tests.
 *
 * The substitute is what serves a study in an environment without SharedArrayBuffer, so the cases
 * are about the commission vocabulary rather than about decoding: a commission the substitute does
 * not answer is answered with a failure, and a failed commission rejects in the service.
 * @package    epicurrents/wav-reader
 * @copyright  2026 Sampsa Lohi
 * @license    Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import type { WorkerMessage } from '@epicurrents/core/types'
import WavWorkerSubstitute from '#wav/WavWorkerSubstitute'
import { buildWav, installRuntime } from './wavBuilder'

/** Commissions the base reader worker answers, every one of which a substitute has to answer too. */
const SHARED_VOCABULARY = [
    'cache-signals',
    'get-signals',
    'release-cache',
    'release-signal-arrays',
    'request-signals',
    'reset-network',
    'set-buffer-range',
    'set-interruptions',
    'set-signal-polarity',
    'setup-cache',
    'shutdown',
    'update-settings',
]

let removeRuntime: () => void
let serial = 0

/** Send a commission and collect everything the substitute replies with. */
const commission = async (substitute: WavWorkerSubstitute, message: Record<string, unknown>) => {
    const replies = [] as WorkerMessage['data'][]
    substitute.onmessage = (reply: Pick<WorkerMessage, 'data'>) => {
        replies.push(reply.data)
    }
    await substitute.postMessage({ rn: ++serial, ...message } as WorkerMessage['data'])
    return replies
}

const wavFile = () => {
    const { buffer } = buildWav({ channels: 2, frames: 500, samplingRate: 250 })
    return new File([buffer], 'recording.wav', { type: 'audio/wav' })
}

beforeEach(() => {
    removeRuntime = installRuntime()
})

afterEach(() => {
    removeRuntime()
})

describe('commission vocabulary', () => {
    test('answers every commission the worker answers', async () => {
        // Not that each one succeeds — a cache commission before a cache exists should not — but
        // that none is refused as unimplemented. `GenericService.shutdown` and `unload` both await
        // a commission before tearing anything down, so an unanswered action does not degrade a
        // study: it leaves the study impossible to close.
        const substitute = new WavWorkerSubstitute()
        const unimplemented = [] as string[]
        for (const action of SHARED_VOCABULARY) {
            const replies = await commission(substitute, { action })
            if (replies.some(reply => String(reply.error ?? '').includes('is not implemented'))) {
                unimplemented.push(action)
            }
        }
        expect(unimplemented).toStrictEqual([])
    })

    test('answers shutdown', async () => {
        const substitute = new WavWorkerSubstitute()
        const replies = await commission(substitute, { action: 'shutdown' })
        expect(replies[0]).toMatchObject({ action: 'shutdown', success: true })
    })

    test('acknowledges a settings snapshot without applying it', async () => {
        const substitute = new WavWorkerSubstitute()
        const replies = await commission(substitute, { action: 'update-settings', settings: {} })
        expect(replies[0]).toMatchObject({ success: true })
    })
})

describe('setup-worker', () => {
    test('opens a study from a file and reports its length', async () => {
        const substitute = new WavWorkerSubstitute()
        const replies = await commission(substitute, { action: 'setup-worker', file: wavFile() })
        expect(replies[0]).toMatchObject({
            action: 'setup-worker',
            dataLength: 2,
            recordingLength: 2,
            success: true,
        })
    })

    test('reports a failure when the study cannot be opened', async () => {
        const substitute = new WavWorkerSubstitute()
        const replies = await commission(substitute, {
            action: 'setup-worker',
            file: new File([new ArrayBuffer(32)], 'broken.wav'),
        })
        expect(replies[0]).toMatchObject({ action: 'setup-worker', success: false })
    })

    test('reports a failure when a property is of the wrong type', async () => {
        const substitute = new WavWorkerSubstitute()
        const replies = await commission(substitute, { action: 'setup-worker', url: 42 })
        expect(replies[0]?.success).toBe(false)
    })
})

describe('set-interruptions', () => {
    test('refuses a table of interruptions', async () => {
        // A WAV recording is one continuous span of samples, so recording time and data time are
        // the same measurement. A table saying otherwise describes a timeline this reader does not
        // serve: honouring it would displace every later read by the gaps it declares and return
        // samples that still look entirely plausible.
        const substitute = new WavWorkerSubstitute()
        const replies = await commission(substitute, {
            action: 'set-interruptions',
            interruptions: [[10, 2]],
        })
        expect(replies[0]?.success).toBe(false)
        expect(String(replies[0]?.error)).toContain('continuous')
    })

    test('accepts an empty table, which asserts nothing', async () => {
        const substitute = new WavWorkerSubstitute()
        const replies = await commission(substitute, { action: 'set-interruptions', interruptions: [] })
        expect(replies[0]?.success).toBe(true)
    })

    test('reports a failure when the table is missing', async () => {
        const substitute = new WavWorkerSubstitute()
        const replies = await commission(substitute, { action: 'set-interruptions' })
        expect(replies[0]?.success).toBe(false)
    })
})

describe('setup-cache', () => {
    test('refuses to set up a cache in shared memory', async () => {
        // A substitute exists because the environment has no SharedArrayBuffer to manage, so the
        // commission is refused rather than half-served.
        const substitute = new WavWorkerSubstitute()
        await commission(substitute, { action: 'setup-worker', file: wavFile() })
        const replies = await commission(substitute, {
            action: 'setup-cache',
            dataDuration: 2,
            useMemoryManager: true,
        })
        expect(replies[0]?.success).toBe(false)
    })

    test('sets up a cache on its own heap', async () => {
        const substitute = new WavWorkerSubstitute()
        await commission(substitute, { action: 'setup-worker', file: wavFile() })
        const replies = await commission(substitute, { action: 'setup-cache', dataDuration: 2 })
        expect(replies[0]).toMatchObject({ success: true })
        expect(replies[0]?.cacheProperties).toBeDefined()
    })
})

describe('get-signals', () => {
    test('reports a failure when the range is missing', async () => {
        const substitute = new WavWorkerSubstitute()
        const replies = await commission(substitute, { action: 'get-signals' })
        expect(replies[0]?.success).toBe(false)
    })

    test('reports a failure before a study has been opened', async () => {
        const substitute = new WavWorkerSubstitute()
        const replies = await commission(substitute, { action: 'get-signals', range: [0, 1] })
        expect(replies[0]?.success).toBe(false)
    })
})

describe('message handling', () => {
    test('ignores a message carrying no action', async () => {
        const substitute = new WavWorkerSubstitute()
        expect(await commission(substitute, {})).toStrictEqual([])
    })

    test('relays a caching progress update to the listener', async () => {
        // The reader reports progress out of band rather than as a commission reply, so the
        // substitute has to pass it on the same way a worker posts it.
        const substitute = new WavWorkerSubstitute()
        const reader = (substitute as unknown as {
            _reader: { _updateCallback: ((update: Record<string, unknown>) => void) | null }
        })._reader
        const relayed = [] as WorkerMessage['data'][]
        substitute.onmessage = (reply: Pick<WorkerMessage, 'data'>) => {
            relayed.push(reply.data)
        }
        reader._updateCallback?.({ action: 'cache-signals', range: [0, 2] })
        reader._updateCallback?.({ action: 'something-else' })
        expect(relayed).toStrictEqual([{ action: 'cache-signals', range: [0, 2] }])
    })
})
