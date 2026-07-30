/**
 * Epicurrents WAV reader.
 * @package    epicurrents/wav-reader
 * @copyright  2025 Sampsa Lohi
 * @license    Apache-2.0
 */

import { GenericStudyImporter } from '@epicurrents/core'
import type {
    AssociatedFileType,
    ConfigReadUrl,
    SignalStudyImporter,
    StudyContextFile,
    StudyFileContext,
} from '@epicurrents/core/dist/types'
import { WavDecoder } from './WavDecoder'
import { Log } from 'scoped-event-log'

const SCOPE = 'WavReader'

export default class WavImporter extends GenericStudyImporter implements SignalStudyImporter {
    protected _decoder = new WavDecoder()

    constructor () {
        const fileTypeAssocs = [
            {
                accept: {
                    "audio/wav": ['.wav'],
                },
                description: "WAV audio file",
            },
        ] as AssociatedFileType[]
        super(SCOPE, [], fileTypeAssocs)
    }

    protected async _readHeaderInfo (source: ArrayBuffer) {
        this._decoder.setInput(source)
        this._decoder.decodeHeader()
        const fullHeader = this._decoder.output
        if (!fullHeader) {
            Log.error(`WAV header could not be decoded.`, SCOPE)
            return
        }
        this._study.meta = {
            samplingRate: fullHeader.samplingRate,
            nChannels: fullHeader.nChannels,
            bitsPerSample: fullHeader.bitsPerSample,
            duration: fullHeader.duration,
            fileSize: fullHeader.fileSize,
        }
    }

    getFileTypeWorker (override?: string): Worker | null {
        const workerOverride = this._workerOverrides.get(override || 'wav')
        const worker = workerOverride ? workerOverride() : new Worker(
            /* webpackChunkName: 'wav.worker' */
            new URL('../workers/wav.worker', import.meta.url),
            { type: 'module' }
        )
        Log.registerWorker(worker)
        return worker
    }

    async readHeader (source: ArrayBuffer, _config?: unknown) {
        this._readHeaderInfo(source)
        return this._decoder.output
    }

    async importFile (source: File | StudyFileContext, config?: ConfigReadUrl) {
        const file = (source as StudyFileContext).file || source as File
        Log.debug(`Loading WAV from file ${file.webkitRelativePath}.`, SCOPE)
        const fileName = config?.name || file.name || ''
        const studyFile = {
            file: file,
            format: 'wav',
            mime: config?.mime || file.type || null,
            name: fileName,
            partial: false,
            range: [],
            role: 'data',
            modality: 'signal',
            url: config?.url || URL.createObjectURL(file),
        } as StudyContextFile
        try {
            // Load header part from the WAV file into the study.
            const mainHeader = file.slice(0, 1024)
            const wavHeader = await this.readHeader(await mainHeader.arrayBuffer())
            if (!wavHeader) {
                Log.error(`Could not load WAV header from the given file.`, SCOPE)
                return null
            }
        } catch (e: unknown) {
            Log.error(`WAV header parsing error: ${(e as Error).message}.`, SCOPE, e as Error)
            return null
        }
        this._study.files.push(studyFile)
        return studyFile
    }

    async importUrl (source: string | StudyFileContext, config?: ConfigReadUrl) {
        const url = (source as StudyFileContext).url || source as string
        Log.debug(`Loading WAV from url ${url}.`, SCOPE)
        const fileName = config?.name || url.split('/').pop() || ''
        const studyFile = {
            file: null,
            format: 'wav',
            mime: config?.mime || null,
            name: config?.name || fileName || '',
            partial: false,
            range: [],
            role: 'data',
            modality: 'signal',
            url: url,
        } as StudyContextFile
        try {
            // Load header part from the WAV file into the study.
            const buffer = await this._fetchArrayBuffer(url, {
                authHeader: config?.authHeader,
                range: [0, 1023],
            })
            const wavHeader = await this.readHeader(buffer)
            if (!wavHeader) {
                Log.error(`Could not load WAV header from the given URL.`, SCOPE)
                return null
            }
        } catch (e: unknown) {
            Log.error(`WAV header parsing error: ${(e as Error).message}.`, SCOPE, e as Error)
            return null
        }
        this._study.files.push(studyFile)
        return studyFile
    }
}
