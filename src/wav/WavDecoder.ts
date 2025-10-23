

import { BiosignalAudio } from '@epicurrents/core'
import type { SignalDataDecoder } from '@epicurrents/core/dist/types'
import { unpackArray, unpackString } from 'byte-data'
import { Log } from 'scoped-event-log'
import type { WavHeader } from '#types'

const SCOPE = 'WavDecoder'
/** Value that normalizes a signed 16-bit integer between -1 and 1. */
const MAX_SIGNED_16BIT = 32_768

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
            Log.error("Cannot decode WAV data: an input buffer must be specified!", SCOPE)
            return null
        }
        const audio = new BiosignalAudio('WAV Audio')
        await audio.loadFile(buffer)
        return audio
    }

    decode () {
        if (!this._inputBuffer) {
            Log.error("Cannot decode WAV file: an input buffer must be specified.", SCOPE)
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

    decodeData (header: WavHeader | null = this._output, buffer: ArrayBuffer | null = this._inputBuffer) {
        if (!buffer) {
            Log.error("Cannot decode WAV data: an input buffer must be specified!", SCOPE)
            return null
        }
        if (!header) {
            Log.error("Cannot decode WAV data: header has not been decoded yet!", SCOPE)
            return null
        }
        // For now, only get the first data chunk. TODO: Multi-chunk files?
        // Refresh output with actual signal data.
        const signals: number[][] = []
        for (let i=0; i<header.nChannels; i++) {
            // Create a view to the underlying buffer.
            const byteArray = new Uint8Array(
                buffer.slice(header.dataOffset, header.dataOffset + header.dataSize)
            )
            const signalData = unpackArray(byteArray, { bits: 16, signed: true })
            const channelData = new Array(header.nSamples)
            for (let j=0; j<header.nSamples; j++) {
                // Samples for each channel are interleaved at every data point.
                const sampleIndex = j*header.nChannels + i
                // Normalize relative to max signed 16-bit integer value.
                channelData[j] = signalData[sampleIndex]/(this._normalizationFactor/MAX_SIGNED_16BIT)
            }
            signals.push(channelData)
        }
        return {
            signals
        }
    }

    decodeHeader (expectedProperties?: Map<string, string|number>) {
        if (!this._inputBuffer) {
            Log.error("Cannot decode WAV header: an input buffer must be specified!", SCOPE)
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
        // Attempt to parse the header.
        // Vital field parsing errors abort the process in addition to logging an error.
        Log.debug(`WAV header decoding started.`, SCOPE)
        // Create a view to the underlying buffer.
        const byteArray = new Uint8Array(this._inputBuffer)
        try {
            // 4 byte ascii : RIFF
            const desc = unpackString(byteArray, offset, offset += 4).trim()
            if (desc !== 'RIFF') {
                Log.error(`WAV file description header is '${desc}' (expected 'RIFF'), aborting.`, SCOPE)
                return
            }
        } catch (e) {
            Log.error(`Failed to parse file description header field!`, SCOPE, e as Error)
            return
        }
        try {
            // 4 byte number : file size without the description and this field (= file size - 8 bytes)
            header.fileSize = unpackArray(byteArray, { bits: 32 }, offset, offset += 4)[0]
            Log.debug(`File size is ${header.fileSize} + 8 bytes.`, SCOPE)
        } catch (e) {
            Log.error(`Failed to parse file size header field!`, SCOPE, e as Error)
        }
        try {
            // 4 byte ascii : WAVE description header
            const desc = unpackString(byteArray, offset, offset += 4).trim()
            if (desc !== 'WAVE') {
                Log.error(`WAV description header is '${desc}' (expected 'WAVE'), aborting.`, SCOPE)
                return
            }
            header.description = desc
        } catch (e) {
            Log.error(`Failed to parse WAV description header field!`, SCOPE, e as Error)
        }
        try {
            // 4 byte ascii : fmt description header
            const desc = unpackString(byteArray, offset, offset += 4).trim()
            if (desc !== 'fmt') {
                Log.error(`Fmt description header is '${desc}' (expected 'fmt'), aborting.`, SCOPE)
                return
            }
        } catch (e) {
            Log.error(`Failed to parse fmt description header field!`, SCOPE, e as Error)
        }
        try {
            // 4 byte number : section size header
            header.sectionSize = unpackArray(byteArray, { bits: 32 }, offset, offset += 4)[0]
            if (header.sectionSize === 16) {
                Log.debug(`Section size is the default ${header.sectionSize}.`, SCOPE)
            } else {
                Log.debug(
                    `Section size is ${header.sectionSize} instead of default 16, skipping part of the header.`,
                    SCOPE
                )
            }
        } catch (e) {
            Log.error(`Failed to parse section size header field!`, SCOPE, e as Error)
        }
        try {
            // 2 byte number : WAV type format
            header.typeFormat = unpackArray(byteArray, { bits: 16 }, offset, offset += 2)[0]
            if (header.typeFormat === 1) {
                Log.debug(`Type format is the default ${header.typeFormat}.`, SCOPE)
            } else {
                Log.debug(`Unexpected type format ${header.typeFormat} (expected 1).`, SCOPE)
            }
        } catch (e) {
            Log.error(`Failed to parse type format header field!`, SCOPE, e as Error)
        }
        try {
            // 2 byte number : mono/stereo
            header.nChannels = unpackArray(byteArray, { bits: 16 }, offset, offset += 2)[0]
            if (header.nChannels === 1) {
                Log.debug(`Recording is in mono format.`, SCOPE)
            } else {
                Log.debug(`Recording has ${header.nChannels} channels.`, SCOPE)
            }
        } catch (e) {
            Log.error(`Failed to parse mono/stereo header field!`, SCOPE, e as Error)
        }
        try {
            // 4 byte number : sampling rate
            header.samplingRate = unpackArray(byteArray, { bits: 32 }, offset, offset += 4)[0]
            const expectedSr = expectedProperties?.get('samplingRate')
            if (expectedSr && expectedSr !== header.samplingRate) {
                Log.error(`Expected sampling rate of ${expectedSr}, aborting.`, SCOPE)
                return
            }
            Log.debug(`Sampling rate is ${header.samplingRate}.`, SCOPE)
        } catch (e) {
            Log.error(`Failed to parse sampling rate header field!`, SCOPE, e as Error)
        }
        try {
            // 4 byte number : bytes/second
            header.bytesPerSec = unpackArray(byteArray, { bits: 32 }, offset, offset += 4)[0]
            Log.debug(`Bytes per seconds is ${header.bytesPerSec}.`, SCOPE)
            const expectedBps = expectedProperties?.get('bytesPerSecond')
            if (expectedBps && expectedBps !== header.bytesPerSec) {
                Log.error(`Expected ${expectedBps} bytes per second, aborting.`, SCOPE)
                return
            }
        } catch (e) {
            Log.error(`Failed to parse bytes per second header field!`, SCOPE, e as Error)
        }
        try {
            // 2 byte number : block alignment
            header.blockAlignment = unpackArray(byteArray, { bits: 16 }, offset, offset += 2)[0]
            Log.debug(`Block alignment is ${header.blockAlignment}.`, SCOPE)
        } catch (e) {
            Log.error(`Failed to parse block alignment header field!`, SCOPE, e as Error)
        }
        try {
            // 2 byte number : bits per sample
            header.bitsPerSample = unpackArray(byteArray, { bits: 16 }, offset, offset += 2)[0]
            Log.debug(`Bits per sample is ${header.bitsPerSample}.`, SCOPE)
            const expectedBps = expectedProperties?.get('bitsPerSample')
            if (expectedBps && expectedBps !== header.bitsPerSample) {
                Log.error(`Expected ${expectedBps} bits per sample, aborting.`, SCOPE)
                return
            }
        } catch (e) {
            Log.error(`Failed to parse bits per sample header field!`, SCOPE, e as Error)
        }
        if (header.sectionSize !== 16) {
            // Load additional sections
            //while (offset < header.sectionSize - 16) {
            //    const sectionId = unpackString(byteArray, offset, offset += 4).trim()
            //    const sectionSize = unpackArray(byteArray, { bits: 32 }, offset, offset += 4)[0]
            //    Log.debug(`Additional section ${sectionId} with size ${sectionSize} bytes found.`, SCOPE)
            //    offset += sectionSize
            //}
            offset += header.sectionSize - 16
        }
        try {
            // 4 byte ascii : data description header
            let desc = unpackString(byteArray, offset, offset += 4).trim()
            // Decode possible fact chunk first
            if (desc === 'fact') {
                //const factSize = unpackArray(byteArray, { bits: 32 }, offset, offset += 4)[0]
                offset += 4
                header.nSamples = unpackArray(byteArray, { bits: 32 }, offset, offset += 4)[0]
                Log.debug(`Number of samples is ${header.nSamples}.`, SCOPE)
                desc = unpackString(byteArray, offset, offset += 4).trim()
            }
            if (desc !== 'data') {
                Log.error(`Data description header is '${desc}' (expected 'data'), aborting.`, SCOPE)
                return
            }
        } catch (e) {
            Log.error(`Failed to parse data description header field!`, SCOPE, e as Error)
        }
        try {
            // 4 byte number : data chunk size
            header.dataSize = unpackArray(byteArray, { bits: 32 }, offset, offset += 4)[0]
            Log.debug(`Data chunk size is ${header.dataSize}.`, SCOPE)
        } catch (e) {
            Log.error(`Failed to parse data size header field!`, SCOPE, e as Error)
        }
        // Determine sample count if file header did not contain it
        if (!header.nSamples && header.dataSize && header.bitsPerSample) {
            header.nSamples = header.dataSize/(header.bitsPerSample/8)
        }
        header.dataOffset = offset
        header.duration = header.nSamples/header.samplingRate
        this._output = header
        return {
            offset: offset,
            header: header
        }
    }

    /**
    * Set the array buffer containing the WAV data.
    * @param buff - buffer from a file
    */
     setInput (buffer: ArrayBuffer) {
        this._output = null
        this._inputBuffer = buffer
    }
}
