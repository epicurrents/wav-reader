/**
 * Epicurrents WAV reader types.
 * @package    epicurrents/wav-reader
 * @copyright  2025 Sampsa Lohi
 * @license    Apache-2.0
 */

/**
 * Properties a WAV file declares in its header chunks.
 *
 * Sample counts and the duration derived from them are per channel, as the `fact` chunk states them
 * and as a biosignal header expects them; the data chunk holds one sample per channel per frame.
 */
export type WavHeader = {
    /** Bytes one frame of interleaved samples takes. */
    blockAlignment: number
    /** Width of one stored sample; only 16 is read. */
    bitsPerSample: number
    /** Bytes one second of the recording takes, every channel included. */
    bytesPerSec: number
    /** Byte offset the samples start at. */
    dataOffset: number
    /** Byte length of the data chunk. */
    dataSize: number
    /** The `WAVE` form identifier. */
    description: string
    /** Length of the recording in seconds. */
    duration: number
    /** Byte length of the whole file, the twelve-byte RIFF preamble included. */
    fileSize: number
    /** Number of channels the samples are interleaved across. */
    nChannels: number
    /** Number of samples in each channel. */
    nSamples: number
    /** Sampling rate of every channel, in Hz. */
    samplingRate: number
    /** Byte length of the fmt chunk payload; 16 for plain PCM. */
    sectionSize: number
    /** Format tag of the samples; 1 for plain PCM. */
    typeFormat: number
}
