/**
 * Epicurrents WAV importer. Recognises a WAV file, reads its header into the study and hands over
 * the worker the study's signals are then read through.
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
} from '@epicurrents/core/types'
import { WavDecoder } from '#wav/WavDecoder'
import { Log } from 'scoped-event-log'
import InlineWavWorker from '../workers/wav.worker.ts?worker&inline'

const SCOPE = 'WavImporter'

export default class WavImporter extends GenericStudyImporter implements SignalStudyImporter {
    protected _decoder = new WavDecoder()

    constructor () {
        const fileTypeAssocs = [
            {
                accept: {
                    'audio/wav': ['.wav'],
                },
                description: 'WAV audio file',
            },
        ] as AssociatedFileType[]
        super(SCOPE, [], fileTypeAssocs)
    }

    /**
     * Parse `source` and record the recording properties it declares into the study metadata.
     * @param source - The leading bytes of the file, which have to cover the whole header.
     */
    protected _readHeaderInfo (source: ArrayBuffer) {
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

    getFileTypeWorker (override?: string): Worker {
        const workerOverride = this._workerOverrides.get(override || 'wav')
        const worker = workerOverride ? workerOverride() : new InlineWavWorker()
        Log.registerWorker(worker)
        return worker
    }

    // The interface declares this asynchronous because a format may have to fetch more of the file
    // to find its header. This one is handed every byte it needs.
    // eslint-disable-next-line @typescript-eslint/require-await
    async readHeader (source: ArrayBuffer, _config?: unknown) {
        this._readHeaderInfo(source)
        return this._decoder.output
    }

    async importFile (source: File | StudyFileContext, config?: ConfigReadUrl) {
        const file = (source as StudyFileContext).file || source as File
        Log.debug(`Loading WAV from file ${file.webkitRelativePath || file.name}.`, SCOPE)
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
