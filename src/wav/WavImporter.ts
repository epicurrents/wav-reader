/**
 * Epicurrents WAV importer. Recognises a WAV file, reads its header into the study and hands over
 * the worker the study's signals are then read through.
 *
 * A WAV file says nothing about what its integers measure, so the importer carries the calibration:
 * given to the constructor or to `setCalibration`, it is recorded in the study metadata and posted to
 * every worker the importer hands over, ahead of the commission that sets the study up.
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
import type { WavCalibration, WavImporterOptions } from '#types'
import { DEFAULT_CALIBRATION, validateCalibration } from '#util'
import InlineWavWorker from '../workers/wav.worker.ts?worker&inline'

const SCOPE = 'WavImporter'

export default class WavImporter extends GenericStudyImporter implements SignalStudyImporter {
    /** Calibration set by the host, or null for the default of one microvolt per stored integer. */
    protected _calibration = null as Required<WavCalibration> | null
    /** Why the last calibration given was refused; no file is imported while one stands. */
    protected _calibrationRefusal = null as string | null
    protected _decoder = new WavDecoder()

    /**
     * @param options - Importer options; see {@link WavImporterOptions}. An invalid calibration is logged and the
     *                  importer refuses every file until a valid one is set.
     */
    constructor (options?: WavImporterOptions) {
        const fileTypeAssocs = [
            {
                accept: {
                    'audio/wav': ['.wav'],
                },
                description: 'WAV audio file',
            },
        ] as AssociatedFileType[]
        super(SCOPE, [], fileTypeAssocs)
        if (options?.calibration) {
            this.setCalibration(options.calibration)
        }
    }

    /** The calibration studies are opened with; the default when none was set. */
    get calibration (): Required<WavCalibration> {
        return this._calibration ?? DEFAULT_CALIBRATION
    }

    /**
     * Report a standing calibration refusal for the file named, so it is not opened at the default scale.
     * @param name - The file or URL being imported.
     * @returns True if the import has to stop.
     */
    protected _isCalibrationRefused (name: string) {
        if (this._calibrationRefusal) {
            Log.error(`Cannot import ${name}: the calibration given was refused: ${this._calibrationRefusal}`, SCOPE)
            return true
        }
        return false
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
            calibration: { ...this.calibration },
        }
    }

    getFileTypeWorker (override?: string): Worker {
        const workerOverride = this._workerOverrides.get(override || 'wav')
        const worker = workerOverride ? workerOverride() : new InlineWavWorker()
        Log.registerWorker(worker)
        if (this._calibration) {
            // Posted before the worker is handed over, so it reaches the reader ahead of `setup-worker`; a worker
            // handles its messages in order, and the substitute takes this one synchronously. The reply has no
            // commission waiting on it and the service drops it, as it does the reply to `update-settings`.
            worker.postMessage({ action: 'set-calibration', ...this._calibration })
        }
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
        if (this._isCalibrationRefused(file.name)) {
            return null
        }
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
        if (this._isCalibrationRefused(url)) {
            return null
        }
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

    /**
     * Set what the stored integers of the files imported from here on stand for.
     *
     * Applies to the studies opened after it, through the workers handed over after it; a recording already open
     * keeps the scale it was opened with. An invalid calibration is refused and stops every import until a valid one
     * is set, because opening a file at the default scale instead gives values that look right and are not.
     * @param calibration - Full-scale value and unit (see `WavCalibration`), or null for one microvolt per integer.
     * @returns True if the calibration was taken, false if it was refused.
     */
    setCalibration (calibration: WavCalibration | null) {
        if (calibration === null) {
            this._calibration = null
            this._calibrationRefusal = null
            return true
        }
        const result = validateCalibration(calibration)
        if ('reason' in result) {
            this._calibrationRefusal = result.reason
            Log.error(`Refused WAV calibration: ${result.reason}`, SCOPE)
            return false
        }
        this._calibration = result.calibration
        this._calibrationRefusal = null
        return true
    }
}
