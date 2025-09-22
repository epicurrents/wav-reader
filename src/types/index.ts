/**
 * Epicurrents WAV reader types.
 * @package    epicurrents/wav-reader
 * @copyright  2025 Sampsa Lohi
 * @license    Apache-2.0
 */

import { FileFormatImporter } from '@epicurrents/core/dist/types'

export interface WavFileImporter extends FileFormatImporter {

}
/**
 * WAV header properties.
 */
export type WavHeader = {
    blockAlignment: number
    bitsPerSample: number
    bytesPerSec: number
    dataOffset: number
    dataSize: number
    description: string
    duration: number
    fileSize: number
    nChannels: number
    nSamples: number
    samplingRate: number
    sectionSize: number
    typeFormat: number
}
/**
 * A channel containing WAV signal.
 */
export type WavSignalChannel = {
    /** Channel label. */
    label: string
    /** Unique, identifying name. */
    name: string
    /** Signal type. */
    type: string
    /** Signal sampling rate. */
    samplingRate: number
    /** A multiplier to signal amplitude. */
    amplification: number
    /** Channel-specific sensitivity. */
    sensitivity: number
    /** Actual signal data. */
    signal: Float32Array
    /** Physical unit of the signal. */
    unit: string
    /** Number of signal datapoints. */
    sampleCount: number
}
