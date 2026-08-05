/**
 * Epicurrents WAV reader. This class contains the common methods used both by workerized and direct reading.
 * @package    epicurrents/wav-reader
 * @copyright  2025 Sampsa Lohi
 * @license    Apache-2.0
 */

import {
    GenericSignalReader,
} from '@epicurrents/core'
import type { AppSettings, SignalSourceOptions, SignalStudyReader } from '@epicurrents/core/dist/types'
import { WavDecoder } from './WavDecoder'
import { Log } from 'scoped-event-log'
import { headerToBiosignalHeader } from '#util'
import type { WavHeader } from '#types'

const SCOPE = 'WavReader'

export default class WavReader extends GenericSignalReader implements SignalStudyReader {

    protected _decoder = null as WavDecoder | null
    /** Parsed header of the WAV recording. */
    protected _fileTypeHeader = null as WavHeader | null
    /** A method to pass update messages through. */
    protected _updateCallback = null as ((update: { [prop: string]: unknown }) => void) | null
    /** Settings must be kept up-to-date with the main application. */
    #SETTINGS: AppSettings

    constructor (settings: AppSettings) {
        super(Int16Array)
        this.#SETTINGS = settings
    }

    /**
     * Cache certain header information for use in async, progressive loading.
     * @param header - Parsed WavHeader.
     */
    cacheWavInfo (header: WavHeader) {
        this._dataOffset = header.dataOffset
        this._dataUnitCount = Math.ceil(header.duration)
        this._dataUnitDuration = 1
        this._fileTypeHeader = header
        this._totalDataLength = header.duration
        this._totalRecordingLength = this._totalDataLength // WAV has no gaps.
        this._dataUnitSize = header.samplingRate*header.nChannels*2 // int16.
        this._chunkUnitCount = this._dataUnitSize*2 < this.#SETTINGS.app.dataChunkSize
                                ? Math.floor(this.#SETTINGS.app.dataChunkSize/(this._dataUnitSize)) - 1
                                : 1
        this._discontinuous = false
        this._header = headerToBiosignalHeader(header)
        Log.debug(`Cached WAV info for recording.`, SCOPE)
    }

    async setupStudy (source: SignalSourceOptions) {
        // Make sure there aren't any cached signals yet.
        if (this._mutex || this._fallbackCache) {
            Log.error(
                [`Could not set study parameters.`, `Signal cache has already been initialized.`],
            SCOPE)
            return false
        }
        if (!source.file && !source.url) {
            Log.error(
                [`Could not set study parameters.`, `Neither a source file nor a source URL was given.`],
            SCOPE)
            return false
        }
        this._decoder = new WavDecoder()
        // The first kB should contain the full header.
        const HEADER_BYTES = 1024
        const sourceName = source.file?.name || source.url as string
        try {
            let head: ArrayBuffer
            if (source.file) {
                head = await source.file.slice(0, HEADER_BYTES).arrayBuffer()
            } else {
                const headers = new Headers()
                headers.set('Range', `bytes=0-${HEADER_BYTES - 1}`)
                if (source.authHeader) {
                    headers.append('Authorization', source.authHeader)
                }
                const fetched = await fetch(source.url as string, { method: 'GET', headers: headers })
                if (!fetched.ok) {
                    // Do not decode an error body as WAV samples; the catch below returns false.
                    throw new Error(`WAV request failed with HTTP ${fetched.status}.`)
                }
                head = await fetched.arrayBuffer()
            }
            this._decoder.setInput(head)
            const header = this._decoder.decodeHeader()?.header
            if (!header) {
                Log.error(`Could not parse WAV header.`, SCOPE)
                return false
            }
            // Initialize file loader.
            this.cacheWavInfo(header)
        } catch (error) {
            Log.error(`Could not read the WAV header from ${sourceName}.`, SCOPE, error as Error)
            return false
        }
        this._url = source.url || ''
        if (source.file) {
            this._setSourceFile(source.file)
        }
        if (source.authHeader) {
            this._authHeader = source.authHeader
        }
        // Reset possible running cache processes.
        for (let i=0; i<this._cacheProcesses.length; i++) {
            this._cacheProcesses[i].continue = false
            this._cacheProcesses.splice(i, 1)
        }
        return true
    }

}
