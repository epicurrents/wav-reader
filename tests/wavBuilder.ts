/**
 * WAV fixtures and the stubs the suite shares.
 *
 * Files are built byte by byte rather than read from disk, so a case can state the one field it is
 * about and let everything else follow from it. Nothing stands in for `@epicurrents/core`: the real
 * classes are constructed and the real parser runs over these bytes.
 * @package    epicurrents/wav-reader
 * @copyright  2026 Sampsa Lohi
 * @license    Apache-2.0
 */

/** Byte length of one sample at the given bit depth. */
const sampleBytes = (bitsPerSample: number) => Math.ceil(bitsPerSample/8)

/** An extra RIFF chunk to place between `fmt ` and `data`. */
export type ExtraChunk = {
    /** Four-character chunk identifier. */
    id: string
    /** Chunk payload; a `fact` chunk's payload is its four-byte sample count. */
    payload: Uint8Array
}

export type WavOptions = {
    /** Bit depth written into the header and used to pack the samples (default 16). */
    bitsPerSample?: number
    /** Number of channels (default 1). */
    channels?: number
    /** Chunks to write between `fmt ` and `data`, in order. */
    extraChunks?: ExtraChunk[]
    /** Bytes of fmt payload beyond the 16 standard ones, which widen the declared section size. */
    extraFmtBytes?: number
    /**
     * Interleaved samples, frame by frame, as the file stores them. When omitted the data chunk is
     * filled with a ramp of `frames`*`channels` values.
     */
    interleaved?: number[]
    /** Number of frames to generate when `interleaved` is omitted (default 4). */
    frames?: number
    /** Four-character identifier in place of `fmt `. */
    fmtId?: string
    /** Four-character identifier in place of `RIFF`. */
    riffId?: string
    /** Sampling rate in Hz (default 8000). */
    samplingRate?: number
    /** Four-character identifier in place of `WAVE`. */
    waveId?: string
    /** Format tag written into the fmt chunk (default 1, PCM). */
    typeFormat?: number
}

/**
 * Build a PCM WAV file.
 *
 * The returned buffer is a complete file: the `RIFF` size field counts everything after itself and
 * the data chunk holds exactly the samples given, so a header parsed from it describes the bytes
 * that follow rather than the fixture's intent.
 * @param options - Fields to vary; everything omitted takes a valid default.
 * @returns The file as an ArrayBuffer, with the byte offset its data chunk starts at.
 */
export const buildWav = (options: WavOptions = {}) => {
    const bitsPerSample = options.bitsPerSample ?? 16
    const channels = options.channels ?? 1
    const samplingRate = options.samplingRate ?? 8000
    const frames = options.frames ?? 4
    const width = sampleBytes(bitsPerSample)
    const interleaved = options.interleaved
                        ?? Array.from({ length: frames*channels }, (_, i) => i + 1)
    const extraFmtBytes = options.extraFmtBytes ?? 0
    const extraChunks = options.extraChunks ?? []
    const dataBytes = interleaved.length*width
    const extraBytes = extraChunks.reduce(
        // Every chunk carries an eight-byte identifier and size, and RIFF pads an odd payload to a
        // word boundary, so a fixture with one has to account for the pad the parser will skip.
        (total, chunk) => total + 8 + chunk.payload.length + chunk.payload.length%2,
        0
    )
    const headerBytes = 12 + 8 + 16 + extraFmtBytes + extraBytes + 8
    const buffer = new ArrayBuffer(headerBytes + dataBytes)
    const view = new DataView(buffer)
    const bytes = new Uint8Array(buffer)
    let offset = 0
    const putString = (value: string) => {
        for (let i = 0; i < 4; i++) {
            view.setUint8(offset++, value.charCodeAt(i))
        }
    }
    const putUint32 = (value: number) => {
        view.setUint32(offset, value, true)
        offset += 4
    }
    const putUint16 = (value: number) => {
        view.setUint16(offset, value, true)
        offset += 2
    }
    putString(options.riffId ?? 'RIFF')
    putUint32(buffer.byteLength - 8)
    putString(options.waveId ?? 'WAVE')
    putString(options.fmtId ?? 'fmt ')
    putUint32(16 + extraFmtBytes)
    putUint16(options.typeFormat ?? 1)
    putUint16(channels)
    putUint32(samplingRate)
    putUint32(samplingRate*channels*width)
    putUint16(channels*width)
    putUint16(bitsPerSample)
    offset += extraFmtBytes
    for (const chunk of extraChunks) {
        putString(chunk.id)
        putUint32(chunk.payload.length)
        bytes.set(chunk.payload, offset)
        offset += chunk.payload.length + chunk.payload.length%2
    }
    putString('data')
    putUint32(dataBytes)
    const dataOffset = offset
    for (const sample of interleaved) {
        if (bitsPerSample === 16) {
            view.setInt16(offset, sample, true)
        } else if (bitsPerSample === 8) {
            view.setUint8(offset, sample)
        } else if (bitsPerSample === 32) {
            view.setInt32(offset, sample, true)
        }
        offset += width
    }
    return { buffer, dataOffset }
}

/** A `fact` chunk declaring `samples` samples per channel. */
export const factChunk = (samples: number): ExtraChunk => {
    const payload = new Uint8Array(4)
    new DataView(payload.buffer).setUint32(0, samples, true)
    return { id: 'fact', payload }
}

/** A `LIST` chunk of `size` filler bytes, the metadata block real files carry. */
export const listChunk = (size = 10): ExtraChunk => {
    return { id: 'LIST', payload: new Uint8Array(size).fill(0x20) }
}

/**
 * Minimal application runtime, for the classes that read settings off the global.
 * @param dataChunkSize - Byte budget one cached chunk may take.
 * @returns A teardown that removes the global again.
 */
export const installRuntime = (dataChunkSize = 2_097_152) => {
    const global = window as unknown as Record<string, unknown>
    global.__EPICURRENTS__ = {
        RUNTIME: {
            SETTINGS: {
                app: { dataChunkSize },
            },
        },
    }
    return () => {
        delete global.__EPICURRENTS__
    }
}
