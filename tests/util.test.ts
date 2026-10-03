/**
 * WAV header conversion tests.
 * @package    epicurrents/wav-reader
 * @copyright  2026 Sampsa Lohi
 * @license    Apache-2.0
 */

import { describe, expect, test } from 'vitest'
import type { WavHeader } from '#types'
import { headerToBiosignalHeader } from '#util'

const header = (overrides: Partial<WavHeader> = {}) => ({
    bitsPerSample: 16,
    blockAlignment: 4,
    bytesPerSec: 400,
    dataOffset: 44,
    dataSize: 400,
    description: 'WAVE',
    duration: 1,
    fileSize: 444,
    nChannels: 2,
    nSamples: 100,
    samplingRate: 100,
    sectionSize: 16,
    typeFormat: 1,
    ...overrides,
} as WavHeader)

describe('headerToBiosignalHeader', () => {
    test('declares one signal per channel', () => {
        const converted = headerToBiosignalHeader(header({ nChannels: 3 }))
        expect(converted.signalCount).toStrictEqual(3)
        expect(converted.signals.map(signal => signal.name)).toStrictEqual(['channel_0', 'channel_1', 'channel_2'])
        expect(converted.signals.map(signal => signal.label)).toStrictEqual(['Chan 1', 'Chan 2', 'Chan 3'])
    })

    test('carries the sampling rate and sample count of every channel', () => {
        const converted = headerToBiosignalHeader(header({ nSamples: 250, samplingRate: 50 }))
        expect(converted.maxSamplingRate).toStrictEqual(50)
        expect(converted.signals.every(signal => signal.sampleCount === 250)).toBe(true)
    })

    test('uses a one-second data unit', () => {
        const converted = headerToBiosignalHeader(header({ duration: 7 }))
        expect(converted.dataUnitDuration).toStrictEqual(1)
        expect(converted.totalDuration).toStrictEqual(7)
    })

    test('reports a continuous recording', () => {
        expect(headerToBiosignalHeader(header()).discontinuous).toBe(false)
    })

    test('declares no prefiltering, which a WAV file carries no record of', () => {
        const signal = headerToBiosignalHeader(header()).signals[0]
        expect(signal.prefiltering).toStrictEqual({ bandreject: [], highpass: 0, lowpass: 0, notch: 0 })
        expect(signal.physicalUnit).toStrictEqual('uV')
        expect(signal.sensor).toStrictEqual('')
    })
})
