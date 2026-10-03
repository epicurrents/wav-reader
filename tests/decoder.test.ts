/**
 * WAV decoder tests.
 * @package    epicurrents/wav-reader
 * @copyright  2026 Sampsa Lohi
 * @license    Apache-2.0
 */

import { beforeEach, describe, expect, test, vi } from 'vitest'
import { WavDecoder } from '#wav/WavDecoder'
import { buildWav, factChunk, listChunk } from './wavBuilder'

/** Default normalisation divides the stored integer by a million, which is microvolts to volts. */
const UV = 1e6

const decoderFor = (buffer: ArrayBuffer) => {
    const decoder = new WavDecoder()
    decoder.setInput(buffer)
    return decoder
}

describe('decodeHeader', () => {
    test('reads every field of a minimal mono file', () => {
        const { buffer, dataOffset } = buildWav({ channels: 1, frames: 4, samplingRate: 8000 })
        const result = decoderFor(buffer).decodeHeader()
        expect(result?.offset).toStrictEqual(dataOffset)
        expect(result?.header).toMatchObject({
            bitsPerSample: 16,
            blockAlignment: 2,
            bytesPerSec: 16000,
            dataOffset,
            dataSize: 8,
            description: 'WAVE',
            nChannels: 1,
            samplingRate: 8000,
            sectionSize: 16,
            typeFormat: 1,
        })
    })

    test('reports the size of the whole file, not the RIFF payload', () => {
        const { buffer } = buildWav({ channels: 1, frames: 4 })
        expect(decoderFor(buffer).decodeHeader()?.header.fileSize).toStrictEqual(buffer.byteLength)
    })

    test('counts samples per channel on a multi-channel file', () => {
        const { buffer } = buildWav({ channels: 2, frames: 4, samplingRate: 8000 })
        const header = decoderFor(buffer).decodeHeader()?.header
        // The data chunk holds eight samples, which is four per channel. Counting the stored
        // samples instead doubles both the count and the duration derived from it, and the
        // recording then claims a length its data chunk does not have.
        expect(header?.nSamples).toStrictEqual(4)
        expect(header?.duration).toStrictEqual(4/8000)
    })

    test('counts samples per channel on a mono file', () => {
        const { buffer } = buildWav({ channels: 1, frames: 7, samplingRate: 100 })
        const header = decoderFor(buffer).decodeHeader()?.header
        expect(header?.nSamples).toStrictEqual(7)
        expect(header?.duration).toStrictEqual(0.07)
    })

    test('takes the sample count from a fact chunk when the file carries one', () => {
        // The declared count is three where the data chunk holds four frames, which is what a fact
        // chunk is for: the samples are padded and only the chunk says how many are real. A fixture
        // whose two counts agree cannot tell whether the chunk was read at all.
        const { buffer } = buildWav({ channels: 2, frames: 4, extraChunks: [factChunk(3)] })
        const header = decoderFor(buffer).decodeHeader()?.header
        expect(header?.nSamples).toStrictEqual(3)
        expect(header?.duration).toStrictEqual(3/8000)
    })

    test('skips a chunk it does not know and finds the data chunk behind it', () => {
        const { buffer, dataOffset } = buildWav({ extraChunks: [listChunk(10)] })
        // A LIST chunk of authoring metadata is routine in files from recording software, and a
        // parser that expects `data` immediately after `fmt ` refuses every one of them.
        const result = decoderFor(buffer).decodeHeader()
        expect(result?.header.dataOffset).toStrictEqual(dataOffset)
        expect(result?.header.dataSize).toStrictEqual(8)
    })

    test('skips a chunk whose payload is an odd number of bytes', () => {
        const { buffer, dataOffset } = buildWav({ extraChunks: [listChunk(7)] })
        expect(decoderFor(buffer).decodeHeader()?.header.dataOffset).toStrictEqual(dataOffset)
    })

    test('skips the extra bytes of a widened fmt chunk', () => {
        const { buffer, dataOffset } = buildWav({ extraFmtBytes: 2 })
        const header = decoderFor(buffer).decodeHeader()?.header
        expect(header?.sectionSize).toStrictEqual(18)
        expect(header?.dataOffset).toStrictEqual(dataOffset)
    })

    test('refuses a file that is not RIFF', () => {
        const { buffer } = buildWav({ riffId: 'RIFX' })
        expect(decoderFor(buffer).decodeHeader()).toBeUndefined()
    })

    test('refuses a RIFF file that is not WAVE', () => {
        const { buffer } = buildWav({ waveId: 'AVI ' })
        expect(decoderFor(buffer).decodeHeader()).toBeUndefined()
    })

    test('refuses a WAVE file whose first chunk is not the format chunk', () => {
        const { buffer } = buildWav({ fmtId: 'junk' })
        expect(decoderFor(buffer).decodeHeader()).toBeUndefined()
    })

    test('refuses a file that ends in the middle of the format chunk', () => {
        // The parse is one transaction, so a read that runs off the end of the buffer refuses the
        // whole header instead of returning the fields that happened to fit.
        const { buffer } = buildWav({})
        expect(decoderFor(buffer.slice(0, 22)).decodeHeader()).toBeUndefined()
    })

    test('reads a file whose format tag is not plain PCM', () => {
        // The tag is recorded rather than enforced; what this reader cannot handle is the sample
        // width, which `decodeData` refuses on its own.
        const { buffer } = buildWav({ typeFormat: 3 })
        expect(decoderFor(buffer).decodeHeader()?.header.typeFormat).toStrictEqual(3)
    })

    test('reports a duration of zero when the file declares no sampling rate', () => {
        const { buffer } = buildWav({ samplingRate: 0 })
        expect(decoderFor(buffer).decodeHeader()?.header.duration).toStrictEqual(0)
    })

    test('refuses a buffer too short to hold a header', () => {
        expect(decoderFor(new ArrayBuffer(8)).decodeHeader()).toBeUndefined()
    })

    test('refuses without an input buffer', () => {
        expect(new WavDecoder().decodeHeader()).toBeUndefined()
    })

    test('refuses a sampling rate other than the expected one', () => {
        const { buffer } = buildWav({ samplingRate: 8000 })
        const expected = new Map<string, string | number>([['samplingRate', 44100]])
        expect(decoderFor(buffer).decodeHeader(expected)).toBeUndefined()
    })

    test('refuses a byte rate other than the expected one', () => {
        const { buffer } = buildWav({ channels: 1, samplingRate: 8000 })
        const expected = new Map<string, string | number>([['bytesPerSecond', 88200]])
        expect(decoderFor(buffer).decodeHeader(expected)).toBeUndefined()
    })

    test('refuses a file whose chunks run out before the data chunk', () => {
        // The reader parses the first kilobyte and expects the whole header inside it, so a file
        // whose chunk list reaches past that is refused rather than read from the wrong offset.
        const { buffer } = buildWav({})
        expect(decoderFor(buffer.slice(0, 36)).decodeHeader()).toBeUndefined()
    })

    test('refuses a bit depth other than the expected one', () => {
        const { buffer } = buildWav({ bitsPerSample: 16 })
        const expected = new Map<string, string | number>([['bitsPerSample', 24]])
        expect(decoderFor(buffer).decodeHeader(expected)).toBeUndefined()
    })

    test('accepts properties that match the expectation', () => {
        const { buffer } = buildWav({ bitsPerSample: 16, samplingRate: 8000 })
        const expected = new Map<string, string | number>([
            ['bitsPerSample', 16],
            ['bytesPerSecond', 16000],
            ['samplingRate', 8000],
        ])
        expect(decoderFor(buffer).decodeHeader(expected)?.header.samplingRate).toStrictEqual(8000)
    })

    test('clears a previous result when a new input is set', () => {
        const { buffer } = buildWav({})
        const decoder = decoderFor(buffer)
        decoder.decodeHeader()
        expect(decoder.output).not.toBeNull()
        decoder.setInput(buildWav({}).buffer)
        expect(decoder.output).toBeNull()
    })
})

