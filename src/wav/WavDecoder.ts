/**
 * Epicurrents WAV decoder. Parses the chunk structure of a RIFF/WAVE file and turns its PCM samples
 * into one array per channel.
 *
 * Only 16-bit PCM is decoded, and that is a property of the reader rather than of this class: the
 * cache element type and the data-unit arithmetic in {@link WavReader} are both fixed at two bytes
 * per sample. A file of another width is refused instead of reinterpreted, because reading one as
 * 16-bit pairs each sample with its neighbour and every value that comes out is plausible.
 * @package    epicurrents/wav-reader
 * @copyright  2025 Sampsa Lohi
 * @license    Apache-2.0
 */

import { BiosignalAudio } from '@epicurrents/core'
import type { SignalDataDecoder } from '@epicurrents/core/types'
import { unpackArray, unpackString } from 'byte-data'
import { Log } from 'scoped-event-log'
import type { WavHeader } from '#types'

const SCOPE = 'WavDecoder'
/** Value that normalizes a signed 16-bit integer between -1 and 1. */
const MAX_SIGNED_16BIT = 32_768
/** The only sample width this decoder reads; see the module docstring for why it is the only one. */
export const SUPPORTED_BITS_PER_SAMPLE = 16

export class WavDecoder implements SignalDataDecoder {

    protected _normalizationFactor: number
    protected _inputBuffer: ArrayBuffer | null = null
    protected _output: WavHeader | null = null

    constructor (normalizationFactor = MAX_SIGNED_16BIT*1e6) {
        // Default normalization factor expects the signal integer values to represent microvolts.
        this._normalizationFactor = normalizationFactor
    }

    get output () {
        return this._output
    }

    /**
     * Convert the buffer into a BiosignalAudio object.
     * @param buffer - ArrayBuffer containing the WAV data. If not given, the internal input buffer is used.
     * @return BiosignalAudio object or null on error.
     */
    async bufferToBiosignalAudio (buffer = this._inputBuffer) {
        if (!buffer) {
            Log.error(`Cannot decode WAV data: an input buffer must be specified.`, SCOPE)
            return null
        }
        const audio = new BiosignalAudio('WAV Audio')
        await audio.loadFile(buffer)
        return audio
    }

    decode () {
        if (!this._inputBuffer) {
            Log.error(`Cannot decode WAV file: an input buffer must be specified.`, SCOPE)
            return null
        }
        const header = this.decodeHeader()
        if (!header) {
            Log.error(`Decoding WAV file was aborted because of header decoding error.`, SCOPE)
            return null
        }
        const wav = this.decodeData()
        if (!wav) {
            Log.error(`Decoding WAV file was aborted because of data decoding error.`, SCOPE)
            return null
        }
        return { data: wav, header: header }
    }

