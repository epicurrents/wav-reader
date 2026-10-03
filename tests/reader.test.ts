/**
 * WAV reader tests.
 * @package    epicurrents/wav-reader
 * @copyright  2026 Sampsa Lohi
 * @license    Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { AppSettings } from '@epicurrents/core/types'
import WavReader from '#wav/WavReader'
import { WavDecoder } from '#wav/WavDecoder'
import { buildWav, installRuntime } from './wavBuilder'

const CHUNK_SIZE = 2_097_152

/** Decode the header of a built file, the way the reader does before caching its properties. */
const buildHeader = (buffer: ArrayBuffer) => {
    const decoder = new WavDecoder()
    decoder.setInput(buffer)
    return decoder.decodeHeader()!.header
}

/** The settings the reader reads, as the application hands them over. */
const settings = () => ({ app: { dataChunkSize: CHUNK_SIZE } }) as unknown as AppSettings

/** Reach the protected state a derived field was written into. */
const internals = (reader: WavReader) => reader as unknown as {
    _cacheProcesses: { continue: boolean }[]
    _chunkUnitCount: number
    _dataOffset: number
    _dataUnitCount: number
    _dataUnitDuration: number
    _dataUnitSize: number
    _fallbackCache: unknown
    _fileTypeHeader: { nChannels: number } | null
    _header: { dataUnitCount: number, signals: { sampleCount: number }[] } | null
}

const wavFile = (options: Parameters<typeof buildWav>[0]) => {
    const { buffer } = buildWav(options)
    return new File([buffer], 'recording.wav', { type: 'audio/wav' })
}

describe('cacheWavInfo', () => {
    let reader: WavReader

    beforeEach(() => {
        reader = new WavReader(settings())
    })

    test('derives the data-unit shape of a mono recording', () => {
        const { buffer } = buildWav({ channels: 1, frames: 250, samplingRate: 100 })
        const decoded = buildHeader(buffer)
        reader.cacheWavInfo(decoded)
        const state = internals(reader)
        expect(reader.dataLength).toStrictEqual(2.5)
        expect(reader.totalLength).toStrictEqual(2.5)
        expect(state._dataUnitDuration).toStrictEqual(1)
        expect(state._dataUnitCount).toStrictEqual(3)
        expect(state._dataUnitSize).toStrictEqual(200)
        expect(state._chunkUnitCount).toStrictEqual(Math.floor(CHUNK_SIZE/200) - 1)
        expect(reader.discontinuous).toBe(false)
    })

    test('derives the length of a multi-channel recording from its per-channel samples', () => {
        const { buffer } = buildWav({ channels: 2, frames: 250, samplingRate: 100 })
        reader.cacheWavInfo(buildHeader(buffer))
        // Two channels of 250 samples at 100 Hz is two and a half seconds of recording, not five.
        // A length taken from the stored sample count scales with the channel count, and the reader
        // then serves reads past the end of the data chunk for the half that is not there.
        expect(reader.totalLength).toStrictEqual(2.5)
        expect(internals(reader)._dataUnitSize).toStrictEqual(400)
    })

    test('builds a biosignal header with one signal per channel', () => {
        const { buffer } = buildWav({ channels: 3, frames: 100, samplingRate: 50 })
        reader.cacheWavInfo(buildHeader(buffer))
        const header = internals(reader)._header
        expect(header?.signals).toHaveLength(3)
        expect(header?.signals[0].sampleCount).toStrictEqual(100)
    })

    test('falls back to one data unit per chunk when the budget cannot hold two', () => {
        const tight = new WavReader({ app: { dataChunkSize: 100 } } as unknown as AppSettings)
        const { buffer } = buildWav({ channels: 1, frames: 250, samplingRate: 100 })
        tight.cacheWavInfo(buildHeader(buffer))
        expect(internals(tight)._chunkUnitCount).toStrictEqual(1)
    })

    test('records the byte offset the samples start at', () => {
        const { buffer, dataOffset } = buildWav({ channels: 1, frames: 10 })
        reader.cacheWavInfo(buildHeader(buffer))
        expect(internals(reader)._dataOffset).toStrictEqual(dataOffset)
    })
})

