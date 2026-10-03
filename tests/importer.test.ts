/**
 * WAV importer tests.
 * @package    epicurrents/wav-reader
 * @copyright  2026 Sampsa Lohi
 * @license    Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { StudyContextFile } from '@epicurrents/core/types'
import WavImporter from '#wav/WavImporter'
import { buildWav, installRuntime } from './wavBuilder'

/** Reach the study the importer accumulates its files and metadata into. */
const studyOf = (importer: WavImporter) => (importer as unknown as {
    _study: { files: StudyContextFile[], meta: Record<string, unknown> }
})._study

const wavBuffer = () => buildWav({ channels: 2, frames: 100, samplingRate: 100 }).buffer

const wavFile = (name = 'recording.wav') => {
    return new File([wavBuffer()], name, { type: 'audio/wav' })
}

/** Answer a ranged request with the leading bytes of a built file. */
const stubFetch = (buffer: ArrayBuffer) => {
    const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        status: 206,
        arrayBuffer: () => Promise.resolve(buffer.slice(0, 1024)),
        blob: () => Promise.resolve(new Blob([buffer.slice(0, 1024)])),
        headers: new Headers(),
    })
    vi.stubGlobal('fetch', fetchMock)
    return fetchMock
}

let importer: WavImporter
let removeRuntime: () => void

beforeEach(() => {
    removeRuntime = installRuntime()
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: () => 'blob:wav-stub' }))
    importer = new WavImporter()
})

afterEach(() => {
    removeRuntime()
    vi.unstubAllGlobals()
})

describe('readHeader', () => {
    test('returns the parsed header of the buffer it was given', async () => {
        const header = await importer.readHeader(wavBuffer())
        expect(header).toMatchObject({ bitsPerSample: 16, nChannels: 2, samplingRate: 100 })
    })

    test('returns null for a buffer that is not a WAV file', async () => {
        expect(await importer.readHeader(new ArrayBuffer(64))).toBeNull()
    })
})

describe('importFile', () => {
    test('describes the file as a signal data file of the wav format', async () => {
        const result = await importer.importFile(wavFile())
        expect(result).toMatchObject({
            format: 'wav',
            mime: 'audio/wav',
            modality: 'signal',
            name: 'recording.wav',
            partial: false,
            role: 'data',
        })
        expect(studyOf(importer).files).toHaveLength(1)
    })

    test('reads the recording properties into the study metadata', async () => {
        await importer.importFile(wavFile())
        expect(studyOf(importer).meta).toStrictEqual({
            bitsPerSample: 16,
            duration: 1,
            fileSize: 444,
            nChannels: 2,
            samplingRate: 100,
        })
    })

    test('takes the name, mime type and url from the configuration when given one', async () => {
        const result = await importer.importFile(wavFile(), {
            mime: 'audio/x-wav',
            name: 'named.wav',
            url: 'https://example.test/named.wav',
        })
        expect(result).toMatchObject({
            mime: 'audio/x-wav',
            name: 'named.wav',
            url: 'https://example.test/named.wav',
        })
    })

    test('accepts a study file context in place of a bare file', async () => {
        const context = { file: wavFile('context.wav'), name: 'context.wav' }
        const result = await importer.importFile(context as unknown as Parameters<typeof importer.importFile>[0])
        expect(result?.name).toStrictEqual('context.wav')
    })

    test('adds no file to the study when the header does not parse', async () => {
        const result = await importer.importFile(new File([new ArrayBuffer(64)], 'broken.wav'))
        expect(result).toBeNull()
        expect(studyOf(importer).files).toHaveLength(0)
    })

    test('adds no file to the study when the bytes cannot be read', async () => {
        const unreadable = {
            name: 'unreadable.wav',
            slice: () => {
                throw new Error('read failed')
            },
        }
        const result = await importer.importFile(unreadable as unknown as File)
        expect(result).toBeNull()
        expect(studyOf(importer).files).toHaveLength(0)
    })
})

describe('importUrl', () => {
    test('describes the remote file and reads its header', async () => {
        stubFetch(wavBuffer())
        const result = await importer.importUrl('https://example.test/remote.wav')
        expect(result).toMatchObject({
            file: null,
            format: 'wav',
            modality: 'signal',
            name: 'remote.wav',
            role: 'data',
            url: 'https://example.test/remote.wav',
        })
        expect(studyOf(importer).meta.nChannels).toStrictEqual(2)
    })

    test('accepts a study file context in place of a bare url', async () => {
        stubFetch(wavBuffer())
        const context = { url: 'https://example.test/ctx.wav' }
        const result = await importer.importUrl(context as unknown as Parameters<typeof importer.importUrl>[0])
        expect(result?.url).toStrictEqual('https://example.test/ctx.wav')
    })

    test('adds no file to the study when the header does not parse', async () => {
        stubFetch(new ArrayBuffer(64))
        expect(await importer.importUrl('https://example.test/broken.wav')).toBeNull()
        expect(studyOf(importer).files).toHaveLength(0)
    })

    test('adds no file to the study when the request fails', async () => {
        vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')))
        expect(await importer.importUrl('https://example.test/remote.wav')).toBeNull()
        expect(studyOf(importer).files).toHaveLength(0)
    })
})

describe('getFileTypeWorker', () => {
    /** Stand-in for the worker global, which the test environment has no implementation of. */
    class StubWorker {
        addEventListener () {}
        postMessage () {}
        removeEventListener () {}
        terminate () {}
    }

    beforeEach(() => {
        vi.stubGlobal('Worker', StubWorker)
    })

    test('constructs the inlined worker when nothing is registered over it', () => {
        expect(importer.getFileTypeWorker()).toBeInstanceOf(StubWorker)
    })

    test('prefers a registered override over the inlined worker', () => {
        const override = new StubWorker() as unknown as Worker
        importer.setWorkerOverride('emg', () => override)
        expect(importer.getFileTypeWorker('emg')).toBe(override)
    })

    test('falls back to the inlined worker for a key nothing is registered under', () => {
        const override = new StubWorker() as unknown as Worker
        importer.setWorkerOverride('emg', () => override)
        expect(importer.getFileTypeWorker('ncs')).not.toBe(override)
    })
})

describe('accepted file types', () => {
    test('accepts the wav extension under the audio/wav media type', () => {
        expect(importer.fileTypes).toStrictEqual([
            {
                accept: { 'audio/wav': ['.wav'] },
                description: 'WAV audio file',
            },
        ])
    })
})
