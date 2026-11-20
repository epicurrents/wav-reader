/**
 * Epicurrents WAV reader types.
 * @package    epicurrents/wav-reader
 * @copyright  2025 Sampsa Lohi
 * @license    Apache-2.0
 */

/**
 * What the stored integers of a WAV file stand for. The format carries no calibration of its own, so
 * the host that knows the acquisition device supplies it to the importer.
 */
export type WavCalibration = {
    /**
     * Physical value of a sample at full scale, in `physicalUnit`: the value a stored integer of
     * -32768 reads as, negated. Must be a finite number above zero.
     */
    physicalMax: number
    /** Unit of `physicalMax` and of every channel; `uV` when omitted. */
    physicalUnit?: string
}
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
/** Options of a WAV importer. */
export type WavImporterOptions = {
    /** What the stored integers stand for; one microvolt each when omitted. */
    calibration?: WavCalibration
}