    /**
     * Decode the PCM samples in `buffer` into one array per channel.
     *
     * The sample count is bounded by the buffer as well as by the header, because the buffer is
     * usually a part of the file: the base reader slices the data region at a frame boundary and
     * hands the slice over with `dataOffset` zero, so the header's own count describes the whole
     * recording and not the part being decoded. Reading that many samples out of a part overruns
     * it, and the overrun arrives as NaN rather than as an error.
     * @param header - Header of the file the buffer came from, defaulting to the decoded one.
     * @param buffer - Buffer to decode, defaulting to the whole input.
     * @param dataOffset - Byte offset the samples start at within `buffer`; the header's own offset when omitted.
     * @param _startRecord - Unused. The buffer begins where the caller asked it to, so its position needs no index.
     * @param _range - Unused. The caller slices the range it wants; the whole buffer is that range.
     * @param _priorOffset - Unused. A WAV recording is continuous, so no interruption time precedes the buffer.
     * @param returnRaw - Return the stored integers instead of normalized values (default false).
     * @returns One array of samples per channel, or null if the buffer cannot be decoded.
     */
    decodeData (
        header: WavHeader | null = this._output,
        buffer: ArrayBuffer | null = this._inputBuffer,
        dataOffset?: number,
        _startRecord = 0,
        _range?: number,
        _priorOffset = 0,
        returnRaw = false,
    ) {
        if (!buffer) {
            Log.error(`Cannot decode WAV data: an input buffer must be specified.`, SCOPE)
            return null
        }
        if (!header) {
            Log.error(`Cannot decode WAV data: header has not been decoded yet.`, SCOPE)
            return null
        }
        if (header.bitsPerSample !== SUPPORTED_BITS_PER_SAMPLE) {
            Log.error(
                `Cannot decode WAV data: ${header.bitsPerSample}-bit samples are not supported ` +
                `(only ${SUPPORTED_BITS_PER_SAMPLE}-bit PCM is).`,
                SCOPE
            )
            return null
        }
        if (header.nChannels < 1) {
            Log.error(`Cannot decode WAV data: the header declares ${header.nChannels} channels.`, SCOPE)
            return null
        }
        const start = dataOffset ?? header.dataOffset
        const frameBytes = header.nChannels*(SUPPORTED_BITS_PER_SAMPLE/8)
        // Whichever of the two runs out first. The buffer bounds a part of the file, which holds
        // fewer samples than the recording does; the data chunk bounds the whole file, which can
        // carry further chunks after the samples, and those bytes are not samples. A trailing
        // partial frame is dropped rather than padded, since every channel has to come out the
        // same length and the samples it would be padded with are not in the file.
        const available = Math.min(Math.max(0, buffer.byteLength - start), header.dataSize)
        const frames = Math.floor(available/frameBytes)
        // Unpacked once for all the channels together. They are interleaved in the same bytes, so
        // copying and unpacking inside the channel loop below is the same work repeated — on an
        // eight-channel file, eight times the allocation for one result.
        const byteArray = new Uint8Array(buffer.slice(start, start + frames*frameBytes))
        const samples = unpackArray(byteArray, { bits: SUPPORTED_BITS_PER_SAMPLE, signed: true })
        const divisor = returnRaw ? 1 : this._normalizationFactor/MAX_SIGNED_16BIT
        const signals: number[][] = []
        for (let i = 0; i < header.nChannels; i++) {
            const channelData = new Array<number>(frames)
            for (let j = 0; j < frames; j++) {
                // Samples for each channel are interleaved at every data point.
                channelData[j] = samples[j*header.nChannels + i]/divisor
            }
            signals.push(channelData)
        }
        return {
            signals
        }
    }

