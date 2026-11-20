/**
 * Epicurrents WAV file worker. The commissions a signal reader answers alike come from
 * {@link SignalReaderWorker}; what is added here is `setup-worker`, which opens the study.
 * @package    epicurrents/wav-reader
 * @copyright  2025 Sampsa Lohi
 * @license    Apache-2.0
 */

import { SETTINGS } from '@epicurrents/core'
import { SignalReaderWorker } from '@epicurrents/core/workers'
import type { WorkerMessage } from '@epicurrents/core/types'
import { Log } from 'scoped-event-log'
import WavReader from '#wav/WavReader'

const SCOPE = 'wav.worker'

class WavWorker extends SignalReaderWorker<WavReader> {
    constructor () {
        super(new WavReader(SETTINGS))
        // The cache fill reports its progress through this callback, and the application learns what is cached from
        // nothing else: without it a shared cache fills in full while the recording still reports it empty.
        this._reader.setUpdateCallback((update: { [prop: string]: unknown }) => {
            if (update.action === 'cache-signals') {
                postMessage(update)
            }
        })
        // Only `set-calibration` and `setup-worker` are registered. The base class builds its action
        // map in a field initializer, where `this.setInterruptions` already resolves through the
        // prototype chain to the override below, so registering that one again would change nothing;
        // the other two are in no base map, which is why they have to be added.
        //
        // The map is bound at dispatch by `handleMessage`, so an entry added unbound here still
        // runs with this worker as its `this`.
        // eslint-disable-next-line @typescript-eslint/unbound-method
        this.extendActionMap([['set-calibration', this.setCalibration], ['setup-worker', this.setupWorker]])
    }

    /**
     * Set what the stored integers of the study stand for. Posted by the importer when it hands the worker over, so it
     * arrives before `setup-worker`; see `WavImporter.setCalibration`.
     * @param msgData - Data property from the message, carrying `physicalMax` and optionally `physicalUnit`.
     */
    // The handler contract is asynchronous because most commissions read or decode; this one only records a value.
    // eslint-disable-next-line @typescript-eslint/require-await
    async setCalibration (msgData: WorkerMessage['data']) {
        const data = this._validate(
            msgData as WorkerMessage['data'] & { physicalMax: number, physicalUnit?: string },
            { physicalMax: 'Number', physicalUnit: 'String?' }
        )
        if (!data) {
            return false
        }
        if (!this._reader.setCalibration({ physicalMax: data.physicalMax, physicalUnit: data.physicalUnit })) {
            return this._failure(msgData, `Setting the calibration failed.`)
        }
        return this._success(msgData)
    }

    /**
     * Refuse an interruption table rather than applying it.
     *
     * A WAV file holds one continuous span of PCM samples, so recording time and data time are the
     * same measurement and a sample position needs no gap arithmetic to reach it. A table saying
     * otherwise describes a timeline this reader does not serve: honouring it would displace every
     * later read by the gaps it declares, and return samples that still look entirely plausible. An
     * empty table asserts nothing and is passed on, since it is also how a caller marks the timing
     * of a recording fully known.
     * @param msgData - Data property from the message to the worker.
     */
    override async setInterruptions (msgData: WorkerMessage['data']) {
        const interruptions = msgData.interruptions
        if (Array.isArray(interruptions) && interruptions.length) {
            return this._failure(
                msgData,
                `Cannot apply an interruption table to a WAV study: the samples are one continuous ` +
                `span, so recording time and data time are the same measurement.`
            )
        }
        return super.setInterruptions(msgData)
    }

    /**
     * Open the study the commission describes.
     * @param msgData - Data property from the message to the worker.
     */
    async setupWorker (msgData: WorkerMessage['data']) {
        const data = this._validate(
            msgData as WorkerMessage['data'] & {
                authHeader?: string
                file?: File
                url?: string
            },
            {
                // A local study is read from the File and a remote one from the URL, so neither can
                // be required on its own; `setupStudy` rejects a source that has neither.
                authHeader: 'String?',
                file: 'File?',
                url: 'String?',
            }
        )
        if (!data) {
            // The commission is already answered: `_validate` reports the property it refused on
            // through the same transport as any other reply. Answering again here would post a
            // second response with the same request number, which the service has no commission
            // left to match it to.
            return false
        }
        if (!await this._reader.setupStudy({ authHeader: data.authHeader, file: data.file, url: data.url })) {
            return this._failure(msgData, `Setting up study failed.`)
        }
        return this._success(msgData, {
            dataLength: this._reader.dataLength,
            recordingLength: this._reader.totalLength,
        })
    }
}

const WORKER = new WavWorker()

onmessage = async (message: WorkerMessage) => {
    if (!message?.data?.action) {
        return
    }
    Log.debug(`Received message with action ${message.data.action}.`, SCOPE)
    await WORKER.handleMessage(message)
}