describe('setupStudy', () => {
    let reader: WavReader
    let removeRuntime: () => void

    beforeEach(() => {
        removeRuntime = installRuntime(CHUNK_SIZE)
        reader = new WavReader(settings())
    })

    afterEach(() => {
        removeRuntime()
        vi.unstubAllGlobals()
    })

    test('opens a study from a file', async () => {
        const file = wavFile({ channels: 2, frames: 500, samplingRate: 250 })
        expect(await reader.setupStudy({ file })).toBe(true)
        expect(reader.totalLength).toStrictEqual(2)
        expect(internals(reader)._fileTypeHeader?.nChannels).toStrictEqual(2)
    })

    test('opens a study from a url, asking for the header bytes only', async () => {
        const { buffer } = buildWav({ channels: 1, frames: 400, samplingRate: 200 })
        const fetchMock = vi.fn().mockResolvedValue({
            ok: true,
            status: 200,
            arrayBuffer: () => Promise.resolve(buffer.slice(0, 1024)),
        })
        vi.stubGlobal('fetch', fetchMock)
        expect(await reader.setupStudy({ url: 'https://example.test/recording.wav' })).toBe(true)
        expect(reader.totalLength).toStrictEqual(2)
        expect(reader.url).toStrictEqual('https://example.test/recording.wav')
        const headers = (fetchMock.mock.calls[0][1] as { headers: Headers }).headers
        expect(headers.get('Range')).toStrictEqual('bytes=0-1023')
        expect(headers.get('Authorization')).toBeNull()
    })

    test('passes an authorization header on to the request and keeps it', async () => {
        const { buffer } = buildWav({ channels: 1, frames: 400, samplingRate: 200 })
        const fetchMock = vi.fn().mockResolvedValue({
            ok: true,
            status: 200,
            arrayBuffer: () => Promise.resolve(buffer.slice(0, 1024)),
        })
        vi.stubGlobal('fetch', fetchMock)
        await reader.setupStudy({ authHeader: 'Bearer token', url: 'https://example.test/recording.wav' })
        const headers = (fetchMock.mock.calls[0][1] as { headers: Headers }).headers
        expect(headers.get('Authorization')).toStrictEqual('Bearer token')
    })

    test('refuses a response that is not ok rather than parsing the error body', async () => {
        const fetchMock = vi.fn().mockResolvedValue({
            ok: false,
            status: 404,
            arrayBuffer: () => Promise.resolve(new ArrayBuffer(16)),
        })
        vi.stubGlobal('fetch', fetchMock)
        expect(await reader.setupStudy({ url: 'https://example.test/missing.wav' })).toBe(false)
    })

    test('refuses a source with neither a file nor a url', async () => {
        expect(await reader.setupStudy({})).toBe(false)
    })

    test('refuses a file whose header does not parse', async () => {
        const file = new File([new ArrayBuffer(64)], 'broken.wav')
        expect(await reader.setupStudy({ file })).toBe(false)
    })

    test('refuses a bit depth the reader cannot serve', async () => {
        // The cache element type and the data-unit arithmetic are both fixed at two bytes per
        // sample, so a file of another width would be served as pairs of its samples. Refused at
        // setup, where the reason reaches the caller, rather than at the first read.
        const file = wavFile({ bitsPerSample: 8, channels: 1, frames: 100, samplingRate: 100 })
        expect(await reader.setupStudy({ file })).toBe(false)
    })

    test('refuses to open a second study over an initialized cache', async () => {
        internals(reader)._fallbackCache = {}
        const file = wavFile({ channels: 1, frames: 100 })
        expect(await reader.setupStudy({ file })).toBe(false)
    })

    test('stops every cache process that was still running', async () => {
        const state = internals(reader)
        const processes = [{ continue: true }, { continue: true }, { continue: true }]
        state._cacheProcesses.push(...processes)
        await reader.setupStudy({ file: wavFile({ channels: 1, frames: 100, samplingRate: 100 }) })
        // Splicing the array while indexing forward over it skips the element that moves into the
        // index just vacated, so half the processes keep their `continue` flag and keep reading
        // into a cache the new study has replaced.
        expect(processes.every(process => process.continue)).toBe(false)
        expect(processes.some(process => process.continue)).toBe(false)
        expect(state._cacheProcesses).toHaveLength(0)
    })
})