    /**
     * Parse the header chunks of the input buffer.
     *
     * Every refusal returns nothing rather than a header holding the fields that happened to parse,
     * because a partial header describes a recording the file does not contain. The unpacker answers
     * a read past the end of the buffer with NaN rather than an error, so it is the chunk walk below
     * that refuses a file ending early: the data chunk has to be found inside the bytes given, and
     * every field read before it sits at a lower offset than the walk reached.
     * @param expectedProperties - Properties the file must declare, as a map of name to value; a mismatch refuses the file.
     * @returns The header and the byte offset its samples start at, or undefined if the file cannot be read.
     */
    decodeHeader (expectedProperties?: Map<string, string|number>) {
        if (!this._inputBuffer) {
            Log.error(`Cannot decode WAV header: an input buffer must be specified.`, SCOPE)
            return
        }
        const header = {
            blockAlignment: 0,
            bitsPerSample: 0,
            bytesPerSec: 0,
            dataOffset: 0,
            dataSize: 0,
            description: '',
            duration: 0,
            fileSize: 0,
            nSamples: 0,
            nChannels: 0,
            samplingRate: 0,
            sectionSize: 0,
            typeFormat: 0,
        } as WavHeader
        let offset = 0
        let field = 'file description'
        Log.debug(`WAV header decoding started.`, SCOPE)
        // Create a view to the underlying buffer.
        const byteArray = new Uint8Array(this._inputBuffer)
        /** Read a four-character chunk or format identifier, trailing padding removed. */
        const readId = () => unpackString(byteArray, offset, offset += 4).trim()
        /** Read an unsigned little-endian integer of `bits` width. */
        const readInt = (bits: 16 | 32) => unpackArray(byteArray, { bits }, offset, offset += bits/8)[0]
        try {
            // 4 byte ascii : RIFF
            const riff = readId()
            if (riff !== 'RIFF') {
                Log.error(`WAV file description header is '${riff}' (expected 'RIFF'), aborting.`, SCOPE)
                return
            }
            // 4 byte number : byte count of everything after this field. The field is named for the
            // file size and reported under that name, so the eight bytes it excludes are added
            // back rather than left for every consumer to know about.
            field = 'file size'
            header.fileSize = readInt(32) + 8
            Log.debug(`File size is ${header.fileSize} bytes.`, SCOPE)
            // 4 byte ascii : WAVE description header
            field = 'WAV description'
            const wave = readId()
            if (wave !== 'WAVE') {
                Log.error(`WAV description header is '${wave}' (expected 'WAVE'), aborting.`, SCOPE)
                return
            }
            header.description = wave
            // 4 byte ascii : fmt description header
            field = 'fmt description'
            const fmt = readId()
            if (fmt !== 'fmt') {
                Log.error(`Fmt description header is '${fmt}' (expected 'fmt'), aborting.`, SCOPE)
                return
            }
            // 4 byte number : fmt section size
            field = 'section size'
            header.sectionSize = readInt(32)
            // 2 byte number : WAV type format
            field = 'type format'
            header.typeFormat = readInt(16)
            if (header.typeFormat !== 1) {
                Log.debug(`Unexpected type format ${header.typeFormat} (expected 1).`, SCOPE)
            }
            // 2 byte number : mono/stereo
            field = 'channel count'
            header.nChannels = readInt(16)
            Log.debug(`Recording has ${header.nChannels} channel(s).`, SCOPE)
            // 4 byte number : sampling rate
            field = 'sampling rate'
            header.samplingRate = readInt(32)
            const expectedSr = expectedProperties?.get('samplingRate')
            if (expectedSr && expectedSr !== header.samplingRate) {
                Log.error(`Expected sampling rate of ${expectedSr}, aborting.`, SCOPE)
                return
            }
            // 4 byte number : bytes/second
            field = 'bytes per second'
            header.bytesPerSec = readInt(32)
            const expectedBytes = expectedProperties?.get('bytesPerSecond')
            if (expectedBytes && expectedBytes !== header.bytesPerSec) {
                Log.error(`Expected ${expectedBytes} bytes per second, aborting.`, SCOPE)
                return
            }
            // 2 byte number : block alignment
            field = 'block alignment'
            header.blockAlignment = readInt(16)
            // 2 byte number : bits per sample
            field = 'bits per sample'
            header.bitsPerSample = readInt(16)
            const expectedBits = expectedProperties?.get('bitsPerSample')
            if (expectedBits && expectedBits !== header.bitsPerSample) {
                Log.error(`Expected ${expectedBits} bits per sample, aborting.`, SCOPE)
                return
            }
            if (header.sectionSize !== 16) {
                // An extended fmt chunk carries its extra bytes after the sixteen standard ones.
                Log.debug(`Fmt section size is ${header.sectionSize} instead of the default 16.`, SCOPE)
                offset += header.sectionSize - 16
            }
            // Walk the chunks between fmt and the samples. Skipping the ones this reader has no use
            // for is what lets it open a file carrying authoring metadata, which is most of the
            // files a recording program writes; expecting `data` to follow `fmt ` refuses them all.
            field = 'chunk list'
            let dataFound = false
            while (offset + 8 <= byteArray.length) {
                const chunkId = readId()
                const chunkSize = readInt(32)
                if (chunkId === 'data') {
                    header.dataSize = chunkSize
                    dataFound = true
                    break
                }
                if (chunkId === 'fact' && chunkSize >= 4) {
                    // The fact chunk counts samples per channel, which is what this header reports.
                    header.nSamples = unpackArray(byteArray, { bits: 32 }, offset, offset + 4)[0]
                    Log.debug(`Fact chunk declares ${header.nSamples} samples per channel.`, SCOPE)
                } else {
                    Log.debug(`Skipping a '${chunkId}' chunk of ${chunkSize} bytes.`, SCOPE)
                }
                // RIFF pads an odd-sized payload to a word boundary, and the pad byte is not
                // counted in the declared size.
                offset += chunkSize + chunkSize%2
            }
            if (!dataFound) {
                Log.error(`WAV file holds no data chunk within the header that was read, aborting.`, SCOPE)
                return
            }
        } catch (e) {
            Log.error(`Failed to parse the ${field} header field.`, SCOPE, e as Error)
            return
        }
        // Derive the sample count if the file declared none. The data chunk holds one sample per
        // channel per frame, so dividing by the width alone counts the frames of every channel at
        // once — which on a multi-channel file is the count, and the duration, multiplied by the
        // number of channels.
        if (!header.nSamples && header.dataSize && header.bitsPerSample && header.nChannels) {
            header.nSamples = header.dataSize/((header.bitsPerSample/8)*header.nChannels)
        }
        header.dataOffset = offset
        header.duration = header.samplingRate ? header.nSamples/header.samplingRate : 0
        this._output = header
        return {
            offset: offset,
            header: header
        }
    }

    /**
     * Set the array buffer containing the WAV data, discarding any header decoded from the previous one.
     * @param buffer - Buffer holding the file, or the leading part of it that contains the header.
     */
    setInput (buffer: ArrayBuffer) {
        this._output = null
        this._inputBuffer = buffer
    }
}