describe('decodeData', () => {
    test('deinterleaves the channels of a whole file', () => {
        const { buffer } = buildWav({ channels: 2, frames: 4, interleaved: [1, 2, 3, 4, 5, 6, 7, 8] })
        const decoder = decoderFor(buffer)
        decoder.decodeHeader()
        expect(decoder.decodeData()?.signals).toStrictEqual([
            [1/UV, 3/UV, 5/UV, 7/UV],
            [2/UV, 4/UV, 6/UV, 8/UV],
        ])
    })

    test('decodes a chunk that starts at the data, as the base reader hands it over', () => {
        // The reader slices the file from the data offset onwards and passes the slice with an
        // offset of zero, so a decoder that re-applies the header's own offset drops the first
        // bytes of every chunk and reads past its end. Both halves of that are silent: the samples
        // it returns are real samples from the wrong position, and the overrun arrives as NaN.
        const { buffer } = buildWav({ channels: 1, frames: 64 })
        const decoder = decoderFor(buffer)
        const header = decoder.decodeHeader()!.header
        const chunk = buffer.slice(header.dataOffset, header.dataOffset + 32)
        const signals = decoder.decodeData(header, chunk, 0)?.signals
        expect(signals?.[0]).toHaveLength(16)
        expect(signals?.[0]).toStrictEqual(Array.from({ length: 16 }, (_, i) => (i + 1)/UV))
    })

    test('decodes a multi-channel chunk at the frame boundary it is given', () => {
        const { buffer } = buildWav({ channels: 2, frames: 8 })
        const decoder = decoderFor(buffer)
        const header = decoder.decodeHeader()!.header
        // Two frames in, so the first value of the chunk is the fifth stored sample.
        const chunk = buffer.slice(header.dataOffset + 8, header.dataOffset + 24)
        expect(decoder.decodeData(header, chunk, 0)?.signals).toStrictEqual([
            [5/UV, 7/UV, 9/UV, 11/UV],
            [6/UV, 8/UV, 10/UV, 12/UV],
        ])
    })

    test('reads the data offset from the header when none is given', () => {
        const { buffer } = buildWav({ channels: 1, frames: 4, extraChunks: [listChunk(10)] })
        const decoder = decoderFor(buffer)
        const header = decoder.decodeHeader()!.header
        expect(decoder.decodeData(header, buffer)?.signals).toStrictEqual([
            [1/UV, 2/UV, 3/UV, 4/UV],
        ])
    })

    test('stops at the end of the data chunk when the file carries a chunk after it', () => {
        // A trailing metadata chunk is as routine as a leading one, and its bytes are not samples.
        // Taking the sample count from the buffer alone decodes them as samples; taking it from the
        // header alone overruns a chunk the reader sliced out of the middle of the file.
        const { buffer } = buildWav({ channels: 1, frames: 4 })
        const withTrailer = new ArrayBuffer(buffer.byteLength + 16)
        new Uint8Array(withTrailer).set(new Uint8Array(buffer))
        new Uint8Array(withTrailer).fill(0x7f, buffer.byteLength)
        const decoder = decoderFor(withTrailer)
        decoder.decodeHeader()
        expect(decoder.decodeData()?.signals).toStrictEqual([[1/UV, 2/UV, 3/UV, 4/UV]])
    })

    test('returns the stored integers when raw samples are asked for', () => {
        const { buffer } = buildWav({ channels: 1, frames: 4, interleaved: [-3, -2, 7, 9] })
        const decoder = decoderFor(buffer)
        const header = decoder.decodeHeader()!.header
        expect(decoder.decodeData(header, buffer, undefined, 0, undefined, 0, true)?.signals)
            .toStrictEqual([[-3, -2, 7, 9]])
    })

    test('applies a normalisation factor given to the constructor', () => {
        const { buffer } = buildWav({ channels: 1, frames: 2, interleaved: [100, 200] })
        const decoder = new WavDecoder(32_768)
        decoder.setInput(buffer)
        decoder.decodeHeader()
        // A factor equal to full scale leaves the divisor at one, so the samples come through as
        // the integers they are stored as.
        expect(decoder.decodeData()?.signals).toStrictEqual([[100, 200]])
    })

    test('keeps a negative sample negative', () => {
        const { buffer } = buildWav({ channels: 1, frames: 3, interleaved: [-32768, 0, 32767] })
        const decoder = decoderFor(buffer)
        decoder.decodeHeader()
        expect(decoder.decodeData()?.signals).toStrictEqual([[-32768/UV, 0, 32767/UV]])
    })

    test('drops a trailing partial frame rather than decoding past the buffer', () => {
        const { buffer } = buildWav({ channels: 2, frames: 4 })
        const decoder = decoderFor(buffer)
        const header = decoder.decodeHeader()!.header
        // Six bytes is one whole frame and half of another.
        const chunk = buffer.slice(header.dataOffset, header.dataOffset + 6)
        const signals = decoder.decodeData(header, chunk, 0)?.signals
        expect(signals).toStrictEqual([[1/UV], [2/UV]])
        expect(signals?.flat().some(Number.isNaN)).toBe(false)
    })

    test('refuses a bit depth it cannot decode', () => {
        // Nothing in this reader handles a width other than 16 bits: the cache element type and the
        // data-unit arithmetic are both fixed at two bytes per sample. Reading an 8-bit file as
        // 16-bit pairs each sample with its neighbour and halves the count, and every value that
        // comes out is plausible.
        const { buffer } = buildWav({ bitsPerSample: 8, channels: 1, frames: 4 })
        const decoder = decoderFor(buffer)
        const header = decoder.decodeHeader()!.header
        expect(header.bitsPerSample).toStrictEqual(8)
        expect(decoder.decodeData(header, buffer)).toBeNull()
    })

    test('refuses a header that declares no channels', () => {
        const { buffer } = buildWav({ channels: 0 })
        const decoder = decoderFor(buffer)
        const header = decoder.decodeHeader()!.header
        expect(decoder.decodeData(header, buffer)).toBeNull()
    })

    test('refuses without a header', () => {
        const { buffer } = buildWav({})
        expect(decoderFor(buffer).decodeData()).toBeNull()
    })

    test('refuses without a buffer', () => {
        expect(new WavDecoder().decodeData(null, null)).toBeNull()
    })

    test('reads the whole data chunk once however many channels it holds', () => {
        const { buffer } = buildWav({ channels: 8, frames: 32 })
        const decoder = decoderFor(buffer)
        decoder.decodeHeader()
        const slice = vi.spyOn(ArrayBuffer.prototype, 'slice')
        decoder.decodeData()
        // One slice, not one per channel: the samples of every channel are interleaved in the same
        // bytes, so copying and unpacking them per channel is the same work done eight times.
        expect(slice).toHaveBeenCalledTimes(1)
        slice.mockRestore()
    })
})

describe('decode', () => {
    test('returns the header and the data together', () => {
        const { buffer } = buildWav({ channels: 2, frames: 2, interleaved: [1, 2, 3, 4] })
        const result = decoderFor(buffer).decode()
        expect(result?.header.header.nChannels).toStrictEqual(2)
        expect(result?.data.signals).toStrictEqual([[1/UV, 3/UV], [2/UV, 4/UV]])
    })

    test('refuses a file whose header does not parse', () => {
        const { buffer } = buildWav({ riffId: 'RIFX' })
        expect(decoderFor(buffer).decode()).toBeNull()
    })

    test('refuses a file whose data does not decode', () => {
        const { buffer } = buildWav({ bitsPerSample: 32 })
        expect(decoderFor(buffer).decode()).toBeNull()
    })

    test('refuses without an input buffer', () => {
        expect(new WavDecoder().decode()).toBeNull()
    })
})

describe('bufferToBiosignalAudio', () => {
    let decoder: WavDecoder

    beforeEach(() => {
        decoder = new WavDecoder()
    })

    test('refuses without a buffer', async () => {
        expect(await decoder.bufferToBiosignalAudio()).toBeNull()
    })
})
